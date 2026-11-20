interface Bucket {
	count: number;
	resetAt: number;
}

const buckets = new Map<string, Bucket>();

setInterval(() => {
	const now = Date.now();
	for (const [k, b] of buckets.entries()) {
		if (b.resetAt <= now) buckets.delete(k);
	}
}, 60_000).unref?.();

export function checkRateLimit(
	key: string,
	maxAttempts: number,
	windowMs: number
): { allowed: boolean; retryAfterSec: number; remaining: number } {
	const now = Date.now();
	const current = buckets.get(key);

	if (!current || current.resetAt <= now) {
		buckets.set(key, { count: 1, resetAt: now + windowMs });
		return { allowed: true, retryAfterSec: 0, remaining: Math.max(0, maxAttempts - 1) };
	}

	if (current.count >= maxAttempts) {
		return {
			allowed: false,
			retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
			remaining: 0
		};
	}

	current.count += 1;
	return {
		allowed: true,
		retryAfterSec: 0,
		remaining: Math.max(0, maxAttempts - current.count)
	};
}

export function resetRateLimit(key: string): void {
	buckets.delete(key);
}

/**
 * Checks whether the request was received over HTTPS (directly or behind a reverse proxy).
 */
export function isRequestSecure(request: Request, url: URL): boolean {
	if (process.env.FORCE_HTTPS === 'true') return true;
	if (url.protocol === 'https:') return true;
	const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
	return proto === 'https';
}

/**
 * Defense-in-depth CSRF Origin / Sec-Fetch-Site verification for state-changing API requests.
 */
export function verifyCsrfOrigin(request: Request, url: URL): boolean {
	const method = request.method.toUpperCase();
	if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;

	const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
	if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') {
		return false;
	}

	const origin = request.headers.get('origin');
	if (origin) {
		try {
			const originUrl = new URL(origin);
			const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
			const expectedHost = (forwardedHost || request.headers.get('host') || url.host).toLowerCase();
			if (originUrl.host.toLowerCase() !== expectedHost) {
				return false;
			}
		} catch {
			return false;
		}
	}

	return true;
}

/**
 * Parses a User-Agent string into a clean human-readable device/browser label.
 */
export function describeUserAgent(ua: string | null): string {
	if (!ua) return 'Dispositivo desconhecido';
	const browser = /Edg\//i.test(ua)
		? 'Edge'
		: /OPR\/|Opera/i.test(ua)
			? 'Opera'
			: /Chrome\/|CriOS\//i.test(ua)
				? 'Chrome'
				: /Firefox\/|FxiOS\//i.test(ua)
					? 'Firefox'
					: /Safari\//i.test(ua)
						? 'Safari'
						: /curl|Bun|node|fetch/i.test(ua)
							? 'Cliente API'
							: 'Navegador';

	const os = /iPhone|iPad/i.test(ua)
		? 'iOS'
		: /Android/i.test(ua)
			? 'Android'
			: /Windows/i.test(ua)
				? 'Windows'
				: /Mac OS X|Macintosh/i.test(ua)
					? 'macOS'
					: /Linux/i.test(ua)
						? 'Linux'
						: 'Sistema';

	return `${browser} • ${os}`;
}

export function applySecurityHeaders(
	response: Response,
	pathname: string,
	secure = false
): Response {
	const headers = new Headers(response.headers);

	const isInlinePreview =
		(pathname.startsWith('/api/files/') && pathname.endsWith('/content')) ||
		(pathname.startsWith('/api/share/') && pathname.endsWith('/download'));
	headers.set('X-Frame-Options', isInlinePreview ? 'SAMEORIGIN' : 'DENY');
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
	headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	headers.set('X-XSS-Protection', '0');

	if (secure) {
		headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}

	if (pathname.startsWith('/api/auth/')) {
		headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
		headers.set('Pragma', 'no-cache');
	}

	if (!headers.has('Content-Security-Policy') && !isInlinePreview) {
		headers.set(
			'Content-Security-Policy',
			[
				"default-src 'self'",
				"script-src 'self' 'unsafe-inline'",
				"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
				"font-src 'self' https://fonts.gstatic.com data:",
				"img-src 'self' data: blob:",
				"media-src 'self' blob:",
				"connect-src 'self'",
				"frame-src 'self'",
				"frame-ancestors 'none'",
				"base-uri 'self'",
				"form-action 'self'"
			].join('; ')
		);
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}
