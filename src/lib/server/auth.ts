import type { Cookies } from '@sveltejs/kit';
import type { RowDataPacket } from 'mysql2/promise';
import { ensureDatabaseReady, getPool } from '$lib/server/db';
import { generateToken } from '$lib/server/crypto';
import type { SafeUser, SystemSettings } from '$lib/types';

export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'lizzart_session';
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 7);

export const MIN_USER_QUOTA_GB = 10;

export function normalizeUsername(raw: string): string {
	return raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

export function isValidUsername(username: string): boolean {
	return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(username);
}

export function mapUserRow(row: RowDataPacket): SafeUser {
	const first = String(row.first_name || '').trim();
	const last = String(row.last_name || '').trim();
	const full = `${first} ${last}`.trim() || String(row.username);

	return {
		id: String(row.id),
		username: String(row.username),
		first_name: first,
		last_name: last,
		full_name: full,
		role: row.role === 'admin' ? 'admin' : 'user',
		quota_bytes: Number(row.quota_bytes),
		used_bytes: Number(row.used_bytes),
		is_active: Boolean(row.is_active),
		avatar_color: String(row.avatar_color || '#10b981'),
		avatar_url: row.avatar_path ? `/api/auth/avatar/${row.id}?v=${encodeURIComponent(String(row.avatar_path))}` : null,
		accent_color: String(row.accent_color || '#10b981'),
		layout_density: row.layout_density === 'compact' ? 'compact' : 'normal',
		default_view_mode: row.default_view_mode === 'list' ? 'list' : 'grid',
		default_sort_by:
			row.default_sort_by === 'date' || row.default_sort_by === 'size'
				? row.default_sort_by
				: 'name',
		default_sort_dir: row.default_sort_dir === 'desc' ? 'desc' : 'asc',
		totp_enabled: Boolean(row.totp_enabled),
		created_at:
			row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
	};
}

export async function createSession(
	userId: string,
	ipAddress: string | null,
	userAgent: string | null
): Promise<{ sessionId: string; expiresAt: Date }> {
	await ensureDatabaseReady();
	const db = getPool();
	const sessionId = generateToken(48);
	const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

	await db.query(
		`INSERT INTO sessions (id, user_id, ip_address, user_agent, expires_at)
		 VALUES (?, ?, ?, ?, ?)`,
		[sessionId, userId, ipAddress, userAgent?.slice(0, 250) ?? null, expiresAt]
	);

	return { sessionId, expiresAt };
}

export function setSessionCookie(cookies: Cookies, sessionId: string, expiresAt: Date): void {
	cookies.set(SESSION_COOKIE_NAME, sessionId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === 'true',
		expires: expiresAt
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
}

export async function validateSession(sessionId: string): Promise<SafeUser | null> {
	await ensureDatabaseReady();
	const db = getPool();

	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT u.id, u.username, u.first_name, u.last_name, u.role, u.quota_bytes, u.used_bytes,
		        u.is_active, u.avatar_color, u.avatar_path, u.accent_color, u.layout_density,
		        u.default_view_mode, u.default_sort_by, u.default_sort_dir, u.totp_enabled, u.created_at, s.expires_at
		 FROM sessions s
		 INNER JOIN users u ON u.id = s.user_id
		 WHERE s.id = ?
		 LIMIT 1`,
		[sessionId]
	);

	if (rows.length === 0) return null;

	const row = rows[0];
	const expiresAt = new Date(row.expires_at);
	if (expiresAt.getTime() <= Date.now()) {
		await db.query('DELETE FROM sessions WHERE id = ?', [sessionId]);
		return null;
	}

	if (!row.is_active) {
		return null;
	}

	return mapUserRow(row);
}

export async function invalidateSession(sessionId: string): Promise<void> {
	const db = getPool();
	await db.query('DELETE FROM sessions WHERE id = ?', [sessionId]);
}

export async function logAudit(params: {
	userId?: string | null;
	action: string;
	targetType?: string | null;
	targetId?: string | null;
	details?: string | null;
	ipAddress?: string | null;
}): Promise<void> {
	try {
		const db = getPool();
		await db.query(
			`INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[
				params.userId ?? null,
				params.action,
				params.targetType ?? null,
				params.targetId ?? null,
				params.details ?? null,
				params.ipAddress ?? null
			]
		);
	} catch {
		// Audit logging must not crash user actions
	}
}

export async function getSystemSettings(): Promise<SystemSettings> {
	await ensureDatabaseReady();
	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>('SELECT setting_key, setting_value FROM system_settings');
	const map = new Map<string, string>();
	for (const r of rows) {
		map.set(String(r.setting_key), String(r.setting_value));
	}

	return {
		default_quota_gb: Math.max(MIN_USER_QUOTA_GB, Number(map.get('default_quota_gb') ?? 10) || 10),
		max_upload_mb: Number(map.get('max_upload_mb') ?? 10240) || 10240
	};
}
