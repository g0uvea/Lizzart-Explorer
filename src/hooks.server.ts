import { redirect, type Handle } from '@sveltejs/kit';
import { ensureDatabaseReady, hasAnyAdmin } from '$lib/server/db';
import {
	ACCESS_COOKIE_NAME,
	REFRESH_COOKIE_NAME,
	authenticateRequest,
	clearSessionCookie
} from '$lib/server/auth';
import { applySecurityHeaders } from '$lib/server/security';

export const handle: Handle = async ({ event, resolve }) => {
	await ensureDatabaseReady();

	event.locals.user = null;
	event.locals.sessionId = null;

	const hasAnyCookie =
		Boolean(event.cookies.get(ACCESS_COOKIE_NAME)) ||
		Boolean(event.cookies.get(REFRESH_COOKIE_NAME));

	if (hasAnyCookie) {
		const auth = await authenticateRequest(event.cookies);
		if (auth) {
			event.locals.user = auth.user;
			event.locals.sessionId = auth.sessionId;
		} else {
			clearSessionCookie(event.cookies);
		}
	}

	const pathname = event.url.pathname;
	const isApiOrStatic = pathname.startsWith('/api/') || pathname.startsWith('/_app/');
	if (!isApiOrStatic && pathname !== '/setup') {
		const adminExists = await hasAnyAdmin();
		if (!adminExists) {
			throw redirect(302, '/setup');
		}
	}

	const response = await resolve(event);
	return applySecurityHeaders(response, pathname);
};
