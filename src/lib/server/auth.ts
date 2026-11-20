import type { Cookies } from '@sveltejs/kit';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { ensureDatabaseReady, getPool } from '$lib/server/db';
import { generateToken, hashOpaqueToken } from '$lib/server/crypto';
import {
	computeClientFingerprint,
	signAccessJwt,
	verifyAccessJwt
} from '$lib/server/jwt';
import {
	getActivePerformanceMode,
	getPerformanceConfig,
	isValidPerformanceMode,
	runtimeCache
} from '$lib/server/performance';
import { describeUserAgent } from '$lib/server/security';
import type { AutoBackupInterval, SafeUser, SystemSettings } from '$lib/types';

export const ACCESS_COOKIE_NAME = 'lizzart_access';
export const REFRESH_COOKIE_NAME = 'lizzart_refresh';
const ACCESS_TTL_SECONDS = 15 * 60; // 15 minutes
const REFRESH_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 7);
const ROTATION_GRACE_MS = 10_000; // 10s grace for concurrent multi-tab requests during refresh

export const MIN_WORKSPACE_QUOTA_GB = 10;

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
	u.id, u.username, u.first_name, u.last_name, u.role,
	u.is_active, u.avatar_color, u.avatar_path, u.accent_color, u.layout_density,
	u.default_view_mode, u.default_sort_by, u.default_sort_dir, u.totp_enabled, u.created_at
`;

export function invalidateUserAuthCache(userId: string): void {
	runtimeCache.deleteByPrefix(`auth:user:${userId}:`);
}

export function invalidateSessionAuthCache(sessionId: string): void {
	runtimeCache.deleteByPrefix(`auth:sess:${sessionId}`);
}

export function invalidateAllAuthCache(): void {
	runtimeCache.deleteByPrefix('auth:');
}

export function invalidateSettingsCache(): void {
	runtimeCache.delete('system:settings');
}

export async function createSession(
	userId: string,
	role: 'admin' | 'user',
	ipAddress: string | null,
	userAgent: string | null
): Promise<{ sessionId: string; accessJwt: string; refreshToken: string; expiresAt: Date }> {
	await ensureDatabaseReady();
	const db = getPool();

	const sessionId = crypto.randomUUID();
	const tokenFamily = crypto.randomUUID();
	const refreshToken = generateToken(48);
	const refreshHash = await hashOpaqueToken(refreshToken);
	const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
	const deviceLabel = describeUserAgent(userAgent);
	const fp = computeClientFingerprint(userAgent);

	await db.query(
		`INSERT INTO sessions
		 (id, user_id, token_family, refresh_token_hash, previous_token_hash, rotated_at, rotation_count, device_label, ip_address, user_agent, last_used_at, expires_at)
		 VALUES (?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
		[
			sessionId,
			userId,
			tokenFamily,
			refreshHash,
			deviceLabel,
			ipAddress,
			userAgent?.slice(0, 250) ?? null,
			expiresAt
		]
	);

	const accessJwt = await signAccessJwt(
		{ sub: userId, sid: sessionId, role, fp },
		ACCESS_TTL_SECONDS
	);

	return { sessionId, accessJwt, refreshToken, expiresAt };
}

export function setAuthCookies(
	cookies: Cookies,
	accessJwt: string,
	refreshToken: string,
	refreshExpiresAt: Date,
	isSecure = false
): void {
	const secure = isSecure || (process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === 'true');

	cookies.set(ACCESS_COOKIE_NAME, accessJwt, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: ACCESS_TTL_SECONDS
	});

	cookies.set(REFRESH_COOKIE_NAME, refreshToken, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		expires: refreshExpiresAt
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(ACCESS_COOKIE_NAME, { path: '/' });
	cookies.delete(REFRESH_COOKIE_NAME, { path: '/' });
	cookies.delete('lizzart_session', { path: '/' });
}

