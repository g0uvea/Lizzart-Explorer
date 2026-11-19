import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT id, parent_id, name
		 FROM storage_nodes
		 WHERE owner_id = ? AND type = 'folder' AND is_trashed = 0
		 ORDER BY name ASC`,
		[locals.user.id]
	);

	return json({
		folders: rows.map((r) => ({
			id: String(r.id),
			parent_id: r.parent_id ? String(r.parent_id) : null,
			name: String(r.name)
		}))
	});
};
