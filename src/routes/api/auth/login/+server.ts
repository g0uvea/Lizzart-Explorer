import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { verifyPassword } from '$lib/server/crypto';
import { createSession, logAudit, mapUserRow, setSessionCookie } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const body = await request.json().catch(() => null);
	const email = String(body?.email || '').trim().toLowerCase();
	const password = String(body?.password || '');

	if (!email || !password) {
		return json({ error: 'Informe e-mail e senha.' }, { status: 400 });
	}

	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT * FROM users WHERE email = ? LIMIT 1',
		[email]
	);

	if (rows.length === 0) {
		return json({ error: 'Credenciais inválidas.' }, { status: 401 });
	}

	const userRow = rows[0];
	if (!userRow.is_active) {
		return json({ error: 'Esta conta está desativada. Contate um administrador.' }, { status: 403 });
	}

	const valid = await verifyPassword(password, String(userRow.password_hash));
	if (!valid) {
		return json({ error: 'Credenciais inválidas.' }, { status: 401 });
	}

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent');
	const { sessionId, expiresAt } = await createSession(String(userRow.id), ip, ua);
	setSessionCookie(cookies, sessionId, expiresAt);

	await logAudit({
		userId: String(userRow.id),
		action: 'auth.login',
		targetType: 'user',
		targetId: String(userRow.id),
		details: `Login realizado (${email})`,
		ipAddress: ip
	});

	return json({ user: mapUserRow(userRow) });
};
