import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import type { WorkspaceAdminRecord, WorkspaceMemberRecord, WorkspaceRole, WorkspaceSummary } from '$lib/types';

export function slugifyWorkspace(name: string): string {
	const base = name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 56);
	return base || 'workspace';
}

export function normalizeWorkspaceRole(raw: unknown): WorkspaceRole {
	if (raw === 'manager' || raw === 'viewer') return raw;
	return 'editor';
}

export async function getUserWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT w.id, w.name, w.slug, w.description, w.color, w.quota_bytes, w.used_bytes, w.is_active,
		        wm.role
		 FROM workspace_members wm
		 INNER JOIN workspaces w ON w.id = wm.workspace_id
		 WHERE wm.user_id = ? AND w.is_active = 1
		 ORDER BY w.name ASC`,
		[userId]
	);

	return rows.map((r) => ({
		id: String(r.id),
		name: String(r.name),
		slug: String(r.slug),
		description: r.description ? String(r.description) : null,
		color: String(r.color || '#10b981'),
		quota_bytes: Number(r.quota_bytes ?? 0),
		used_bytes: Number(r.used_bytes ?? 0),
		is_active: Boolean(r.is_active),
		role: normalizeWorkspaceRole(r.role)
	}));
}

export async function getWorkspaceMembership(
	userId: string,
	workspaceId: string
): Promise<{ workspace: WorkspaceSummary; role: WorkspaceRole } | null> {
	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT w.id, w.name, w.slug, w.description, w.color, w.quota_bytes, w.used_bytes, w.is_active,
		        wm.role
		 FROM workspace_members wm
		 INNER JOIN workspaces w ON w.id = wm.workspace_id
		 WHERE wm.user_id = ? AND w.id = ? AND w.is_active = 1
		 LIMIT 1`,
		[userId, workspaceId]
	);

	if (rows.length === 0) return null;
	const r = rows[0];
	const role = normalizeWorkspaceRole(r.role);
	return {
		role,
		workspace: {
			id: String(r.id),
			name: String(r.name),
			slug: String(r.slug),
			description: r.description ? String(r.description) : null,
			color: String(r.color || '#10b981'),
			quota_bytes: Number(r.quota_bytes ?? 0),
			used_bytes: Number(r.used_bytes ?? 0),
			is_active: Boolean(r.is_active),
			role
		}
	};
}

export async function recalculateWorkspaceUsedBytes(workspaceId: string): Promise<number> {
	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT COALESCE(SUM(size_bytes), 0) AS total
		 FROM storage_nodes
		 WHERE workspace_id = ? AND type = 'file'`,
		[workspaceId]
	);
	const total = Number(rows[0]?.total ?? 0);
	await db.query('UPDATE workspaces SET used_bytes = ? WHERE id = ?', [total, workspaceId]);
	return total;
}

export async function listAllWorkspacesAdmin(): Promise<WorkspaceAdminRecord[]> {
	const db = getPool();
	const [[wsRows], [memberRows]] = await Promise.all([
		db.query<RowDataPacket[]>(
			`SELECT w.*,
			        (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = w.id) AS member_count,
			        (SELECT COUNT(*) FROM storage_nodes sn WHERE sn.workspace_id = w.id AND sn.type = 'file' AND sn.is_trashed = 0) AS file_count,
			        (SELECT COUNT(*) FROM storage_nodes sn WHERE sn.workspace_id = w.id AND sn.type = 'folder' AND sn.is_trashed = 0) AS folder_count
			 FROM workspaces w
			 ORDER BY w.created_at DESC`
		),
		db.query<RowDataPacket[]>(
			`SELECT wm.id, wm.workspace_id, wm.user_id, wm.role, wm.created_at,
			        u.username, CONCAT(u.first_name, ' ', u.last_name) AS full_name,
			        u.avatar_color, u.avatar_path, u.role AS user_role
			 FROM workspace_members wm
			 INNER JOIN users u ON u.id = wm.user_id
			 ORDER BY wm.created_at ASC`
		)
	]);

	const membersByWs = new Map<string, WorkspaceMemberRecord[]>();
	for (const r of memberRows) {
		const wsId = String(r.workspace_id);
		const list = membersByWs.get(wsId) ?? [];
		list.push({
			id: String(r.id),
			workspace_id: wsId,
			user_id: String(r.user_id),
			username: String(r.username),
			full_name: String(r.full_name || r.username),
			avatar_color: String(r.avatar_color || '#10b981'),
			avatar_url: r.avatar_path
				? `/api/auth/avatar/${r.user_id}?v=${encodeURIComponent(String(r.avatar_path))}`
				: null,
			user_role: r.user_role === 'admin' ? 'admin' : 'user',
			role: normalizeWorkspaceRole(r.role),
			created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
		});
		membersByWs.set(wsId, list);
	}

	return wsRows.map((r) => {
		const id = String(r.id);
		return {
			id,
			name: String(r.name),
			slug: String(r.slug),
			description: r.description ? String(r.description) : null,
			color: String(r.color || '#10b981'),
			quota_bytes: Number(r.quota_bytes ?? 0),
			used_bytes: Number(r.used_bytes ?? 0),
			is_active: Boolean(r.is_active),
			member_count: Number(r.member_count ?? 0),
			file_count: Number(r.file_count ?? 0),
			folder_count: Number(r.folder_count ?? 0),
			created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
			updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
			members: membersByWs.get(id) ?? []
		};
	});
}

export function workspaceRoleToEffectivePermission(role: WorkspaceRole): 'owner' | 'editor' | 'viewer' {
	if (role === 'manager') return 'owner';
	if (role === 'editor') return 'editor';
	return 'viewer';
}
