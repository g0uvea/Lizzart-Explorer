import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { getEffectivePermission } from '$lib/server/permissions';
import {
	getWorkspaceMembership,
	workspaceRoleToEffectivePermission
} from '$lib/server/workspaces';
import { getPerformanceConfig } from '$lib/server/performance';
import type { BreadcrumbItem, StorageNode } from '$lib/types';

function mapNode(row: RowDataPacket, permission: 'owner' | 'editor' | 'viewer' = 'owner'): StorageNode {
	const createdByName = row.created_by_name ? String(row.created_by_name).trim() : '';
	return {
		id: String(row.id),
		workspace_id: String(row.workspace_id),
		workspace_name: row.workspace_name ? String(row.workspace_name) : undefined,
		created_by: row.created_by ? String(row.created_by) : null,
		created_by_name: createdByName || undefined,
		created_by_username: row.created_by_username ? String(row.created_by_username) : undefined,
		parent_id: row.parent_id ? String(row.parent_id) : null,
		type: row.type === 'folder' ? 'folder' : 'file',
		name: String(row.name),
		mime_type: row.mime_type ? String(row.mime_type) : null,
		size_bytes: Number(row.size_bytes ?? 0),
		sha256: row.sha256 ? String(row.sha256) : null,
		is_starred: Boolean(row.is_starred),
		is_trashed: Boolean(row.is_trashed),
		trashed_at: row.trashed_at
			? row.trashed_at instanceof Date
				? row.trashed_at.toISOString()
				: String(row.trashed_at)
			: null,
		created_at:
			row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
		updated_at:
			row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
		permission,
		share_count: row.share_count !== undefined ? Number(row.share_count) : undefined,
		link_count: row.link_count !== undefined ? Number(row.link_count) : undefined
	};
}

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const db = getPool();
	const user = locals.user;
	const view = url.searchParams.get('view') || 'drive';
	const workspaceId = url.searchParams.get('workspaceId') || null;
	const parentId = url.searchParams.get('parentId') || null;
	const search = (url.searchParams.get('search') || '').trim();
	const sortBy = url.searchParams.get('sort') || 'name';
	const sortDir = url.searchParams.get('dir') === 'desc' ? 'DESC' : 'ASC';
	const listLimit = getPerformanceConfig().maxListLimit;

	const orderColumn =
		sortBy === 'size' ? 'n.size_bytes' : sortBy === 'date' ? 'n.updated_at' : 'n.name';
	const orderClause = `ORDER BY (n.type = 'folder') DESC, ${orderColumn} ${sortDir}`;

	const creatorSelect = `CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS created_by_name, u.username AS created_by_username, w.name AS workspace_name`;

	let nodes: StorageNode[] = [];
	const breadcrumbs: BreadcrumbItem[] = [];
	let currentPermission: 'owner' | 'editor' | 'viewer' = 'viewer';

	// Cross-workspace "Compartilhados comigo" view works even without a connected workspace
	if (view === 'shared') {
		if (!parentId) {
			const [rows] = await db.query<RowDataPacket[]>(
				`SELECT n.*, np.permission AS granted_perm, ${creatorSelect}
				 FROM node_permissions np
				 INNER JOIN storage_nodes n ON n.id = np.node_id
				 INNER JOIN workspaces w ON w.id = n.workspace_id
				 LEFT JOIN users u ON u.id = n.created_by
				 WHERE np.user_id = ? AND n.is_trashed = 0 AND n.is_note = 0 AND w.is_active = 1
				 ${orderClause}
				 LIMIT ?`,
				[user.id, listLimit]
			);
			nodes = rows.map((r) => mapNode(r, r.granted_perm === 'editor' ? 'editor' : 'viewer'));
			breadcrumbs.push({ id: null, name: 'Compartilhados comigo' });
			return json({ nodes, breadcrumbs, currentPermission: 'viewer', quota: null });
		}

		const { node: folder, permission } = await getEffectivePermission(user, parentId);
		if (!folder || !permission || folder.is_trashed) {
			return json(
				{ error: 'Pasta compartilhada não encontrada ou sem acesso.' },
				{ status: 403 }
			);
		}
		currentPermission = permission;

		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT n.*, ${creatorSelect}
			 FROM storage_nodes n
			 INNER JOIN workspaces w ON w.id = n.workspace_id
			 LEFT JOIN users u ON u.id = n.created_by
			 WHERE n.parent_id = ? AND n.is_trashed = 0 AND n.is_note = 0
			 ${orderClause}
			 LIMIT ?`,
			[parentId, listLimit]
		);
		nodes = rows.map((r) => mapNode(r, permission));

		const trail: BreadcrumbItem[] = [];
		let cursor: string | null = parentId;
		let guard = 0;
		while (cursor && guard < 32) {
			const { node: curNode, permission: curPerm } = await getEffectivePermission(user, cursor);
			if (!curNode || !curPerm) break;
			trail.unshift({ id: curNode.id, name: curNode.name });
			cursor = curNode.parent_id;
			guard++;
		}
		breadcrumbs.push({ id: null, name: 'Compartilhados comigo' }, ...trail);
		return json({ nodes, breadcrumbs, currentPermission, quota: null });
	}

	// All other views require an active workspace connected to this user
	if (!workspaceId) {
		return json({
			nodes: [],
			breadcrumbs: [{ id: null, name: 'Sem Workspace' }],
			currentPermission: 'viewer',
			quota: null,
			noWorkspace: true
		});
	}

	const membership = await getWorkspaceMembership(user.id, workspaceId);
	if (!membership) {
		return json({ error: 'Você não está conectado a esta workspace.' }, { status: 403 });
	}

	const ws = membership.workspace;
	const wsPerm = workspaceRoleToEffectivePermission(membership.role);
	currentPermission = wsPerm;
	const quota = {
		used_bytes: ws.used_bytes,
		quota_bytes: ws.quota_bytes
	};

	if (search) {
		const like = `%${search}%`;
		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT n.*, ${creatorSelect},
				(SELECT COUNT(*) FROM node_permissions np WHERE np.node_id = n.id) AS share_count,
				(SELECT COUNT(*) FROM share_links sl WHERE sl.node_id = n.id AND sl.is_active = 1) AS link_count
			 FROM storage_nodes n
			 INNER JOIN workspaces w ON w.id = n.workspace_id
			 LEFT JOIN users u ON u.id = n.created_by
			 WHERE n.workspace_id = ? AND n.is_trashed = 0 AND n.is_note = 0 AND n.name LIKE ?
			 ${orderClause}
			 LIMIT ?`,
			[ws.id, like, Math.min(200, listLimit)]
		);
		nodes = rows.map((r) => mapNode(r, wsPerm));
		breadcrumbs.push({ id: null, name: `Busca em ${ws.name}: "${search}"` });
		return json({ nodes, breadcrumbs, currentPermission, quota, workspace: ws });
	}

	if (view === 'starred') {
		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT n.*, ${creatorSelect},
				(SELECT COUNT(*) FROM node_permissions np WHERE np.node_id = n.id) AS share_count,
				(SELECT COUNT(*) FROM share_links sl WHERE sl.node_id = n.id AND sl.is_active = 1) AS link_count
			 FROM storage_nodes n
			 INNER JOIN workspaces w ON w.id = n.workspace_id
			 LEFT JOIN users u ON u.id = n.created_by
			 WHERE n.workspace_id = ? AND n.is_starred = 1 AND n.is_trashed = 0 AND n.is_note = 0
			 ${orderClause}
			 LIMIT ?`,
			[ws.id, listLimit]
		);
		nodes = rows.map((r) => mapNode(r, wsPerm));
		breadcrumbs.push({ id: null, name: 'Favoritos' });
		return json({ nodes, breadcrumbs, currentPermission, quota, workspace: ws });
	}

	if (view === 'recent') {
		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT n.*, ${creatorSelect},
				(SELECT COUNT(*) FROM node_permissions np WHERE np.node_id = n.id) AS share_count,
				(SELECT COUNT(*) FROM share_links sl WHERE sl.node_id = n.id AND sl.is_active = 1) AS link_count
			 FROM storage_nodes n
			 INNER JOIN workspaces w ON w.id = n.workspace_id
			 LEFT JOIN users u ON u.id = n.created_by
			 WHERE n.workspace_id = ? AND n.type = 'file' AND n.is_trashed = 0 AND n.is_note = 0
			 ORDER BY n.updated_at DESC
			 LIMIT 60`,
			[ws.id]
		);
		nodes = rows.map((r) => mapNode(r, wsPerm));
		breadcrumbs.push({ id: null, name: 'Recentes' });
		return json({ nodes, breadcrumbs, currentPermission, quota, workspace: ws });
	}

	if (view === 'trash') {
		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT n.*, ${creatorSelect}
			 FROM storage_nodes n
			 INNER JOIN workspaces w ON w.id = n.workspace_id
			 LEFT JOIN users u ON u.id = n.created_by
			 WHERE n.workspace_id = ? AND n.is_trashed = 1 AND n.is_note = 0
			 ORDER BY n.trashed_at DESC
			 LIMIT ?`,
			[ws.id, listLimit]
		);
		nodes = rows.map((r) => mapNode(r, wsPerm));
		breadcrumbs.push({ id: null, name: 'Lixeira' });
		return json({ nodes, breadcrumbs, currentPermission, quota, workspace: ws });
	}

	if (parentId) {
		const { node: folder, permission } = await getEffectivePermission(user, parentId);
		if (
			!folder ||
			!permission ||
			folder.workspace_id !== ws.id ||
			folder.type !== 'folder' ||
			folder.is_trashed
		) {
			return json({ error: 'Pasta não encontrada ou sem permissão.' }, { status: 404 });
		}
		currentPermission = permission;

		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT n.*, ${creatorSelect},
				(SELECT COUNT(*) FROM node_permissions np WHERE np.node_id = n.id) AS share_count,
				(SELECT COUNT(*) FROM share_links sl WHERE sl.node_id = n.id AND sl.is_active = 1) AS link_count
			 FROM storage_nodes n
			 INNER JOIN workspaces w ON w.id = n.workspace_id
			 LEFT JOIN users u ON u.id = n.created_by
			 WHERE n.workspace_id = ? AND n.parent_id = ? AND n.is_trashed = 0 AND n.is_note = 0
			 ${orderClause}
			 LIMIT ?`,
			[ws.id, parentId, listLimit]
		);
		nodes = rows.map((r) => mapNode(r, permission));

		const trail: BreadcrumbItem[] = [];
		let cursor: string | null = parentId;
		let guard = 0;
		while (cursor && guard < 32) {
			const [bRows]: [RowDataPacket[], unknown] = await db.query<RowDataPacket[]>(
				'SELECT id, name, parent_id FROM storage_nodes WHERE id = ? AND workspace_id = ? LIMIT 1',
				[cursor, ws.id]
			);
			if (bRows.length === 0) break;
			trail.unshift({ id: String(bRows[0].id), name: String(bRows[0].name) });
			cursor = bRows[0].parent_id ? String(bRows[0].parent_id) : null;
			guard++;
		}
		breadcrumbs.push({ id: null, name: ws.name }, ...trail);
		return json({ nodes, breadcrumbs, currentPermission, quota, workspace: ws });
	}

	// Workspace Root
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT n.*, ${creatorSelect},
			(SELECT COUNT(*) FROM node_permissions np WHERE np.node_id = n.id) AS share_count,
			(SELECT COUNT(*) FROM share_links sl WHERE sl.node_id = n.id AND sl.is_active = 1) AS link_count
		 FROM storage_nodes n
		 INNER JOIN workspaces w ON w.id = n.workspace_id
		 LEFT JOIN users u ON u.id = n.created_by
		 WHERE n.workspace_id = ? AND n.parent_id IS NULL AND n.is_trashed = 0 AND n.is_note = 0
		 ${orderClause}
		 LIMIT ?`,
		[ws.id, listLimit]
	);
	nodes = rows.map((r) => mapNode(r, wsPerm));
	breadcrumbs.push({ id: null, name: ws.name });

	return json({ nodes, breadcrumbs, currentPermission: wsPerm, quota, workspace: ws });
};
