import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import crypto from 'node:crypto';
import { getPool, hasAnyAdmin, resetAdminExistsCache } from '$lib/server/db';
import { hashPassword } from '$lib/server/crypto';
import { checkRateLimit, isRequestSecure } from '$lib/server/security';
import {
	createSession,
	isValidUsername,
	logAudit,
	normalizeUsername,
	setAuthCookies
} from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, url, cookies, getClientAddress }) => {
	const ip = getClientAddress();
	const secure = isRequestSecure(request, url);
	const rate = checkRateLimit(`setup:${ip}`, 10, 5 * 60 * 1000);
	if (!rate.allowed) {
		return json({ error: 'Muitas tentativas. Aguarde alguns instantes.' }, { status: 429 });
	}

	const adminExists = await hasAnyAdmin();
	if (adminExists) {
		return json(
			{ error: 'O sistema já possui um administrador configurado.' },
			{ status: 403 }
		);
	}

	const body = await request.json().catch(() => null);
	const username = normalizeUsername(String(body?.username || ''));
	const firstName = String(body?.first_name || '').trim();
	const lastName = String(body?.last_name || '').trim();
	const password = String(body?.password || '');

	if (!isValidUsername(username)) {
		return json(
			{
				error:
					'Usuário inválido. Use 3 a 32 caracteres (letras minúsculas, números, ponto, hífen ou _).'
			},
			{ status: 400 }
		);
	}
	if (firstName.length < 2 || lastName.length < 2) {
		return json({ error: 'Informe Nome e Sobrenome (mínimo 2 caracteres cada).' }, { status: 400 });
	}
	if (password.length < 8) {
		return json({ error: 'A senha do administrador deve ter pelo menos 8 caracteres.' }, { status: 400 });
	}

	const db = getPool();
	const adminId = crypto.randomUUID();
	const passwordHash = await hashPassword(password);

	// Admin starts WITHOUT any workspace connected (admin creates & connects workspaces in /admin)
	await db.query(
		`INSERT INTO users (id, username, first_name, last_name, password_hash, role, is_active, avatar_color, accent_color, layout_density)
		 VALUES (?, ?, ?, ?, ?, 'admin', 1, '#10b981', '#10b981', 'normal')`,
		[adminId, username, firstName, lastName, passwordHash]
	);

	resetAdminExistsCache();

	const ua = request.headers.get('user-agent');
	const { accessJwt, refreshToken, expiresAt } = await createSession(adminId, 'admin', ip, ua);
	setAuthCookies(cookies, accessJwt, refreshToken, expiresAt, secure);

	await logAudit({
		userId: adminId,
		action: 'setup.admin_created',
		targetType: 'user',
		targetId: adminId,
		details: `Administrador inicial criado (sem workspace conectada): @${username}`,
		ipAddress: ip
	});

	return json({ ok: true, username }, { status: 201 });
};
