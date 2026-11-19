import crypto from 'node:crypto';

interface BunPasswordApi {
	hash(password: string, opts?: { algorithm: 'argon2id'; memoryCost: number; timeCost: number }): Promise<string>;
	verify(password: string, hash: string): Promise<boolean>;
}

function getBunPassword(): BunPasswordApi | null {
	const g = globalThis as unknown as { Bun?: { password?: BunPasswordApi } };
	return g.Bun?.password ?? null;
}

export async function hashPassword(password: string): Promise<string> {
	const bunPassword = getBunPassword();
	if (bunPassword) {
		return await bunPassword.hash(password, {
			algorithm: 'argon2id',
			memoryCost: 19456,
			timeCost: 2
		});
	}
	const salt = crypto.randomBytes(16).toString('hex');
	const derived = crypto.scryptSync(password, salt, 64).toString('hex');
	return `scrypt:${salt}:${derived}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
	if (storedHash.startsWith('scrypt:')) {
		const [, salt, hash] = storedHash.split(':');
		if (!salt || !hash) return false;
		const derived = crypto.scryptSync(password, salt, 64);
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

export function generateToken(bytes = 32): string {
	return crypto.randomBytes(bytes).toString('hex');
}