/**
 * Validates EdDSA (Ed25519) JWT access token (with bounded TTL session cache)
 * and performs automatic HMAC-SHA512 refresh token rotation with token-family reuse detection!
 */
export async function authenticateRequest(
	cookies: Cookies,
	userAgent: string | null = null,
	ipAddress: string | null = null,
	isSecure = false
): Promise<{ user: SafeUser; sessionId: string } | null> {
	await ensureDatabaseReady();
	const db = getPool();
	const perf = getPerformanceConfig();
	const currentFp = computeClientFingerprint(userAgent);

	const accessToken = cookies.get(ACCESS_COOKIE_NAME);
	if (accessToken) {
		const payload = await verifyAccessJwt(accessToken);
		if (payload && (!payload.fp || payload.fp === currentFp)) {
			const cacheKey = `auth:user:${payload.sub}:sess:${payload.sid}`;
			const cached = runtimeCache.get<{ user: SafeUser; sessionId: string; expiresAtMs: number }>(
				cacheKey
			);
			if (cached && cached.expiresAtMs > Date.now()) {
				return { user: cached.user, sessionId: cached.sessionId };
			}

			const [rows] = await db.query<RowDataPacket[]>(
				`SELECT ${USER_SELECT_COLS}, s.id AS sid, s.expires_at
				 FROM sessions s
				 INNER JOIN users u ON u.id = s.user_id
				 WHERE s.id = ? AND u.id = ?
				 LIMIT 1`,
				[payload.sid, payload.sub]
			);

			if (rows.length > 0 && rows[0].is_active) {
				const expiresAtMs = new Date(rows[0].expires_at).getTime();
				if (expiresAtMs > Date.now()) {
					const result = {
						user: mapUserRow(rows[0]),
						sessionId: String(rows[0].sid)
					};
					runtimeCache.set(
						cacheKey,
						{ ...result, expiresAtMs },
						Math.min(perf.authCacheTtlMs, Math.max(1000, expiresAtMs - Date.now()))
					);
					return result;
				}
			}
		}
	}

	// Fallback: validate & rotate refresh token from MariaDB (with reuse detection!)
	const refreshToken = cookies.get(REFRESH_COOKIE_NAME);
	if (!refreshToken) return null;

	const refreshHash = await hashOpaqueToken(refreshToken);
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT ${USER_SELECT_COLS}, s.id AS sid, s.token_family, s.refresh_token_hash,
		        s.previous_token_hash, s.rotated_at, s.rotation_count, s.expires_at
		 FROM sessions s
		 INNER JOIN users u ON u.id = s.user_id
		 WHERE s.refresh_token_hash = ? OR s.previous_token_hash = ?
		 LIMIT 1`,
		[refreshHash, refreshHash]
	);

	if (rows.length === 0) return null;

	const row = rows[0];
	const expiresAt = new Date(row.expires_at);
	if (expiresAt.getTime() <= Date.now() || !row.is_active) {
		await db.query('DELETE FROM sessions WHERE id = ?', [row.sid]);
		invalidateUserAuthCache(String(row.id));
		return null;
	}

	const matchedPrevious =
		row.previous_token_hash &&
		String(row.previous_token_hash) === refreshHash &&
		String(row.refresh_token_hash) !== refreshHash;

	if (matchedPrevious) {
		const rotatedAtMs = row.rotated_at ? new Date(row.rotated_at).getTime() : 0;
		const withinGrace = rotatedAtMs > 0 && Date.now() - rotatedAtMs <= ROTATION_GRACE_MS;
		if (withinGrace) {
			// Concurrent request in flight during refresh rotation: issue fresh access token safely
			const user = mapUserRow(row);
			const freshAccess = await signAccessJwt(
				{ sub: user.id, sid: String(row.sid), role: user.role, fp: currentFp },
				ACCESS_TTL_SECONDS
			);
			cookies.set(ACCESS_COOKIE_NAME, freshAccess, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: isSecure || (process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === 'true'),
				maxAge: ACCESS_TTL_SECONDS
			});
			return { user, sessionId: String(row.sid) };
		}

		// REPLAY / TOKEN THEFT DETECTED! Revoke entire token family immediately!
		await db.query('DELETE FROM sessions WHERE token_family = ?', [row.token_family]);
		invalidateUserAuthCache(String(row.id));
		await logAudit({
			userId: String(row.id),
			action: 'security.token_reuse_detected',
			targetType: 'session',
			targetId: String(row.sid),
			details: `Reuso de refresh token detectado para @${row.username} — família de sessões revogada imediatamente`,
			ipAddress
		});
		return null;
	}

	// Normal refresh rotation: move current hash -> previous_token_hash, mint new pair
	const user = mapUserRow(row);
	const newRefreshToken = generateToken(48);
	const newRefreshHash = await hashOpaqueToken(newRefreshToken);
	const newExpiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

	await db.query(
		`UPDATE sessions
		 SET previous_token_hash = refresh_token_hash,
		     refresh_token_hash = ?,
		     rotated_at = CURRENT_TIMESTAMP,
		     rotation_count = rotation_count + 1,
		     last_used_at = CURRENT_TIMESTAMP,
		     ip_address = COALESCE(?, ip_address),
		     expires_at = ?
		 WHERE id = ?`,
		[newRefreshHash, ipAddress, newExpiresAt, row.sid]
	);

	const newAccessJwt = await signAccessJwt(
		{ sub: user.id, sid: String(row.sid), role: user.role, fp: currentFp },
		ACCESS_TTL_SECONDS
	);
	setAuthCookies(cookies, newAccessJwt, newRefreshToken, newExpiresAt, isSecure);

	const cacheKey = `auth:user:${user.id}:sess:${row.sid}`;
	runtimeCache.set(
		cacheKey,
		{ user, sessionId: String(row.sid), expiresAtMs: newExpiresAt.getTime() },
		perf.authCacheTtlMs
	);

	return { user, sessionId: String(row.sid) };
}

export async function invalidateSession(sessionId: string, userId?: string): Promise<void> {
	const db = getPool();
	await db.query('DELETE FROM sessions WHERE id = ?', [sessionId]);
	if (userId) {
		invalidateUserAuthCache(userId);
	} else {
		invalidateAllAuthCache();
	}
}

export async function revokeOtherUserSessions(userId: string, keepSessionId?: string | null): Promise<void> {
	const db = getPool();
	if (keepSessionId) {
		await db.query('DELETE FROM sessions WHERE user_id = ? AND id != ?', [userId, keepSessionId]);
	} else {
		await db.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
	}
	invalidateUserAuthCache(userId);
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
	const cached = runtimeCache.get<SystemSettings>('system:settings');
	if (cached) return cached;

	await ensureDatabaseReady();
	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT setting_key, setting_value FROM system_settings'
	);
	const map = new Map<string, string>();
	for (const r of rows) {
		map.set(String(r.setting_key), String(r.setting_value));
	}

	const rawPerf = map.get('performance_mode');
	const rawBackup = map.get('auto_backup_interval');
	const autoBackup: AutoBackupInterval =
		rawBackup === 'daily' || rawBackup === 'weekly' ? rawBackup : 'off';

	const settings: SystemSettings = {
		default_quota_gb: Math.max(
			MIN_WORKSPACE_QUOTA_GB,
			Number(map.get('default_quota_gb') ?? 10) || 10
		),
		max_upload_mb: Math.max(10, Number(map.get('max_upload_mb') ?? 10240) || 10240),
		performance_mode: isValidPerformanceMode(rawPerf) ? rawPerf : getActivePerformanceMode(),
		auto_backup_interval: autoBackup,
		backup_retention_count: Math.max(1, Math.min(100, Number(map.get('backup_retention_count') ?? 10) || 10))
	};

	runtimeCache.set('system:settings', settings, 30_000);
	return settings;
}
