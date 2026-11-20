import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearSessionCookie, invalidateSession, logAudit } from '$lib/server/auth';

export const POST: RequestHandler = async ({ locals, cookies, getClientAddress }) => {
	if (locals.sessionId) {
		await invalidateSession(locals.sessionId, locals.user?.id);
	}
	if (locals.user) {
		await logAudit({
			userId: locals.user.id,
			action: 'auth.logout',
			targetType: 'user',
			targetId: locals.user.id,
			details: 'Logout realizado',
			ipAddress: getClientAddress()
		});
	}
	clearSessionCookie(cookies);
	return json({ ok: true });
};
