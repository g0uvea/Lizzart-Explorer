import { json, redirect, type Handle } from '@sveltejs/kit';
import { ensureDatabaseReady, hasAnyAdmin } from '$lib/server/db';
import {
	ACCESS_COOKIE_NAME,
	REFRESH_COOKIE_NAME,
	authenticateRequest,
	clearSessionCookie
} from '$lib/server/auth';
import {
	applySecurityHeaders,
	isRequestSecure,
	verifyCsrfOrigin
} from '$lib/server/security';
import { ensureBackupSchedulerStarted } from '$lib/server/backup';

export const handle: Handle = async ({ event, resolve }) => {
	const pathname = event.url.pathname;
	const secure = isRequestSecure(event.request, event.url);

	// Defense-in-depth CSRF Origin / Sec-Fetch-Site verification for mutating API routes
	if (pathname.startsWith('/api/') && !verifyCsrfOrigin(event.request, event.url)) {
		return applySecurityHeaders(
			json({ error: 'Origem da requisição bloqueada pela proteção CSRF.' }, { status: 403 }),
			pathname,
			secure
		);
	}

	await ensureDatabaseReady();
	ensureBackupSchedulerStarted();

	event.locals.user = null;
	event.locals.sessionId = null;

	const hasAnyCookie =
		Boolean(event.cookies.get(ACCESS_COOKIE_NAME)) ||
		Boolean(event.cookies.get(REFRESH_COOKIE_NAME));

	if (hasAnyCookie) {
		const ua = event.request.headers.get('user-agent');
		let ip: string | null = null;
		try {
			ip = event.getClientAddress();
		} catch {
			ip = null;
		}
		const auth = await authenticateRequest(event.cookies, ua, ip, secure);
		if (auth) {
			event.locals.user = auth.user;
			event.locals.sessionId = auth.sessionId;
		} else {
			clearSessionCookie(event.cookies);
		}
	}

	const isApiOrStatic = pathname.startsWith('/api/') || pathname.startsWith('/_app/');
	if (!isApiOrStatic && pathname !== '/setup') {
		const adminExists = await hasAnyAdmin();
		if (!adminExists) {
			throw redirect(302, '/setup');
		}
	}

	const response = await resolve(event);
	return applySecurityHeaders(response, pathname, secure);
};
