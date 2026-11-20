import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { getEffectivePermission } from '$lib/server/permissions';
import { deleteDiskBlobIfUnreferenced, saveBufferAsBlob } from '$lib/server/storage';
import {
	getWorkspaceMembership,
	recalculateWorkspaceUsedBytes
} from '$lib/server/workspaces';
import { logAudit } from '$lib/server/auth';

export const POST: RequestHandler = async ({ locals, params, request, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const { node, permission } = await getEffectivePermission(locals.user, params.id);
	if (!node || !permission || node.type !== 'file' || node.is_trashed) {
		return json({ error: 'Imagem não encontrada ou sem permissão.' }, { status: 404 });
	}

	const formData = await request.formData().catch(() => null);
	const file = formData?.get('image');
	const mode = String(formData?.get('mode') || 'copy'); // 'replace' | 'copy'
	const reqWsId = formData?.get('workspaceId') ? String(formData.get('workspaceId')) : null;

	if (!(file instanceof File)) {
		return json({ error: 'Imagem recortada inválida.' }, { status: 400 });
	}
	if (mode === 'replace' && permission !== 'owner' && permission !== 'editor') {
		return json({ error: 'Sem permissão para substituir o arquivo original.' }, { status: 403 });
	}

	const targetWorkspaceId = mode === 'replace' ? node.workspace_id : reqWsId || node.workspace_id;
	if (mode === 'copy') {
		const membership = await getWorkspaceMembership(locals.user.id, targetWorkspaceId);
		if (!membership || membership.role === 'viewer') {
			return json(
				{ error: 'Sem permissão de escrita na workspace para salvar cópia.' },
				{ status: 403 }
			);
		}
	}

	const buffer = Buffer.from(await file.arrayBuffer());
	const db = getPool();

	const [wsRows] = await db.query<RowDataPacket[]>(
		'SELECT quota_bytes, used_bytes FROM workspaces WHERE id = ? LIMIT 1',
		[targetWorkspaceId]
	);
	const quota = Number(wsRows[0]?.quota_bytes ?? 0);
	const used = Number(wsRows[0]?.used_bytes ?? 0);
	const delta =
		mode === 'replace' ? buffer.byteLength - Number(node.size_bytes) : buffer.byteLength;
	if (quota >= 0 && used + delta > quota) {
		return json(
			{ error: 'Espaço insuficiente na cota da workspace para salvar imagem.' },
			{ status: 413 }
		);
	}

	const { diskPath, sizeBytes, sha256 } = await saveBufferAsBlob(buffer);
	const outMime = file.type || 'image/png';
	const ext = outMime === 'image/webp' ? '.webp' : outMime === 'image/jpeg' ? '.jpg' : '.png';

	if (mode === 'replace') {
		const oldDiskPath = node.disk_path;
		const baseNoExt = node.name.replace(/\.[^.]+$/, '');
		const newName = `${baseNoExt}${ext}`;

		await db.query(
			'UPDATE storage_nodes SET name = ?, mime_type = ?, size_bytes = ?, disk_path = ?, sha256 = ? WHERE id = ?',
			[newName, outMime, sizeBytes, diskPath, sha256, node.id]
		);

		await deleteDiskBlobIfUnreferenced(oldDiskPath);
		const usedBytes = await recalculateWorkspaceUsedBytes(node.workspace_id);

		await logAudit({
			userId: locals.user.id,
			action: 'image.crop_replace',
			targetType: 'file',
			targetId: node.id,
			details: `Imagem recortada (substituída): ${newName}`,
			ipAddress: getClientAddress()
		});

		return json({ id: node.id, name: newName, used_bytes: usedBytes });
	}

	const newId = crypto.randomUUID();
	const baseNoExt = node.name.replace(/\.[^.]+$/, '');
	const copyName = `${baseNoExt} (recortada)${ext}`;
	const targetParent = targetWorkspaceId === node.workspace_id ? node.parent_id : null;

	await db.query(
		`INSERT INTO storage_nodes (id, workspace_id, created_by, parent_id, type, name, mime_type, size_bytes, disk_path, sha256)
		 VALUES (?, ?, ?, ?, 'file', ?, ?, ?, ?, ?)`,
		[newId, targetWorkspaceId, locals.user.id, targetParent, copyName, outMime, sizeBytes, diskPath, sha256]
	);

	const usedBytes = await recalculateWorkspaceUsedBytes(targetWorkspaceId);

	await logAudit({
		userId: locals.user.id,
		action: 'image.crop_copy',
		targetType: 'file',
		targetId: newId,
		details: `Cópia recortada criada: ${copyName}`,
		ipAddress: getClientAddress()
	});

	return json({ id: newId, name: copyName, used_bytes: usedBytes }, { status: 201 });
};
