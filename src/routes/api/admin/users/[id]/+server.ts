import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import fsp from 'node:fs/promises';
import { getPool } from '$lib/server/db';
import { hashPassword } from '$lib/server/crypto';
import { resolveDiskPath } from '$lib/server/storage';
import { invalidateUserAuthCache, logAudit } from '$lib/server/auth';

export const PATCH: RequestHandler = async ({ locals, params, request, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso negado.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Dados inválidos.' }, { status: 400 });

	const db = getPool();
	const targetId = params.id;

	if (targetId === locals.user.id && (body.role === 'user' || body.is_active === false)) {
		return json(
			{ error: 'Você não pode rebaixar ou suspender sua própria conta.' },
			{ status: 400 }
		);
	}

	const updates: string[] = [];
	const values: unknown[] = [];

	if (typeof body.first_name === 'string' && body.first_name.trim().length >= 2) {
		updates.push('first_name = ?');
		values.push(body.first_name.trim());
	}
	if (typeof body.last_name === 'string' && body.last_name.trim().length >= 2) {
		updates.push('last_name = ?');
		values.push(body.last_name.trim());
	}
	if (body.role === 'admin' || body.role === 'user') {
		updates.push('role = ?');
		values.push(body.role);
	}
	if (typeof body.is_active === 'boolean') {
		updates.push('is_active = ?');
		values.push(body.is_active ? 1 : 0);
		if (body.is_active) {
			updates.push('failed_login_count = 0, locked_until = NULL');
		}
	}
	if (typeof body.new_password === 'string' && body.new_password.length >= 6) {
		const hash = await hashPassword(body.new_password);
		updates.push('password_hash = ?');
		values.push(hash);
	}
	if (body.reset_2fa === true) {
		updates.push('totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL');
	}

	if (updates.length === 0) {
		return json({ error: 'Nenhuma alteração fornecida.' }, { status: 400 });
	}

	values.push(targetId);
	await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

	if (body.is_active === false || (typeof body.new_password === 'string' && body.new_password.length >= 6)) {
		await db.query('DELETE FROM sessions WHERE user_id = ?', [targetId]);
	}
	invalidateUserAuthCache(targetId);

	await logAudit({
		userId: locals.user.id,
		action: 'admin.user_update',
		targetType: 'user',
		targetId,
		details: 'Conta atualizada pelo administrador',
		ipAddress: getClientAddress()
	});

	return json({ ok: true });
};

/**
 * Deletes ONLY the user account, sessions, avatar, and workspace membership links.
 * ALL workspaces and ALL files/folders remain 100% intact!
 */
export const DELETE: RequestHandler = async ({ locals, params, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso negado.' }, { status: 403 });
	}

	if (params.id === locals.user.id) {
		return json({ error: 'Você não pode excluir sua própria conta.' }, { status: 400 });
	}

	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT username, avatar_path FROM users WHERE id = ? LIMIT 1',
		[params.id]
	);
	if (rows.length === 0) {
		return json({ error: 'Usuário não encontrado.' }, { status: 404 });
	}
	const username = String(rows[0].username);
	const avatarPath = rows[0].avatar_path ? String(rows[0].avatar_path) : null;

	// Clean up incomplete upload temp files belonging to this user (never committed workspace files!)
	const [tempRows] = await db.query<RowDataPacket[]>(
		"SELECT temp_path FROM upload_sessions WHERE user_id = ? AND status = 'uploading'",
		[params.id]
	);
	for (const r of tempRows) {
		if (r.temp_path) {
			await fsp.unlink(resolveDiskPath(String(r.temp_path))).catch(() => {});
		}
	}

	// Deleting the user cascades ONLY sessions, workspace_members, node_permissions(user_id)
	// Workspaces, storage_nodes, and share_links stay intact (created_by becomes NULL)!
	await db.query('DELETE FROM users WHERE id = ?', [params.id]);
	invalidateUserAuthCache(params.id);

	if (avatarPath) {
		await fsp.unlink(resolveDiskPath(avatarPath)).catch(() => {});
	}

	await logAudit({
		userId: locals.user.id,
		action: 'admin.user_delete',
		targetType: 'user',
		targetId: params.id,
		details: `Usuário @${username} excluído — todas as workspaces e arquivos preservados`,
		ipAddress: getClientAddress()
	});

	return json({ ok: true });
};
