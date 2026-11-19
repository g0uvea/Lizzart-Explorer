import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { hashPassword } from '$lib/server/crypto';
import { logAudit } from '$lib/server/auth';

const COLORS = ['#6366f1', '#10b981', '#0ea5e9', '#f59e0b', '#ec4899', '#8b5cf6'];

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso negado.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	const name = String(body?.name || '').trim();
	const email = String(body?.email || '').trim().toLowerCase();
	const password = String(body?.password || '');
	const role = body?.role === 'admin' ? 'admin' : 'user';
	const quotaGb = Number(body?.quota_gb ?? 10);
	const quotaBytes = quotaGb < 0 ? -1 : Math.round(quotaGb * 1024 * 1024 * 1024);

	if (name.length < 2 || !email.includes('@') || password.length < 6) {
		return json({ error: 'Preencha nome, e-mail válido e senha (mín. 6 caracteres).' }, { status: 400 });
	}

	const db = getPool();
	const [existing] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE email = ?', [email]);
	if (existing.length > 0) {
		return json({ error: 'E-mail já cadastrado.' }, { status: 409 });
	}

	const id = crypto.randomUUID();
	const hash = await hashPassword(password);
	const color = COLORS[Math.floor(Math.random() * COLORS.length)];

	await db.query(
		`INSERT INTO users (id, name, email, password_hash, role, quota_bytes, used_bytes, is_active, avatar_color)
		 VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)`,
		[id, name, email, hash, role, quotaBytes, color]
	);

	await logAudit({
		userId: locals.user.id,
		action: 'admin.user_create',
		targetType: 'user',
		targetId: id,
		details: `Usuário criado: ${email} (${role})`,
		ipAddress: getClientAddress()
	});

	return json({ id }, { status: 201 });
};
