import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { verifyPassword } from '$lib/server/crypto';
import { verifyTotpCode } from '$lib/server/totp';
import { checkRateLimit, resetRateLimit } from '$lib/server/security';
import {
	createSession,
	logAudit,
	mapUserRow,
	normalizeUsername,
	setAuthCookies
} from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const ip = getClientAddress();
	const body = await request.json().catch(() => null);
	const username = normalizeUsername(String(body?.username || ''));
	const password = String(body?.password || '');
	const totpCode = String(body?.totpCode || '').trim();

	// Sliding-window brute-force protection: max 10 attempts per 5 minutes per IP+username
	const rateKey = `login:${ip}:${username}`;
	const rate = checkRateLimit(rateKey, 10, 5 * 60 * 1000);
	if (!rate.allowed) {
		return json(
			{
				error: `Muitas tentativas de login. Aguarde ${rate.retryAfterSec}s e tente novamente.`
			},
			{ status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
		);
	}

	if (!username || !password) {
		return json({ error: 'Informe usuário e senha.' }, { status: 400 });
	}

	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT * FROM users WHERE username = ? LIMIT 1',
		[username]
	);

	if (rows.length === 0) {
		return json({ error: 'Usuário ou senha inválidos.' }, { status: 401 });
	}

	const userRow = rows[0];
	if (!userRow.is_active) {
		return json({ error: 'Esta conta está suspensa. Contate um administrador.' }, { status: 403 });
	}

	const valid = await verifyPassword(password, String(userRow.password_hash));
	if (!valid) {
		return json({ error: 'Usuário ou senha inválidos.' }, { status: 401 });
	}

	// Local 2FA TOTP verification
	if (userRow.totp_enabled && userRow.totp_secret) {
		if (!totpCode) {
			return json({ requires2fa: true });
		}
		const totpOk = verifyTotpCode(String(userRow.totp_secret), totpCode);
		if (!totpOk) {
			return json(
				{ error: 'Código 2FA inválido ou expirado.', requires2fa: true },
				{ status: 401 }
			);
		}
	}

	resetRateLimit(rateKey);

	const ua = request.headers.get('user-agent');
	const role = userRow.role === 'admin' ? 'admin' : 'user';
	const { accessJwt, refreshToken, expiresAt } = await createSession(
		String(userRow.id),
		role,
		ip,
		ua
	);
	setAuthCookies(cookies, accessJwt, refreshToken, expiresAt);

	await logAudit({
		userId: String(userRow.id),
		action: 'auth.login',
		targetType: 'user',
		targetId: String(userRow.id),
		details: `Login JWT realizado (@${username}${userRow.totp_enabled ? ' com 2FA' : ''})`,
		ipAddress: ip
	});

	return json({ user: mapUserRow(userRow) });
};
