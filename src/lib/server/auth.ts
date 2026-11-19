import type { Cookies } from '@sveltejs/kit';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { ensureDatabaseReady, getPool } from '$lib/server/db';
import { generateToken } from '$lib/server/crypto';
import { sha256Hex, signAccessJwt, verifyAccessJwt } from '$lib/server/jwt';
import type { SafeUser, SystemSettings } from '$lib/types';

export const ACCESS_COOKIE_NAME = 'lizzart_access';
export const REFRESH_COOKIE_NAME = 'lizzart_refresh';
const ACCESS_TTL_SECONDS = 15 * 60; // 15 minutes
const REFRESH_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 7);

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
		avatar_url: row.avatar_path
			? `/api/auth/avatar/${row.id}?v=${encodeURIComponent(String(row.avatar_path))}`
			: null,
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

const USER_SELECT_COLS = `
	u.id, u.username, u.first_name, u.last_name, u.role, u.quota_bytes, u.used_bytes,
	u.is_active, u.avatar_color, u.avatar_path, u.accent_color, u.layout_density,
	u.default_view_mode, u.default_sort_by, u.default_sort_dir, u.totp_enabled, u.created_at
`;

export async function createSession(
	userId: string,
	role: 'admin' | 'user',
	ipAddress: string | null,
	userAgent: string | null
): Promise<{ sessionId: string; accessJwt: string; refreshToken: string; expiresAt: Date }> {
	await ensureDatabaseReady();
	const db = getPool();

	const sessionId = crypto.randomUUID();
	const refreshToken = generateToken(48);
	const refreshHash = sha256Hex(refreshToken);
	const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

	await db.query(
		`INSERT INTO sessions (id, user_id, refresh_token_hash, ip_address, user_agent, last_used_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
		[sessionId, userId, refreshHash, ipAddress, userAgent?.slice(0, 250) ?? null, expiresAt]
	);

	const accessJwt = await signAccessJwt({ sub: userId, sid: sessionId, role }, ACCESS_TTL_SECONDS);

	return { sessionId, accessJwt, refreshToken, expiresAt };
}

export function setAuthCookies(
	cookies: Cookies,
	accessJwt: string,
	refreshToken: string,
	refreshExpiresAt: Date
): void {
	const isSecure = process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === 'true';

	cookies.set(ACCESS_COOKIE_NAME, accessJwt, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: isSecure,
		maxAge: ACCESS_TTL_SECONDS
	});

	cookies.set(REFRESH_COOKIE_NAME, refreshToken, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: isSecure,
		expires: refreshExpiresAt
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(ACCESS_COOKIE_NAME, { path: '/' });
	cookies.delete(REFRESH_COOKIE_NAME, { path: '/' });
	// Clean legacy cookie name if present
	cookies.delete('lizzart_session', { path: '/' });
}

/**
 * Validates JWT access token (fast path) and automatically rotates refresh token
 * against MariaDB when the short-lived JWT expires.
 */
export async function authenticateRequest(
	cookies: Cookies
): Promise<{ user: SafeUser; sessionId: string } | null> {
	await ensureDatabaseReady();
	const db = getPool();

	const accessToken = cookies.get(ACCESS_COOKIE_NAME);
	if (accessToken) {
		const payload = await verifyAccessJwt(accessToken);
		if (payload) {
			// Verify session was not revoked and user is still active
			const [rows] = await db.query<RowDataPacket[]>(
				`SELECT ${USER_SELECT_COLS}, s.id AS sid, s.expires_at
				 FROM sessions s
				 INNER JOIN users u ON u.id = s.user_id
				 WHERE s.id = ? AND u.id = ?
				 LIMIT 1`,
				[payload.sid, payload.sub]
			);

			if (rows.length > 0 && rows[0].is_active && new Date(rows[0].expires_at).getTime() > Date.now()) {
				return {
					user: mapUserRow(rows[0]),
					sessionId: String(rows[0].sid)
				};
			}
		}
	}

	// Fallback: validate & rotate refresh token from MariaDB
	const refreshToken = cookies.get(REFRESH_COOKIE_NAME);
	if (!refreshToken) return null;

	const refreshHash = sha256Hex(refreshToken);
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT ${USER_SELECT_COLS}, s.id AS sid, s.expires_at
		 FROM sessions s
		 INNER JOIN users u ON u.id = s.user_id
		 WHERE s.refresh_token_hash = ?
		 LIMIT 1`,
		[refreshHash]
	);

	if (rows.length === 0) return null;

	const row = rows[0];
	const expiresAt = new Date(row.expires_at);
	if (expiresAt.getTime() <= Date.now() || !row.is_active) {
		await db.query('DELETE FROM sessions WHERE id = ?', [row.sid]);
		return null;
	}

	// Rotate refresh token + mint fresh short-lived HS256 JWT
	const user = mapUserRow(row);
	const newRefreshToken = generateToken(48);
	const newRefreshHash = sha256Hex(newRefreshToken);
	const newExpiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

	await db.query(
		'UPDATE sessions SET refresh_token_hash = ?, last_used_at = CURRENT_TIMESTAMP, expires_at = ? WHERE id = ?',
		[newRefreshHash, newExpiresAt, row.sid]
	);

	const newAccessJwt = await signAccessJwt(
		{ sub: user.id, sid: String(row.sid), role: user.role },
		ACCESS_TTL_SECONDS
	);
	setAuthCookies(cookies, newAccessJwt, newRefreshToken, newExpiresAt);

	return { user, sessionId: String(row.sid) };
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
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT setting_key, setting_value FROM system_settings'
	);
	const map = new Map<string, string>();
	for (const r of rows) {
		map.set(String(r.setting_key), String(r.setting_value));
	}

	return {
		default_quota_gb: Math.max(MIN_USER_QUOTA_GB, Number(map.get('default_quota_gb') ?? 10) || 10),
		max_upload_mb: Number(map.get('max_upload_mb') ?? 10240) || 10240
	};
}
