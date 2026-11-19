import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { hashPassword, verifyPassword } from '$lib/server/crypto';
import { logAudit, mapUserRow } from '$lib/server/auth';

export const PATCH: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Dados inválidos.' }, { status: 400 });
	const db = getPool();

	if (body.currentPassword && body.newPassword) {
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

	const firstName =
		body.first_name !== undefined ? String(body.first_name).trim() : locals.user.first_name;
	const lastName =
		body.last_name !== undefined ? String(body.last_name).trim() : locals.user.last_name;
	const avatarColor =
		typeof body.avatar_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.avatar_color)
			? body.avatar_color
			: locals.user.avatar_color;
	const accentColor =
		typeof body.accent_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.accent_color)
			? body.accent_color
			: locals.user.accent_color;
	const layoutDensity =
		body.layout_density === 'compact' || body.layout_density === 'normal'
			? body.layout_density
			: locals.user.layout_density;
	const defaultViewMode =
		body.default_view_mode === 'grid' || body.default_view_mode === 'list'
			? body.default_view_mode
			: locals.user.default_view_mode;
	const defaultSortBy =
		body.default_sort_by === 'name' ||
		body.default_sort_by === 'date' ||
		body.default_sort_by === 'size'
			? body.default_sort_by
			: locals.user.default_sort_by;
	const defaultSortDir =
		body.default_sort_dir === 'asc' || body.default_sort_dir === 'desc'
			? body.default_sort_dir
			: locals.user.default_sort_dir;

	if (firstName.length < 2 || lastName.length < 2) {
		return json({ error: 'Nome e Sobrenome devem ter pelo menos 2 caracteres.' }, { status: 400 });
	}

	await db.query(
		`UPDATE users
		 SET first_name = ?, last_name = ?, avatar_color = ?, accent_color = ?,
		     layout_density = ?, default_view_mode = ?, default_sort_by = ?, default_sort_dir = ?
		 WHERE id = ?`,
		[
			firstName,
			lastName,
			avatarColor,
			accentColor,
			layoutDensity,
			defaultViewMode,
			defaultSortBy,
			defaultSortDir,
			locals.user.id
		]
	);

	const [updated] = await db.query<RowDataPacket[]>(
		`SELECT id, username, first_name, last_name, role, quota_bytes, used_bytes, is_active,
		        avatar_color, avatar_path, accent_color, layout_density,
		        default_view_mode, default_sort_by, default_sort_dir, totp_enabled, created_at
		 FROM users WHERE id = ?`,
		[locals.user.id]
	);

	return json({ user: mapUserRow(updated[0]) });
};
