import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { hashPassword } from '$lib/server/crypto';
import {
	isValidUsername,
	logAudit,
	MIN_USER_QUOTA_GB,
	normalizeUsername
} from '$lib/server/auth';

const COLORS = ['#10b981', '#0ea5e9', '#6366f1', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6'];

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso negado.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	const username = normalizeUsername(String(body?.username || ''));
	const firstName = String(body?.first_name || '').trim();
	const lastName = String(body?.last_name || '').trim();
	const password = String(body?.password || '');
	const role = body?.role === 'admin' ? 'admin' : 'user';
	const unlimited = Boolean(body?.unlimited);
	const rawQuotaGb = Number(body?.quota_gb ?? MIN_USER_QUOTA_GB);

	if (!isValidUsername(username)) {
		return json(
			{ error: 'Usuário inválido (use 3–32 caracteres: a-z, 0-9, ponto, hífen ou _).' },
			{ status: 400 }
		);
	}
	if (firstName.length < 2 || lastName.length < 2) {
		return json({ error: 'Informe Nome e Sobrenome (mín. 2 caracteres cada).' }, { status: 400 });
	}
	if (password.length < 6) {
		return json({ error: 'A senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
	}
	if (!unlimited && (Number.isNaN(rawQuotaGb) || rawQuotaGb < MIN_USER_QUOTA_GB)) {
		return json(
			{ error: `A cota mínima para novos usuários é de ${MIN_USER_QUOTA_GB} GB.` },
			{ status: 400 }
		);
	}

	const quotaBytes = unlimited ? -1 : Math.round(rawQuotaGb * 1024 * 1024 * 1024);

	const db = getPool();
	const [existing] = await db.query<RowDataPacket[]>(
		'SELECT id FROM users WHERE username = ?',
		[username]
	);
	if (existing.length > 0) {
		return json({ error: `O usuário @${username} já está em uso.` }, { status: 409 });
	}

	const id = crypto.randomUUID();
	const hash = await hashPassword(password);
	const color = COLORS[Math.floor(Math.random() * COLORS.length)];

	await db.query(
		`INSERT INTO users (id, username, first_name, last_name, password_hash, role, quota_bytes, used_bytes, is_active, avatar_color, accent_color, layout_density)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, '#10b981', 'normal')`,
		[id, username, firstName, lastName, hash, role, quotaBytes, color]
	);

	await logAudit({
		userId: locals.user.id,
		action: 'admin.user_create',
		targetType: 'user',
		targetId: id,
		details: `Usuário criado: @${username} (${role}, cota: ${unlimited ? 'Ilimitada' : `${rawQuotaGb} GB`})`,
		ipAddress: getClientAddress()
	});

	return json({ id, username }, { status: 201 });
};
