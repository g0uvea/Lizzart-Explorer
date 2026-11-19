import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { getSystemSettings, mapUserRow } from '$lib/server/auth';
import { getStorageRoot } from '$lib/server/storage';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });
	if (locals.user.role !== 'admin') return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });

	const db = getPool();

	const [[userStats], [nodeStats], [linkStats], [userRows], [auditRows], settings] = await Promise.all([
		db.query<RowDataPacket[]>(
			`SELECT COUNT(*) AS total_users,
			        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admin_count,
			        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
			        COALESCE(SUM(used_bytes), 0) AS total_used_bytes
			 FROM users`
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
			`SELECT id, name, email, role, quota_bytes, used_bytes, is_active, avatar_color, created_at
			 FROM users ORDER BY created_at DESC`
		),
		db.query<RowDataPacket[]>(
			`SELECT a.id, a.user_id, a.action, a.target_type, a.target_id, a.details, a.ip_address, a.created_at,
			        u.name AS user_name, u.email AS user_email
			 FROM audit_logs a
			 LEFT JOIN users u ON u.id = a.user_id
			 ORDER BY a.id DESC
			 LIMIT 80`
		),
		getSystemSettings()
	]);

	return json({
		stats: {
			total_users: Number(userStats[0]?.total_users ?? 0),
			admin_count: Number(userStats[0]?.admin_count ?? 0),
			active_count: Number(userStats[0]?.active_count ?? 0),
			total_used_bytes: Number(userStats[0]?.total_used_bytes ?? 0),
			total_files: Number(nodeStats[0]?.total_files ?? 0),
			total_folders: Number(nodeStats[0]?.total_folders ?? 0),
			trashed_items: Number(nodeStats[0]?.trashed_items ?? 0),
			active_links: Number(linkStats[0]?.active_links ?? 0),
			total_downloads: Number(linkStats[0]?.total_downloads ?? 0),
			storage_root: getStorageRoot()
		},
		users: userRows.map(mapUserRow),
		auditLogs: auditRows.map((r) => ({
			id: Number(r.id),
			user_id: r.user_id ? String(r.user_id) : null,
			user_name: r.user_name ? String(r.user_name) : null,
			user_email: r.user_email ? String(r.user_email) : null,
			action: String(r.action),
			target_type: r.target_type ? String(r.target_type) : null,
			target_id: r.target_id ? String(r.target_id) : null,
			details: r.details ? String(r.details) : null,
			ip_address: r.ip_address ? String(r.ip_address) : null,
			created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
		})),
		settings
	});
};
