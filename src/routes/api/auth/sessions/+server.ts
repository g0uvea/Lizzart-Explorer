import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { invalidateUserAuthCache, logAudit } from '$lib/server/auth';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT id, ip_address, user_agent, device_label, rotation_count, last_used_at, created_at, expires_at
		 FROM sessions
		 WHERE user_id = ? AND expires_at > CURRENT_TIMESTAMP
		 ORDER BY last_used_at DESC`,
		[locals.user.id]
	);

	return json({
		sessions: rows.map((r) => ({
			id: String(r.id),
			ip_address: r.ip_address ? String(r.ip_address) : '—',
			device_label: r.device_label ? String(r.device_label) : 'Dispositivo',
			user_agent: r.user_agent ? String(r.user_agent) : 'Navegador desconhecido',
			rotation_count: Number(r.rotation_count ?? 0),
			last_used_at:
				r.last_used_at instanceof Date ? r.last_used_at.toISOString() : String(r.last_used_at),
			created_at:
				r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
			expires_at:
				r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at),
			is_current: String(r.id) === locals.sessionId
		}))
	});
};

export const DELETE: RequestHandler = async ({ locals, url, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const db = getPool();
	const sessionId = url.searchParams.get('id');
	const othersOnly = url.searchParams.get('others') === '1';

	if (othersOnly && locals.sessionId) {
		await db.query('DELETE FROM sessions WHERE user_id = ? AND id != ?', [
			locals.user.id,
			locals.sessionId
		]);
		invalidateUserAuthCache(locals.user.id);
		await logAudit({
			userId: locals.user.id,
			action: 'auth.sessions_revoke_others',
			targetType: 'user',
			targetId: locals.user.id,
			details: 'Todas as outras sessões foram encerradas',
			ipAddress: getClientAddress()
		});
		return json({ ok: true });
	}

	if (sessionId) {
		await db.query('DELETE FROM sessions WHERE id = ? AND user_id = ?', [
			sessionId,
			locals.user.id
		]);
		invalidateUserAuthCache(locals.user.id);
		await logAudit({
			userId: locals.user.id,
			action: 'auth.session_revoke',
			targetType: 'session',
			targetId: sessionId,
			details: 'Sessão encerrada pelo usuário',
			ipAddress: getClientAddress()
		});
		return json({ ok: true });
	}

	return json({ error: 'Informe id ou others=1.' }, { status: 400 });
};
