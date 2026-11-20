import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import {
	decryptAtRest,
	encryptAtRest,
	hashPassword,
	isEncryptedAtRest,
	passwordNeedsRehash,
	verifyDummyPassword,
	verifyPassword
} from '$lib/server/crypto';
import { signTwoFactorChallenge, verifyTwoFactorChallenge } from '$lib/server/jwt';
import { verifyTotpCodeWithStep } from '$lib/server/totp';
import { checkRateLimit, isRequestSecure, resetRateLimit } from '$lib/server/security';
import {
	createSession,
	logAudit,
	mapUserRow,
	normalizeUsername,
	setAuthCookies
} from '$lib/server/auth';

const MAX_FAILED_ATTEMPTS_BEFORE_LOCK = 6;
const LOCK_DURATION_MINUTES = 10;

export const POST: RequestHandler = async ({ request, url, cookies, getClientAddress }) => {
	const ip = getClientAddress();
	const secure = isRequestSecure(request, url);
	const body = await request.json().catch(() => null);
	if (!body) {
		return json({ error: 'Requisição inválida.' }, { status: 400 });
	}

	const db = getPool();
	const totpCode = String(body?.totpCode || '').trim();
	const challengeToken = typeof body?.challengeToken === 'string' ? body.challengeToken.trim() : '';

	let userRow: RowDataPacket | null = null;
	let rateKey = `login:${ip}`;

	// Path A: Step 2 of 2FA via signed Ed25519 challenge token (password never re-sent!)
	if (challengeToken) {
		rateKey = `login2fa:${ip}`;
		const rate = checkRateLimit(rateKey, 10, 5 * 60 * 1000);
		if (!rate.allowed) {
			return json(
				{ error: `Muitas tentativas de 2FA. Aguarde ${rate.retryAfterSec}s.` },
				{ status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
			);
		}

		const challenge = await verifyTwoFactorChallenge(challengeToken, ip);
		if (!challenge) {
			return json(
				{ error: 'Desafio 2FA expirado ou inválido. Faça login novamente.' },
				{ status: 401 }
			);
		}

		const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM users WHERE id = ? LIMIT 1', [
			challenge.sub
		]);
		if (rows.length === 0 || !rows[0].is_active) {
			return json({ error: 'Conta indisponível.' }, { status: 403 });
		}
		userRow = rows[0];
	} else {
		// Path B: Primary username + password authentication
		const username = normalizeUsername(String(body?.username || ''));
		const password = String(body?.password || '');

		rateKey = `login:${ip}:${username}`;
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

		const [rows] = await db.query<RowDataPacket[]>(
			'SELECT * FROM users WHERE username = ? LIMIT 1',
			[username]
		);

		if (rows.length === 0) {
			// Constant-time anti-enumeration dummy verification
			await verifyDummyPassword(password);
			return json({ error: 'Usuário ou senha inválidos.' }, { status: 401 });
		}

		userRow = rows[0];

		if (!userRow.is_active) {
			await verifyDummyPassword(password);
			return json({ error: 'Esta conta está suspensa. Contate um administrador.' }, { status: 403 });
		}

		// Progressive account lockout check
		if (userRow.locked_until && new Date(userRow.locked_until).getTime() > Date.now()) {
			const remainSec = Math.ceil(
				(new Date(userRow.locked_until).getTime() - Date.now()) / 1000
			);
			return json(
				{
					error: `Conta temporariamente bloqueada por segurança após múltiplas tentativas inválidas. Tente novamente em ${Math.ceil(remainSec / 60)} min.`
				},
				{ status: 423, headers: { 'Retry-After': String(remainSec) } }
			);
		}

		const valid = await verifyPassword(password, String(userRow.password_hash));
		if (!valid) {
			const nextFails = Number(userRow.failed_login_count ?? 0) + 1;
			const shouldLock = nextFails >= MAX_FAILED_ATTEMPTS_BEFORE_LOCK;
			const lockUntil = shouldLock
				? new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000)
				: null;

			await db.query(
				'UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?',
				[shouldLock ? 0 : nextFails, lockUntil, userRow.id]
			);

			if (shouldLock) {
				await logAudit({
					userId: String(userRow.id),
					action: 'security.account_locked',
					targetType: 'user',
					targetId: String(userRow.id),
					details: `Conta @${username} bloqueada por ${LOCK_DURATION_MINUTES} min após ${nextFails} falhas`,
					ipAddress: ip
				});
			}

			return json({ error: 'Usuário ou senha inválidos.' }, { status: 401 });
		}

		// Transparent password upgrade to Argon2id if stored with legacy scrypt
		if (passwordNeedsRehash(String(userRow.password_hash))) {
			const upgraded = await hashPassword(password);
			await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [upgraded, userRow.id]);
		}
	}

	// Local 2FA TOTP verification (with AES-256-GCM decrypted secret + replay protection)
	if (userRow.totp_enabled && userRow.totp_secret) {
		if (!totpCode) {
			const signedChallenge = await signTwoFactorChallenge(String(userRow.id), ip, 300);
			return json({ requires2fa: true, challengeToken: signedChallenge });
		}

		let plainSecret: string;
		try {
			plainSecret = await decryptAtRest(
				String(userRow.totp_secret),
				'totp-secret',
				String(userRow.id)
			);
		} catch {
			return json(
				{ error: 'Erro ao descriptografar segredo 2FA. Solicite reset ao administrador.' },
				{ status: 500 }
			);
		}

		// Seamlessly encrypt legacy plaintext TOTP secret at rest
		if (!isEncryptedAtRest(String(userRow.totp_secret))) {
			const encrypted = await encryptAtRest(plainSecret, 'totp-secret', String(userRow.id));
			await db.query('UPDATE users SET totp_secret = ? WHERE id = ?', [encrypted, userRow.id]);
		}

		const lastStep =
			userRow.totp_last_step !== null && userRow.totp_last_step !== undefined
				? Number(userRow.totp_last_step)
				: null;
		const totpResult = verifyTotpCodeWithStep(plainSecret, totpCode, lastStep);

		if (!totpResult.valid) {
			return json(
				{
					error: totpResult.replayed
						? 'Este código 2FA já foi utilizado. Aguarde o próximo código.'
						: 'Código 2FA inválido ou expirado.',
					requires2fa: true
				},
				{ status: 401 }
			);
		}

		await db.query('UPDATE users SET totp_last_step = ? WHERE id = ?', [
			totpResult.step,
			userRow.id
		]);
	}

	// Clear brute-force counters on successful auth
	resetRateLimit(rateKey);
	if (Number(userRow.failed_login_count ?? 0) > 0 || userRow.locked_until) {
		await db.query(
			'UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?',
			[userRow.id]
		);
	}

	const ua = request.headers.get('user-agent');
	const role = userRow.role === 'admin' ? 'admin' : 'user';
	const { accessJwt, refreshToken, expiresAt } = await createSession(
		String(userRow.id),
		role,
		ip,
		ua
	);
	setAuthCookies(cookies, accessJwt, refreshToken, expiresAt, secure);

	await logAudit({
		userId: String(userRow.id),
		action: 'auth.login',
		targetType: 'user',
		targetId: String(userRow.id),
		details: `Login EdDSA JWT realizado (@${userRow.username}${userRow.totp_enabled ? ' com 2FA' : ''})`,
		ipAddress: ip
	});

	return json({ user: mapUserRow(userRow) });
};
