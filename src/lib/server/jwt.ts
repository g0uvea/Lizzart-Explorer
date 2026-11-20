import crypto, { type KeyObject } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getConfigDir } from '$lib/server/envConfig';

const JWT_ISSUER = 'lizzart-explorer';
const JWT_AUDIENCE = 'lizzart-web';

interface Ed25519KeyPair {
	privateKey: KeyObject;
	publicKey: KeyObject;
	kid: string;
}

let cachedKeyPair: Ed25519KeyPair | null = null;
let keyLoadPromise: Promise<Ed25519KeyPair> | null = null;

function computeKid(publicKey: KeyObject): string {
	const spki = publicKey.export({ type: 'spki', format: 'der' });
	return crypto.createHash('sha256').update(spki).digest('base64url').slice(0, 16);
}

async function loadOrGenerateEd25519KeyPair(): Promise<Ed25519KeyPair> {
	// 1. Check explicit environment variable (Base64 PEM)
	const envPrivB64 = process.env.JWT_ED25519_PRIVATE_KEY_B64?.trim();
	if (envPrivB64) {
		const pem = Buffer.from(envPrivB64, 'base64').toString('utf8');
		const privateKey = crypto.createPrivateKey(pem);
		const publicKey = crypto.createPublicKey(privateKey);
		return { privateKey, publicKey, kid: computeKid(publicKey) };
	}

	// 2. Check persisted private key file in CONFIG_DIR (0600)
	const keyDir = getConfigDir();
	const keyPath = path.join(keyDir, '.lizzart-ed25519.pem');
	try {
		const pem = await fsp.readFile(keyPath, 'utf8');
		const privateKey = crypto.createPrivateKey(pem);
		const publicKey = crypto.createPublicKey(privateKey);
		return { privateKey, publicKey, kid: computeKid(publicKey) };
	} catch {
		// Key does not exist yet — generate a fresh Ed25519 keypair
	}

	const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
	const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
	await fsp.mkdir(keyDir, { recursive: true }).catch(() => {});
	await fsp.writeFile(keyPath, pem, { encoding: 'utf8', mode: 0o600 }).catch(() => {});

	return { privateKey, publicKey, kid: computeKid(publicKey) };
}

async function getKeyPair(): Promise<Ed25519KeyPair> {
	if (cachedKeyPair) return cachedKeyPair;
	if (!keyLoadPromise) {
		keyLoadPromise = loadOrGenerateEd25519KeyPair()
			.then((kp) => {
				cachedKeyPair = kp;
				return kp;
			})
			.finally(() => {
				keyLoadPromise = null;
			});
	}
	return keyLoadPromise;
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
	iss: string;
	aud: string;
	sub: string; // user_id
	sid: string; // session_id
	role: 'admin' | 'user';
	fp: string; // User-Agent fingerprint hash
	jti: string;
	iat: number;
	exp: number;
}

export interface TwoFactorChallengePayload {
	iss: string;
	aud: string;
	typ: '2fa_challenge';
	sub: string; // user_id
	ipHash: string;
	jti: string;
	iat: number;
	exp: number;
}

async function signEdDsaJwt(payload: Record<string, unknown>, typ = 'JWT'): Promise<string> {
	const { privateKey, kid } = await getKeyPair();
	const header = base64UrlEncode(JSON.stringify({ alg: 'EdDSA', typ, kid }));
	const body = base64UrlEncode(JSON.stringify(payload));
	const signingInput = `${header}.${body}`;
	const sig = crypto.sign(null, Buffer.from(signingInput, 'utf8'), privateKey);
	return `${signingInput}.${base64UrlEncode(sig)}`;
}

async function verifyEdDsaJwt<T>(token: string, expectedTyp = 'JWT'): Promise<T | null> {
	try {
		const parts = token.split('.');
		if (parts.length !== 3) return null;
		const [headerB64, payloadB64, sigB64] = parts;

		const header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
		if (header.alg !== 'EdDSA' || header.typ !== expectedTyp) return null;

		const { publicKey } = await getKeyPair();
		const sig = base64UrlDecode(sigB64);
		const verified = crypto.verify(
			null,
			Buffer.from(`${headerB64}.${payloadB64}`, 'utf8'),
			publicKey,
			sig
		);
		if (!verified) return null;

		const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as Record<
			string,
			unknown
		>;
		const now = Math.floor(Date.now() / 1000);
		if (
			payload.iss !== JWT_ISSUER ||
			payload.aud !== JWT_AUDIENCE ||
			typeof payload.exp !== 'number' ||
			payload.exp <= now
		) {
			return null;
		}
		return payload as T;
	} catch {
		return null;
	}
}

export function computeClientFingerprint(userAgent: string | null): string {
	return crypto
		.createHash('sha256')
		.update((userAgent || 'unknown').slice(0, 250))
		.digest('base64url')
		.slice(0, 24);
}

export async function signAccessJwt(
	payload: { sub: string; sid: string; role: 'admin' | 'user'; fp: string },
	ttlSeconds = 900 // 15 minutes
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const fullPayload: AccessJwtPayload = {
		iss: JWT_ISSUER,
		aud: JWT_AUDIENCE,
		sub: payload.sub,
		sid: payload.sid,
		role: payload.role,
		fp: payload.fp,
		jti: crypto.randomUUID(),
		iat: now,
		exp: now + ttlSeconds
	};
	return signEdDsaJwt(fullPayload as unknown as Record<string, unknown>, 'JWT');
}

export async function verifyAccessJwt(token: string): Promise<AccessJwtPayload | null> {
	const payload = await verifyEdDsaJwt<AccessJwtPayload>(token, 'JWT');
	if (!payload || !payload.sub || !payload.sid || !payload.jti) return null;
	return payload;
}

export async function signTwoFactorChallenge(
	userId: string,
	ipAddress: string,
	ttlSeconds = 300 // 5 minutes
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const ipHash = crypto.createHash('sha256').update(ipAddress || 'unknown').digest('base64url').slice(0, 24);
	const payload: TwoFactorChallengePayload = {
		iss: JWT_ISSUER,
		aud: JWT_AUDIENCE,
		typ: '2fa_challenge',
		sub: userId,
		ipHash,
		jti: crypto.randomUUID(),
		iat: now,
		exp: now + ttlSeconds
	};
	return signEdDsaJwt(payload as unknown as Record<string, unknown>, 'JWT+2FA');
}

export async function verifyTwoFactorChallenge(
	token: string,
	ipAddress: string
): Promise<TwoFactorChallengePayload | null> {
	const payload = await verifyEdDsaJwt<TwoFactorChallengePayload>(token, 'JWT+2FA');
	if (!payload || payload.typ !== '2fa_challenge' || !payload.sub) return null;
	const expectedIpHash = crypto
		.createHash('sha256')
		.update(ipAddress || 'unknown')
		.digest('base64url')
		.slice(0, 24);
	if (payload.ipHash !== expectedIpHash) return null;
	return payload;
}

export function sha256Hex(value: string): string {
	return crypto.createHash('sha256').update(value).digest('hex');
}
