import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { getWorkspaceMembership } from '$lib/server/workspaces';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const workspaceId = url.searchParams.get('workspaceId')?.trim() || '';
	if (!workspaceId) {
		return json({ folders: [] });
	}

	const membership = await getWorkspaceMembership(locals.user.id, workspaceId);
	if (!membership) {
		return json({ error: 'Sem acesso a esta workspace.' }, { status: 403 });
	}

	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT id, parent_id, name
		 FROM storage_nodes
		 WHERE workspace_id = ? AND type = 'folder' AND is_trashed = 0
		 ORDER BY name ASC`,
		[workspaceId]
	);

	return json({
		folders: rows.map((r) => ({
			id: String(r.id),
			parent_id: r.parent_id ? String(r.parent_id) : null,
			name: String(r.name)
		}))
	});
};
