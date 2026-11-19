import type { Handle } from '@sveltejs/kit';
import { ensureDatabaseReady } from '$lib/server/db';
import { SESSION_COOKIE_NAME, validateSession, clearSessionCookie } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	await ensureDatabaseReady();

	const sessionId = event.cookies.get(SESSION_COOKIE_NAME) ?? null;
	event.locals.user = null;
	event.locals.sessionId = null;

	if (sessionId) {
		const user = await validateSession(sessionId);
		if (user) {
			event.locals.user = user;
			event.locals.sessionId = sessionId;
		} else {
			clearSessionCookie(event.cookies);
		}
	}

	return resolve(event);
};
