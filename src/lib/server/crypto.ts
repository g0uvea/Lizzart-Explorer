import crypto from 'node:crypto';
import { updateEnvVariables } from '$lib/server/envConfig';
import { getPerformanceConfig } from '$lib/server/performance';

interface BunPasswordApi {
	hash(
		password: string,
		opts?: { algorithm: 'argon2id'; memoryCost: number; timeCost: number }
	): Promise<string>;
	verify(password: string, hash: string): Promise<boolean>;
}

function getBunPassword(): BunPasswordApi | null {
	const g = globalThis as unknown as { Bun?: { password?: BunPasswordApi } };
	return g.Bun?.password ?? null;
}

// ============================================================================
// Master Key + HKDF-SHA256 Subkey Derivation + AES-256-GCM Encryption at Rest
// ============================================================================
let cachedMasterKey: Buffer | null = null;
const derivedKeyCache = new Map<string, Buffer>();

export async function getMasterKey(): Promise<Buffer> {
	if (cachedMasterKey) return cachedMasterKey;

	const envKey = process.env.APP_MASTER_KEY?.trim() || process.env.JWT_SECRET?.trim();
	if (envKey && envKey.length >= 32) {
		cachedMasterKey = crypto.createHash('sha256').update(envKey).digest();
		return cachedMasterKey;
	}

	// Auto-generate a 512-bit master key and persist in .env (0600)
	const generatedHex = crypto.randomBytes(64).toString('hex');
	cachedMasterKey = crypto.createHash('sha256').update(generatedHex).digest();
	await updateEnvVariables({ APP_MASTER_KEY: generatedHex }).catch(() => {});
	return cachedMasterKey;
}

export async function deriveSubkey(purpose: string, length = 32): Promise<Buffer> {
	const cacheKey = `${purpose}:${length}`;
	const existing = derivedKeyCache.get(cacheKey);
	if (existing) return existing;

	const ikm = await getMasterKey();
	const raw = crypto.hkdfSync(
		'sha256',
		ikm,
		Buffer.from('lizzart-explorer-hkdf-salt-v2', 'utf8'),
		Buffer.from(`lizzart:${purpose}`, 'utf8'),
		length
	);
	const keyBuf = Buffer.from(raw);
	derivedKeyCache.set(cacheKey, keyBuf);
	return keyBuf;
}

const ENC_PREFIX = 'enc:v1:';

/**
 * Authenticated encryption at rest using AES-256-GCM with HKDF-derived purpose key
 * and Associated Authenticated Data (AAD) preventing cross-field ciphertext substitution.
 */
export async function encryptAtRest(plaintext: string, purpose: string, aad = ''): Promise<string> {
	const key = await deriveSubkey(`aes-gcm:${purpose}`, 32);
	const iv = crypto.randomBytes(12); // 96-bit NIST recommended GCM nonce
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	if (aad) {
		cipher.setAAD(Buffer.from(aad, 'utf8'));
	}
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${ENC_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

/**
 * Decrypts AES-256-GCM ciphertext. Seamlessly supports legacy unencrypted values
 * (values without the `enc:v1:` prefix) for smooth zero-downtime migration.
 */
export async function decryptAtRest(stored: string, purpose: string, aad = ''): Promise<string> {
	if (!stored.startsWith(ENC_PREFIX)) {
		return stored;
	}
	const payload = stored.slice(ENC_PREFIX.length);
	const parts = payload.split(':');
	if (parts.length !== 3) {
		throw new Error('Ciphertext malformado.');
	}
	const [ivB64, tagB64, dataB64] = parts;
	const key = await deriveSubkey(`aes-gcm:${purpose}`, 32);
	const iv = Buffer.from(ivB64, 'base64url');
	const tag = Buffer.from(tagB64, 'base64url');
	const data = Buffer.from(dataB64, 'base64url');

	const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(tag);
	if (aad) {
		decipher.setAAD(Buffer.from(aad, 'utf8'));
	}
	const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
	return decrypted.toString('utf8');
}

export function isEncryptedAtRest(stored: string | null | undefined): boolean {
	return Boolean(stored && stored.startsWith(ENC_PREFIX));
}

/**
 * Keyed HMAC-SHA512 token digest (pepper derived via HKDF) for storing refresh tokens
 * safely in MariaDB without ever storing raw tokens or unsalted digests.
 */
export async function hashOpaqueToken(token: string): Promise<string> {
	const pepper = await deriveSubkey('refresh-token-hmac', 64);
	return crypto.createHmac('sha512', pepper).update(token).digest('hex');
}

// ============================================================================
// Password Hashing: Argon2id (OWASP tuned to performance profile) + scrypt
// ============================================================================
let dummyHashPromise: Promise<string> | null = null;

export async function hashPassword(password: string): Promise<string> {
	const perf = getPerformanceConfig();
	const bunPassword = getBunPassword();
	if (bunPassword) {
		return await bunPassword.hash(password, {
			algorithm: 'argon2id',
			memoryCost: perf.argon2MemoryKiB,
			timeCost: perf.argon2TimeCost
		});
	}
	const salt = crypto.randomBytes(16).toString('hex');
	const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
	return `scrypt:${salt}:${derived}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
	if (!storedHash) return false;
	if (storedHash.startsWith('scrypt:')) {
		const [, salt, hash] = storedHash.split(':');
		if (!salt || !hash) return false;
		const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
		const expected = Buffer.from(hash, 'hex');
		if (derived.length !== expected.length) return false;
		return crypto.timingSafeEqual(derived, expected);
	}
	const bunPassword = getBunPassword();
	if (bunPassword) {
		return await bunPassword.verify(password, storedHash);
	}
	return false;
}

export function passwordNeedsRehash(storedHash: string): boolean {
	const bunPassword = getBunPassword();
	if (bunPassword && storedHash.startsWith('scrypt:')) return true;
	return false;
}

/**
 * Constant-time dummy password verification to prevent username enumeration via login timing.
 */
export async function verifyDummyPassword(password: string): Promise<void> {
	if (!dummyHashPromise) {
		dummyHashPromise = hashPassword('lizzart-dummy-anti-enumeration-secret-v2');
	}
	const dummy = await dummyHashPromise;
	await verifyPassword(password, dummy).catch(() => {});
}

export function generateToken(bytes = 48): string {
	return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
	return crypto.createHash('sha256').update(value).digest('hex');
}
