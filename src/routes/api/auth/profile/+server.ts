import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { hashPassword, verifyPassword } from '$lib/server/crypto';
import { logAudit, mapUserRow } from '$lib/server/auth';

export const PATCH: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const body = await request.json().catch(() => null);
	const db = getPool();

	if (body?.currentPassword && body?.newPassword) {
		const newPassword = String(body.newPassword);
		if (newPassword.length < 6) {
			return json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
		}
		const [rows] = await db.query<RowDataPacket[]>(
			'SELECT password_hash FROM users WHERE id = ? LIMIT 1',
			[locals.user.id]
		);
		const ok = await verifyPassword(String(body.currentPassword), String(rows[0]?.password_hash || ''));
		if (!ok) {
			return json({ error: 'Senha atual incorreta.' }, { status: 400 });
		}
		const newHash = await hashPassword(newPassword);
		await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, locals.user.id]);
		await logAudit({
			userId: locals.user.id,
			action: 'profile.password_change',
			targetType: 'user',
			targetId: locals.user.id,
			details: 'Senha alterada pelo próprio usuário',
			ipAddress: getClientAddress()
		});
		return json({ ok: true });
	}

	const name = String(body?.name ?? locals.user.name).trim();
	const avatarColor = String(body?.avatar_color ?? locals.user.avatar_color).trim();

	if (name.length < 2) {
		return json({ error: 'Nome inválido.' }, { status: 400 });
	}

	await db.query('UPDATE users SET name = ?, avatar_color = ? WHERE id = ?', [
		name,
		avatarColor,
		locals.user.id
	]);

	const [updated] = await db.query<RowDataPacket[]>(
		'SELECT id, name, email, role, quota_bytes, used_bytes, is_active, avatar_color, created_at FROM users WHERE id = ?',
		[locals.user.id]
	);

	return json({ user: mapUserRow(updated[0]) });
};
