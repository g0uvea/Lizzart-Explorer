import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { getEffectivePermission } from '$lib/server/permissions';
import {
	getWorkspaceMembership,
	recalculateWorkspaceUsedBytes
} from '$lib/server/workspaces';
import { logAudit } from '$lib/server/auth';

export const POST: RequestHandler = async ({ locals, params, request, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const { node, permission } = await getEffectivePermission(locals.user, params.id);
	if (!node || !permission || node.type !== 'file' || node.is_trashed) {
		return json({ error: 'Arquivo não encontrado ou sem permissão.' }, { status: 404 });
	}

	const body = await request.json().catch(() => ({}));
	let targetWorkspaceId =
		typeof body?.workspaceId === 'string' && body.workspaceId.trim()
			? body.workspaceId.trim()
			: node.workspace_id;

	const membership = await getWorkspaceMembership(locals.user.id, targetWorkspaceId);
	if (!membership || membership.role === 'viewer') {
		return json(
			{ error: 'Sem permissão de escrita na workspace de destino para duplicar.' },
			{ status: 403 }
		);
	}

	const db = getPool();
	const [wRows] = await db.query<RowDataPacket[]>(
		'SELECT quota_bytes, used_bytes FROM workspaces WHERE id = ? LIMIT 1',
		[targetWorkspaceId]
	);
	const quota = Number(wRows[0]?.quota_bytes ?? 0);
	const used = Number(wRows[0]?.used_bytes ?? 0);
	const size = Number(node.size_bytes ?? 0);

	if (quota >= 0 && used + size > quota) {
		return json(
			{ error: 'Espaço insuficiente na cota da workspace para duplicar este arquivo.' },
			{ status: 413 }
		);
	}

	const dotIndex = node.name.lastIndexOf('.');
	const copyName =
		dotIndex > 0
			? `${node.name.slice(0, dotIndex)} (cópia)${node.name.slice(dotIndex)}`
			: `${node.name} (cópia)`;

	const newId = crypto.randomUUID();
	const targetParent = targetWorkspaceId === node.workspace_id ? node.parent_id : null;

	await db.query(
		`INSERT INTO storage_nodes (id, workspace_id, created_by, parent_id, type, name, mime_type, size_bytes, disk_path, sha256)
		 VALUES (?, ?, ?, ?, 'file', ?, ?, ?, ?, ?)`,
		[
			newId,
			targetWorkspaceId,
			locals.user.id,
			targetParent,
			copyName,
			node.mime_type,
			size,
			node.disk_path,
			node.sha256
		]
	);

	const usedBytes = await recalculateWorkspaceUsedBytes(targetWorkspaceId);

	await logAudit({
		userId: locals.user.id,
		action: 'file.copy',
		targetType: 'file',
		targetId: newId,
		details: `Arquivo duplicado: ${copyName}`,
		ipAddress: getClientAddress()
	});

	return json({ id: newId, name: copyName, used_bytes: usedBytes }, { status: 201 });
};
