import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { verifyPassword } from '$lib/server/crypto';
import {
	buildOtpAuthUri,
	generateBase32Secret,
	generateQrCodeDataUrl,
	verifyTotpCode
} from '$lib/server/totp';
import { logAudit } from '$lib/server/auth';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const secret = generateBase32Secret(20);
	const uri = buildOtpAuthUri(locals.user.username, secret);
	const qrDataUrl = await generateQrCodeDataUrl(uri);

	// Store pending secret (not enabled yet until verified)
	const db = getPool();
	await db.query('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?', [
		secret,
		locals.user.id
	]);

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
	const secret = rows[0]?.totp_secret ? String(rows[0].totp_secret) : null;
	if (!secret) {
		return json({ error: 'Inicie a configuração do 2FA primeiro.' }, { status: 400 });
	}

	if (!verifyTotpCode(secret, code)) {
		return json({ error: 'Código de 6 dígitos inválido. Tente novamente.' }, { status: 400 });
	}

	await db.query('UPDATE users SET totp_enabled = 1 WHERE id = ?', [locals.user.id]);

	await logAudit({
		userId: locals.user.id,
		action: 'auth.2fa_enabled',
		targetType: 'user',
		targetId: locals.user.id,
		details: 'Autenticação 2FA local ativada',
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

	await db.query('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', [
		locals.user.id
	]);

	await logAudit({
		userId: locals.user.id,
		action: 'auth.2fa_disabled',
		targetType: 'user',
		targetId: locals.user.id,
		details: 'Autenticação 2FA local desativada',
		ipAddress: getClientAddress()
	});

	return json({ ok: true });
};
