import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { getEffectivePermission } from '$lib/server/permissions';
import { recalculateUserUsedBytes } from '$lib/server/storage';
import { logAudit } from '$lib/server/auth';

export const POST: RequestHandler = async ({ locals, params, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const { node, permission } = await getEffectivePermission(locals.user, params.id);
	if (!node || !permission || node.type !== 'file' || node.is_trashed) {
		return json({ error: 'Arquivo não encontrado ou sem permissão.' }, { status: 404 });
	}

	const db = getPool();
	const [uRows] = await db.query<RowDataPacket[]>(
		'SELECT quota_bytes, used_bytes FROM users WHERE id = ? LIMIT 1',
		[locals.user.id]
	);
	const quota = Number(uRows[0]?.quota_bytes ?? 0);
	const used = Number(uRows[0]?.used_bytes ?? 0);
	const size = Number(node.size_bytes ?? 0);

	if (quota >= 0 && used + size > quota) {
		return json({ error: 'Espaço insuficiente para duplicar este arquivo.' }, { status: 413 });
	}

	const dotIndex = node.name.lastIndexOf('.');
	const copyName =
		dotIndex > 0
			? `${node.name.slice(0, dotIndex)} (cópia)${node.name.slice(dotIndex)}`
			: `${node.name} (cópia)`;

	const newId = crypto.randomUUID();
	const targetParent = permission === 'owner' ? node.parent_id : null;

	await db.query(
		`INSERT INTO storage_nodes (id, owner_id, parent_id, type, name, mime_type, size_bytes, disk_path, sha256)
		 VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?)`,
		[newId, locals.user.id, targetParent, copyName, node.mime_type, size, node.disk_path, node.sha256]
	);

	const usedBytes = await recalculateUserUsedBytes(locals.user.id);

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
