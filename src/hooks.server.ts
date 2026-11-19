import { redirect, type Handle } from '@sveltejs/kit';
import { ensureDatabaseReady, hasAnyAdmin } from '$lib/server/db';
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

	// If no admin exists yet in the database, force initial setup for page routes
	const pathname = event.url.pathname;
	const isApiOrStatic = pathname.startsWith('/api/') || pathname.startsWith('/_app/');
	if (!isApiOrStatic && pathname !== '/setup') {
		const adminExists = await hasAnyAdmin();
		if (!adminExists) {
			throw redirect(302, '/setup');
		}
	}

	return resolve(event);
};
