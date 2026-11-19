import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { getEffectivePermission } from '$lib/server/permissions';
import {
	deleteDiskBlobIfUnreferenced,
	recalculateUserUsedBytes,
	saveBufferAsBlob
} from '$lib/server/storage';
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

	if (!(file instanceof File)) {
		return json({ error: 'Imagem recortada inválida.' }, { status: 400 });
	}
	if (mode === 'replace' && permission !== 'owner' && permission !== 'editor') {
		return json({ error: 'Sem permissão para substituir o arquivo original.' }, { status: 403 });
	}

	const buffer = Buffer.from(await file.arrayBuffer());
	const db = getPool();

	// Quota check
	const ownerId = mode === 'replace' ? node.owner_id : locals.user.id;
	const [ownerRows] = await db.query<RowDataPacket[]>(
		'SELECT quota_bytes, used_bytes FROM users WHERE id = ? LIMIT 1',
		[ownerId]
	);
	const quota = Number(ownerRows[0]?.quota_bytes ?? 0);
	const used = Number(ownerRows[0]?.used_bytes ?? 0);
	const delta = mode === 'replace' ? buffer.byteLength - Number(node.size_bytes) : buffer.byteLength;
	if (quota >= 0 && used + delta > quota) {
		return json({ error: 'Espaço insuficiente na cota para salvar imagem.' }, { status: 413 });
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
		const usedBytes = await recalculateUserUsedBytes(ownerId);

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

	// Copy mode
	const newId = crypto.randomUUID();
	const baseNoExt = node.name.replace(/\.[^.]+$/, '');
	const copyName = `${baseNoExt} (recortada)${ext}`;
	const targetParent = permission === 'owner' ? node.parent_id : null;

	await db.query(
		`INSERT INTO storage_nodes (id, owner_id, parent_id, type, name, mime_type, size_bytes, disk_path, sha256)
		 VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?)`,
		[newId, locals.user.id, targetParent, copyName, outMime, sizeBytes, diskPath, sha256]
	);

	const usedBytes = await recalculateUserUsedBytes(locals.user.id);

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
