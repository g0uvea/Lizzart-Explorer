import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { invalidateUserAuthCache, logAudit } from '$lib/server/auth';
import { normalizeWorkspaceRole } from '$lib/server/workspaces';

export const POST: RequestHandler = async ({ locals, params, request, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	const userId = typeof body?.user_id === 'string' ? body.user_id.trim() : '';
	const role = normalizeWorkspaceRole(body?.role);

	if (!userId) {
		return json({ error: 'Selecione um usuário para conectar.' }, { status: 400 });
	}

	const db = getPool();
	const [[wsRows], [userRows]] = await Promise.all([
		db.query<RowDataPacket[]>('SELECT id, name FROM workspaces WHERE id = ? LIMIT 1', [params.id]),
		db.query<RowDataPacket[]>('SELECT id, username FROM users WHERE id = ? LIMIT 1', [userId])
	]);

	if (wsRows.length === 0) {
		return json({ error: 'Workspace não encontrada.' }, { status: 404 });
	}
	if (userRows.length === 0) {
		return json({ error: 'Usuário não encontrado.' }, { status: 404 });
	}

	const memberId = crypto.randomUUID();
	await db.query(
		`INSERT INTO workspace_members (id, workspace_id, user_id, role, assigned_by)
		 VALUES (?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE role = VALUES(role), assigned_by = VALUES(assigned_by)`,
		[memberId, params.id, userId, role, locals.user.id]
	);

	invalidateUserAuthCache(userId);

	await logAudit({
		userId: locals.user.id,
		action: 'admin.workspace_member_connect',
		targetType: 'workspace',
		targetId: params.id,
		details: `@${userRows[0].username} conectado à workspace "${wsRows[0].name}" como ${role}`,
		ipAddress: getClientAddress()
	});

	return json({ ok: true }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ locals, params, url, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}

	const userId = url.searchParams.get('userId')?.trim() || '';
	if (!userId) {
		return json({ error: 'Informe userId para desconectar.' }, { status: 400 });
	}

	const db = getPool();
	const [[wsRows], [userRows]] = await Promise.all([
		db.query<RowDataPacket[]>('SELECT name FROM workspaces WHERE id = ? LIMIT 1', [params.id]),
		db.query<RowDataPacket[]>('SELECT username FROM users WHERE id = ? LIMIT 1', [userId])
	]);

	await db.query('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?', [
		params.id,
		userId
	]);

	invalidateUserAuthCache(userId);

	await logAudit({
		userId: locals.user.id,
		action: 'admin.workspace_member_disconnect',
		targetType: 'workspace',
		targetId: params.id,
		details: `@${userRows[0]?.username || userId} desconectado da workspace "${wsRows[0]?.name || params.id}" (arquivos preservados)`,
		ipAddress: getClientAddress()
	});

	return json({ ok: true });
};
