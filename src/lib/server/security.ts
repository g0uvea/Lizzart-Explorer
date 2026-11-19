interface Bucket {
	count: number;
	resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Periodic cleanup of expired rate limit buckets
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
): { allowed: boolean; retryAfterSec: number } {
	const now = Date.now();
	const current = buckets.get(key);

	if (!current || current.resetAt <= now) {
		buckets.set(key, { count: 1, resetAt: now + windowMs });
		return { allowed: true, retryAfterSec: 0 };
	}

	if (current.count >= maxAttempts) {
		return {
			allowed: false,
			retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
		};
	}

	current.count += 1;
	return { allowed: true, retryAfterSec: 0 };
}

export function resetRateLimit(key: string): void {
	buckets.delete(key);
}

export function applySecurityHeaders(response: Response, pathname: string): Response {
	const headers = new Headers(response.headers);

	// Allow same-origin framing only for inline file preview (e.g. PDF iframe)
	const isInlinePreview = pathname.startsWith('/api/files/') && pathname.endsWith('/content');
	headers.set('X-Frame-Options', isInlinePreview ? 'SAMEORIGIN' : 'DENY');
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
	headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	headers.set('X-XSS-Protection', '0');

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
