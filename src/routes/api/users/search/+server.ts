import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const q = (url.searchParams.get('q') || '').trim().toLowerCase();
	const db = getPool();

	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT id, username, first_name, last_name, avatar_color, avatar_path
		 FROM users
		 WHERE is_active = 1 AND id != ?
		   AND (username LIKE ? OR first_name LIKE ? OR last_name LIKE ?)
		 ORDER BY username ASC
		 LIMIT 10`,
		[locals.user.id, `%${q}%`, `%${q}%`, `%${q}%`]
	);

	return json({
		users: rows.map((r) => ({
			id: String(r.id),
			username: String(r.username),
			full_name: `${r.first_name} ${r.last_name}`.trim(),
			avatar_color: String(r.avatar_color || '#10b981'),
			avatar_url: r.avatar_path
				? `/api/auth/avatar/${r.id}?v=${encodeURIComponent(String(r.avatar_path))}`
				: null
		}))
	});
};
