import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { decryptAtRest, encryptAtRest, verifyPassword } from '$lib/server/crypto';
import {
	buildOtpAuthUri,
	generateBase32Secret,
	generateQrCodeDataUrl,
	verifyTotpCodeWithStep
} from '$lib/server/totp';
import { invalidateUserAuthCache, logAudit, revokeOtherUserSessions } from '$lib/server/auth';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const secret = generateBase32Secret(20);
	const uri = buildOtpAuthUri(locals.user.username, secret);
	const qrDataUrl = await generateQrCodeDataUrl(uri);

	// Encrypt TOTP secret with AES-256-GCM (AAD bound to userId) before persisting
	const encryptedSecret = await encryptAtRest(secret, 'totp-secret', locals.user.id);

	const db = getPool();
	await db.query(
		'UPDATE users SET totp_secret = ?, totp_enabled = 0, totp_last_step = NULL WHERE id = ?',
		[encryptedSecret, locals.user.id]
	);

	return json({ secret, uri, qrDataUrl });
};

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const body = await request.json().catch(() => null);
	const code = String(body?.code || '').trim();

	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT totp_secret FROM users WHERE id = ? LIMIT 1',
		[locals.user.id]
	);
	const storedSecret = rows[0]?.totp_secret ? String(rows[0].totp_secret) : null;
	if (!storedSecret) {
		return json({ error: 'Inicie a configuração do 2FA primeiro.' }, { status: 400 });
	}

	const plainSecret = await decryptAtRest(storedSecret, 'totp-secret', locals.user.id);
	const check = verifyTotpCodeWithStep(plainSecret, code);
	if (!check.valid) {
		return json({ error: 'Código de 6 dígitos inválido. Tente novamente.' }, { status: 400 });
	}

	await db.query('UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ?', [
		check.step,
		locals.user.id
	]);
	invalidateUserAuthCache(locals.user.id);

	await logAudit({
		userId: locals.user.id,
		action: 'auth.2fa_enabled',
		targetType: 'user',
		targetId: locals.user.id,
		details: 'Autenticação 2FA local ativada (segredo criptografado em AES-256-GCM)',
		ipAddress: getClientAddress()
	});

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const body = await request.json().catch(() => null);
	const password = String(body?.password || '');

	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT password_hash FROM users WHERE id = ? LIMIT 1',
		[locals.user.id]
	);
	const ok = await verifyPassword(password, String(rows[0]?.password_hash || ''));
	if (!ok) {
		return json({ error: 'Senha atual incorreta.' }, { status: 401 });
	}

	await db.query(
		'UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = NULL WHERE id = ?',
		[locals.user.id]
	);
	await revokeOtherUserSessions(locals.user.id, locals.sessionId);

	await logAudit({
		userId: locals.user.id,
		action: 'auth.2fa_disabled',
		targetType: 'user',
		targetId: locals.user.id,
		details: 'Autenticação 2FA local desativada e demais sessões encerradas',
		ipAddress: getClientAddress()
	});

	return json({ ok: true });
};
