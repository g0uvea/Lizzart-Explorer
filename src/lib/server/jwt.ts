import crypto from 'node:crypto';
import { updateEnvVariables } from '$lib/server/envConfig';

let cachedSecret: string | null = null;

async function getJwtSecret(): Promise<string> {
	if (cachedSecret) return cachedSecret;
	const existing = process.env.JWT_SECRET?.trim();
	if (existing && existing.length >= 32) {
		cachedSecret = existing;
		return cachedSecret;
	}
	// Auto-generate a cryptographically strong 512-bit secret and persist in .env
	const generated = crypto.randomBytes(64).toString('hex');
	cachedSecret = generated;
	await updateEnvVariables({ JWT_SECRET: generated }).catch(() => {});
	return generated;
}

function base64UrlEncode(input: Buffer | string): string {
	return Buffer.from(input)
		.toString('base64')
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
}

function base64UrlDecode(input: string): Buffer {
	const padded = input.replace(/-/g, '+').replace(/_/g, '/');
	const padLen = (4 - (padded.length % 4)) % 4;
	return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

export interface AccessJwtPayload {
	sub: string; // user_id
	sid: string; // session_id
	role: 'admin' | 'user';
	jti: string;
	iat: number;
	exp: number;
}

export async function signAccessJwt(
	payload: Omit<AccessJwtPayload, 'iat' | 'exp' | 'jti'>,
	ttlSeconds = 900 // 15 minutes
): Promise<string> {
	const secret = await getJwtSecret();
	const now = Math.floor(Date.now() / 1000);
	const fullPayload: AccessJwtPayload = {
		...payload,
		jti: crypto.randomUUID(),
		iat: now,
		exp: now + ttlSeconds
	};

	const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
	const body = base64UrlEncode(JSON.stringify(fullPayload));
	const signingInput = `${header}.${body}`;
	const sig = crypto.createHmac('sha256', secret).update(signingInput).digest();
	return `${signingInput}.${base64UrlEncode(sig)}`;
}

export async function verifyAccessJwt(token: string): Promise<AccessJwtPayload | null> {
	try {
		const parts = token.split('.');
		if (parts.length !== 3) return null;
		const [headerB64, payloadB64, sigB64] = parts;

		const secret = await getJwtSecret();
		const expectedSig = crypto
			.createHmac('sha256', secret)
			.update(`${headerB64}.${payloadB64}`)
			.digest();
		const providedSig = base64UrlDecode(sigB64);

		if (expectedSig.length !== providedSig.length) return null;
		if (!crypto.timingSafeEqual(expectedSig, providedSig)) return null;

		const header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
		if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

		const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as AccessJwtPayload;
		const now = Math.floor(Date.now() / 1000);
		if (!payload.sub || !payload.sid || !payload.exp || payload.exp <= now) {
			return null;
		}
		return payload;
	} catch {
		return null;
	}
}

export function sha256Hex(value: string): string {
	return crypto.createHash('sha256').update(value).digest('hex');
}
