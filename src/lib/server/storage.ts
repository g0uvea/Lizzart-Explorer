import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';

const STORAGE_ROOT = path.resolve(process.cwd(), process.env.STORAGE_ROOT || './storage');
const BLOBS_DIR = path.join(STORAGE_ROOT, 'blobs');

export function getStorageRoot(): string {
	return STORAGE_ROOT;
}

export async function ensureStorageDir(): Promise<void> {
	await fsp.mkdir(BLOBS_DIR, { recursive: true });
}

export function sanitizeFileName(name: string): string {
	const trimmed = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
	return trimmed.slice(0, 240) || 'arquivo_sem_nome';
}

export function resolveDiskPath(relativePath: string): string {
	const full = path.resolve(STORAGE_ROOT, relativePath);
	if (!full.startsWith(STORAGE_ROOT + path.sep) && full !== STORAGE_ROOT) {
		throw new Error('Caminho de armazenamento inválido');
	}
	return full;
}

export async function saveUploadedFile(file: File): Promise<{
	diskPath: string;
	sizeBytes: number;
	sha256: string;
}> {
	await ensureStorageDir();

	const id = crypto.randomUUID();
	const prefix = id.slice(0, 2);
	const relDir = path.join('blobs', prefix);
	const absDir = path.join(STORAGE_ROOT, relDir);
	await fsp.mkdir(absDir, { recursive: true });

	const relPath = path.join(relDir, id).replace(/\\/g, '/');
	const absPath = resolveDiskPath(relPath);

	const hash = crypto.createHash('sha256');
	const writeStream = fs.createWriteStream(absPath);
	const reader = file.stream().getReader();
	let totalBytes = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				const buf = Buffer.from(value);
				totalBytes += buf.length;
				hash.update(buf);
				if (!writeStream.write(buf)) {
					await new Promise<void>((resolve) => writeStream.once('drain', resolve));
				}
			}
		}

		await new Promise<void>((resolve, reject) => {
			writeStream.end(() => resolve());
			writeStream.on('error', reject);
		});

		return {
			diskPath: relPath,
			sizeBytes: totalBytes,
			sha256: hash.digest('hex')
		};
	} catch (err) {
		writeStream.destroy();
		await fsp.unlink(absPath).catch(() => {});
		throw err;
	}
}

export async function deleteDiskBlobIfUnreferenced(diskPath: string | null): Promise<void> {
	if (!diskPath) return;
	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT COUNT(*) AS refs FROM storage_nodes WHERE disk_path = ?',
		[diskPath]
	);
	const refs = Number(rows[0]?.refs ?? 0);
	if (refs === 0) {
		try {
			const absPath = resolveDiskPath(diskPath);
			await fsp.unlink(absPath);
		} catch {
			// File already removed or missing
		}
	}
}

export async function recalculateUserUsedBytes(userId: string): Promise<number> {
	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT COALESCE(SUM(size_bytes), 0) AS total
		 FROM storage_nodes
		 WHERE owner_id = ? AND type = 'file'`,
		[userId]
	);
	const total = Number(rows[0]?.total ?? 0);
	await db.query('UPDATE users SET used_bytes = ? WHERE id = ?', [total, userId]);
	return total;
}

export function detectMimeType(fileName: string, providedMime?: string): string {
	if (providedMime && providedMime !== 'application/octet-stream') {
		return providedMime;
	}
	const ext = path.extname(fileName).toLowerCase();
	const map: Record<string, string> = {
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.gif': 'image/gif',
		'.webp': 'image/webp',
		'.svg': 'image/svg+xml',
		'.ico': 'image/x-icon',
		'.mp4': 'video/mp4',
		'.webm': 'video/webm',
		'.mkv': 'video/x-matroska',
		'.mov': 'video/quicktime',
		'.mp3': 'audio/mpeg',
		'.wav': 'audio/wav',
		'.ogg': 'audio/ogg',
		'.flac': 'audio/flac',
		'.pdf': 'application/pdf',
		'.txt': 'text/plain',
		'.md': 'text/markdown',
		'.json': 'application/json',
		'.xml': 'application/xml',
		'.yaml': 'text/yaml',
		'.yml': 'text/yaml',
		'.toml': 'text/plain',
		'.ini': 'text/plain',
		'.properties': 'text/plain',
		'.log': 'text/plain',
		'.csv': 'text/csv',
		'.html': 'text/html',
		'.css': 'text/css',
		'.js': 'text/javascript',
		'.ts': 'text/typescript',
		'.svelte': 'text/plain',
		'.sql': 'text/plain',
		'.sh': 'text/x-shellscript',
		'.zip': 'application/zip',
		'.tar': 'application/x-tar',
		'.gz': 'application/gzip',
		'.7z': 'application/x-7z-compressed',
		'.rar': 'application/vnd.rar',
		'.jar': 'application/java-archive'
	};
	return map[ext] || providedMime || 'application/octet-stream';
}

export function createFileReadStream(relativePath: string, start?: number, end?: number): fs.ReadStream {
	const absPath = resolveDiskPath(relativePath);
	return fs.createReadStream(absPath, start !== undefined ? { start, end } : undefined);
}

export async function getFileStat(relativePath: string) {
	const absPath = resolveDiskPath(relativePath);
	return fsp.stat(absPath);
}
