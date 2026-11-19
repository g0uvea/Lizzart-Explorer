import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { hashPassword } from '$lib/server/crypto';
import {
	createSession,
	getSystemSettings,
	logAudit,
	setSessionCookie
} from '$lib/server/auth';

const AVATAR_COLORS = ['#6366f1', '#10b981', '#0ea5e9', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6'];

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const settings = await getSystemSettings();
	if (!settings.allow_registration) {
		return json(
			{ error: 'O registro público está desativado pelo administrador.' },
			{ status: 403 }
		);
	}

	const body = await request.json().catch(() => null);
	const name = String(body?.name || '').trim();
	const email = String(body?.email || '').trim().toLowerCase();
	const password = String(body?.password || '');

	if (name.length < 2) {
		return json({ error: 'Nome deve ter pelo menos 2 caracteres.' }, { status: 400 });
	}
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json({ error: 'Informe um e-mail válido.' }, { status: 400 });
	}
	if (password.length < 6) {
		return json({ error: 'A senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
	}

	const db = getPool();
	const [existing] = await db.query<RowDataPacket[]>(
		'SELECT id FROM users WHERE email = ? LIMIT 1',
		[email]
	);
	if (existing.length > 0) {
		return json({ error: 'Já existe uma conta cadastrada com este e-mail.' }, { status: 409 });
	}

	const id = crypto.randomUUID();
	const passwordHash = await hashPassword(password);
	const quotaBytes = settings.default_quota_gb * 1024 * 1024 * 1024;
	const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

	await db.query(
		`INSERT INTO users (id, name, email, password_hash, role, quota_bytes, used_bytes, is_active, avatar_color)
		 VALUES (?, ?, ?, ?, 'user', ?, 0, 1, ?)`,
		[id, name, email, passwordHash, quotaBytes, color]
	);

	// Create default starter folder
	await db.query(
		`INSERT INTO storage_nodes (id, owner_id, parent_id, type, name) VALUES (?, ?, NULL, 'folder', 'Meus Documentos')`,
		[crypto.randomUUID(), id]
	);

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent');
	const { sessionId, expiresAt } = await createSession(id, ip, ua);
	setSessionCookie(cookies, sessionId, expiresAt);

	await logAudit({
		userId: id,
		action: 'auth.register',
		targetType: 'user',
		targetId: id,
		details: `Nova conta criada (${email})`,
		ipAddress: ip
	});

	return json(
		{
			user: {
				id,
				name,
				email,
				role: 'user',
				quota_bytes: quotaBytes,
				used_bytes: 0,
				is_active: true,
				avatar_color: color,
				created_at: new Date().toISOString()
			}
		},
		{ status: 201 }
	);
};
