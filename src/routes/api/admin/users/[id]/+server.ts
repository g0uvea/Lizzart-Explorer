import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { hashPassword } from '$lib/server/crypto';
import { deleteDiskBlobIfUnreferenced } from '$lib/server/storage';
import { logAudit } from '$lib/server/auth';

export const PATCH: RequestHandler = async ({ locals, params, request, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso negado.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Dados inválidos.' }, { status: 400 });

	const db = getPool();
	const targetId = params.id;

	if (targetId === locals.user.id && (body.role === 'user' || body.is_active === false)) {
		return json({ error: 'Você não pode rebaixar ou desativar sua própria conta.' }, { status: 400 });
	}

	const updates: string[] = [];
	const values: unknown[] = [];

	if (typeof body.name === 'string' && body.name.trim().length >= 2) {
		updates.push('name = ?');
		values.push(body.name.trim());
	}
	if (body.role === 'admin' || body.role === 'user') {
		updates.push('role = ?');
		values.push(body.role);
	}
	if (typeof body.is_active === 'boolean') {
		updates.push('is_active = ?');
		values.push(body.is_active ? 1 : 0);
	}
	if (body.quota_gb !== undefined) {
		const gb = Number(body.quota_gb);
		updates.push('quota_bytes = ?');
		values.push(gb < 0 ? -1 : Math.round(gb * 1024 * 1024 * 1024));
	}
	if (typeof body.new_password === 'string' && body.new_password.length >= 6) {
		const hash = await hashPassword(body.new_password);
		updates.push('password_hash = ?');
		values.push(hash);
	}

	if (updates.length === 0) {
		return json({ error: 'Nenhuma alteração fornecida.' }, { status: 400 });
	}

	values.push(targetId);
	await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

	if (body.is_active === false) {
		await db.query('DELETE FROM sessions WHERE user_id = ?', [targetId]);
	}

	await logAudit({
		userId: locals.user.id,
		action: 'admin.user_update',
		targetType: 'user',
		targetId,
		details: `Conta atualizada pelo admin`,
		ipAddress: getClientAddress()
	});

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso negado.' }, { status: 403 });
	}

	if (params.id === locals.user.id) {
		return json({ error: 'Você não pode excluir sua própria conta.' }, { status: 400 });
	}

	const db = getPool();
	const [fileRows] = await db.query<RowDataPacket[]>(
		'SELECT disk_path FROM storage_nodes WHERE owner_id = ? AND disk_path IS NOT NULL',
		[params.id]
	);
	const diskPaths = fileRows.map((r) => String(r.disk_path));

	await db.query('DELETE FROM users WHERE id = ?', [params.id]);

	for (const dp of new Set(diskPaths)) {
		await deleteDiskBlobIfUnreferenced(dp);
	}

	await logAudit({
		userId: locals.user.id,
		action: 'admin.user_delete',
		targetType: 'user',
		targetId: params.id,
		details: `Usuário excluído e ${diskPaths.length} arquivos limpos`,
		ipAddress: getClientAddress()
	});

	return json({ ok: true });
};
