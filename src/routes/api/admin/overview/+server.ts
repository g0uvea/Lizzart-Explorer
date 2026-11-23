import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { getSystemSettings, mapUserRow } from '$lib/server/auth';
import { getStorageRoot } from '$lib/server/storage';
import { listAllWorkspacesAdmin } from '$lib/server/workspaces';
import { getPerformanceTelemetry, listPerformanceProfiles } from '$lib/server/performance';
import type { WorkspaceSummary } from '$lib/types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });
	if (locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}

	const db = getPool();

	const [[userStats], [wsStats], [nodeStats], [linkStats], [userRows], workspaces, [auditRows], settings] =
		await Promise.all([
			db.query<RowDataPacket[]>(
				`SELECT COUNT(*) AS total_users,
				        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admin_count,
				        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count
				 FROM users`
			),
			db.query<RowDataPacket[]>(
				`SELECT COUNT(*) AS total_workspaces,
				        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_workspaces,
				        COALESCE(SUM(used_bytes), 0) AS total_used_bytes
				 FROM workspaces`
			),
			db.query<RowDataPacket[]>(
				`SELECT SUM(CASE WHEN type = 'file' AND is_trashed = 0 THEN 1 ELSE 0 END) AS total_files,
				        SUM(CASE WHEN type = 'folder' AND is_trashed = 0 THEN 1 ELSE 0 END) AS total_folders,
				        SUM(CASE WHEN is_trashed = 1 THEN 1 ELSE 0 END) AS trashed_items
				 FROM storage_nodes`
			),
			db.query<RowDataPacket[]>(
				`SELECT COUNT(*) AS active_links, COALESCE(SUM(download_count), 0) AS total_downloads
				 FROM share_links WHERE is_active = 1`
			),
			db.query<RowDataPacket[]>(
				`SELECT id, username, first_name, last_name, role, is_active,
				        avatar_color, avatar_path, accent_color, layout_density,
				        default_view_mode, default_sort_by, default_sort_dir, language, country, totp_enabled, created_at
				 FROM users ORDER BY created_at DESC`
			),
			listAllWorkspacesAdmin(),
			db.query<RowDataPacket[]>(
				`SELECT a.id, a.user_id, a.action, a.target_type, a.target_id, a.details, a.ip_address, a.created_at,
				        u.username, CONCAT(u.first_name, ' ', u.last_name) AS full_name
				 FROM audit_logs a
				 LEFT JOIN users u ON u.id = a.user_id
				 ORDER BY a.id DESC
				 LIMIT 100`
			),
			getSystemSettings()
		]);

	// Attach workspace summaries onto each user row for quick overview in Users tab
	const wsByUser = new Map<string, WorkspaceSummary[]>();
	for (const ws of workspaces) {
		for (const m of ws.members) {
			const list = wsByUser.get(m.user_id) ?? [];
			list.push({
				id: ws.id,
				name: ws.name,
				slug: ws.slug,
				description: ws.description,
				color: ws.color,
				quota_bytes: ws.quota_bytes,
				used_bytes: ws.used_bytes,
				is_active: ws.is_active,
				role: m.role
			});
			wsByUser.set(m.user_id, list);
		}
	}

	const users = userRows.map((r) => {
		const u = mapUserRow(r);
		u.workspaces = wsByUser.get(u.id) ?? [];
		return u;
	});

	return json({
		stats: {
			total_users: Number(userStats[0]?.total_users ?? 0),
			admin_count: Number(userStats[0]?.admin_count ?? 0),
			active_count: Number(userStats[0]?.active_count ?? 0),
			total_workspaces: Number(wsStats[0]?.total_workspaces ?? 0),
			active_workspaces: Number(wsStats[0]?.active_workspaces ?? 0),
			total_used_bytes: Number(wsStats[0]?.total_used_bytes ?? 0),
			total_files: Number(nodeStats[0]?.total_files ?? 0),
			total_folders: Number(nodeStats[0]?.total_folders ?? 0),
			trashed_items: Number(nodeStats[0]?.trashed_items ?? 0),
			active_links: Number(linkStats[0]?.active_links ?? 0),
			total_downloads: Number(linkStats[0]?.total_downloads ?? 0),
			storage_root: getStorageRoot()
		},
		users,
		workspaces,
		auditLogs: auditRows.map((r) => ({
			id: Number(r.id),
			user_id: r.user_id ? String(r.user_id) : null,
			username: r.username ? String(r.username) : null,
			full_name: r.full_name ? String(r.full_name) : null,
			action: String(r.action),
			target_type: r.target_type ? String(r.target_type) : null,
			target_id: r.target_id ? String(r.target_id) : null,
			details: r.details ? String(r.details) : null,
			ip_address: r.ip_address ? String(r.ip_address) : null,
			created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
		})),
		settings,
		performance: {
			profiles: listPerformanceProfiles(),
			telemetry: getPerformanceTelemetry()
		}
	});
};
