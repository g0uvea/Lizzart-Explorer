import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import crypto from 'node:crypto';
import { getPool, hasAnyAdmin } from '$lib/server/db';
import { hashPassword } from '$lib/server/crypto';
import {
	createSession,
	isValidUsername,
	logAudit,
	normalizeUsername,
	setSessionCookie
} from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
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
			{ error: 'Usuário inválido. Use 3 a 32 caracteres (letras minúsculas, números, ponto, hífen ou _).' },
			{ status: 400 }
		);
	}
	if (firstName.length < 2 || lastName.length < 2) {
		return json({ error: 'Informe Nome e Sobrenome (mínimo 2 caracteres cada).' }, { status: 400 });
	}
	if (password.length < 6) {
		return json({ error: 'A senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
	}

	const db = getPool();
	const adminId = crypto.randomUUID();
	const passwordHash = await hashPassword(password);

	// Pure initialization: no starter folders, files, or Minecraft instances
	await db.query(
		`INSERT INTO users (id, username, first_name, last_name, password_hash, role, quota_bytes, used_bytes, is_active, avatar_color, accent_color, layout_density)
		 VALUES (?, ?, ?, ?, ?, 'admin', -1, 0, 1, '#10b981', '#10b981', 'normal')`,
		[adminId, username, firstName, lastName, passwordHash]
	);

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent');
	const { sessionId, expiresAt } = await createSession(adminId, ip, ua);
	setSessionCookie(cookies, sessionId, expiresAt);

	await logAudit({
		userId: adminId,
		action: 'setup.admin_created',
		targetType: 'user',
		targetId: adminId,
		details: `Administrador inicial criado: @${username}`,
		ipAddress: ip
	});

	return json({ ok: true, username }, { status: 201 });
};
