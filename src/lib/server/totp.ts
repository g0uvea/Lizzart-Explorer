import crypto from 'node:crypto';
import QRCode from 'qrcode';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(lengthBytes = 20): string {
	const buf = crypto.randomBytes(lengthBytes);
	let bits = 0;
	let value = 0;
	let output = '';

	for (const byte of buf) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) {
		output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
	}
	return output;
}

function decodeBase32(input: string): Buffer {
	const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
	let bits = 0;
	let value = 0;
	const bytes: number[] = [];

	for (const char of cleaned) {
		const idx = BASE32_ALPHABET.indexOf(char);
		if (idx === -1) continue;
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			bytes.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}
	return Buffer.from(bytes);
}

export function generateTotpCode(secretBase32: string, stepOffset = 0): string {
	const key = decodeBase32(secretBase32);
	const counter = Math.floor(Date.now() / 1000 / 30) + stepOffset;
	const counterBuf = Buffer.alloc(8);
	counterBuf.writeBigUInt64BE(BigInt(counter));

	const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
	const offset = hmac[hmac.length - 1] & 0x0f;
	const binary =
		((hmac[offset] & 0x7f) << 24) |
		((hmac[offset + 1] & 0xff) << 16) |
		((hmac[offset + 2] & 0xff) << 8) |
		(hmac[offset + 3] & 0xff);

	return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secretBase32: string, code: string, window = 1): boolean {
	const clean = code.replace(/\s+/g, '');
	if (!/^\d{6}$/.test(clean)) return false;

	for (let offset = -window; offset <= window; offset++) {
		const expected = generateTotpCode(secretBase32, offset);
		if (crypto.timingSafeEqual(Buffer.from(clean), Buffer.from(expected))) {
			return true;
		}
	}
	return false;
}

export function buildOtpAuthUri(username: string, secretBase32: string): string {
	const issuer = 'Lizzart Explorer';
	const label = encodeURIComponent(`${issuer}:${username}`);
	return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export async function generateQrCodeDataUrl(uri: string): Promise<string> {
	return QRCode.toDataURL(uri, {
		width: 220,
		margin: 2,
		color: {
			dark: '#0b101b',
			light: '#ffffff'
		}
	});
}
