import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';

let storageRootRaw = process.env.STORAGE_ROOT || './storage';
let storageRootResolved = path.resolve(process.cwd(), storageRootRaw);

export function getStorageRootRaw(): string {
	return storageRootRaw;
}

export function getStorageRoot(): string {
	return storageRootResolved;
}

export function setStorageRoot(nextPath: string): string {
	storageRootRaw = nextPath.trim() || './storage';
	storageRootResolved = path.resolve(process.cwd(), storageRootRaw);
	return storageRootResolved;
}

export async function inspectStorageDirectory(candidatePath: string): Promise<{
	ok: boolean;
	resolvedPath: string;
	freeBytes?: number;
	totalBytes?: number;
	error?: string;
}> {
	const resolved = path.resolve(process.cwd(), candidatePath.trim() || './storage');
	try {
		await fsp.mkdir(resolved, { recursive: true });
		// Verify write permission with a temporary probe file
		const probe = path.join(resolved, `.lizzart-probe-${Date.now()}`);
		await fsp.writeFile(probe, 'ok');
		await fsp.unlink(probe);

		let freeBytes: number | undefined;
		let totalBytes: number | undefined;
		if (typeof fsp.statfs === 'function') {
			const stats = await fsp.statfs(resolved);
			freeBytes = Number(stats.bavail) * Number(stats.bsize);
			totalBytes = Number(stats.blocks) * Number(stats.bsize);
		}
		return { ok: true, resolvedPath: resolved, freeBytes, totalBytes };
	} catch (err) {
		return {
			ok: false,
			resolvedPath: resolved,
			error: err instanceof Error ? err.message : 'Diretório inacessível ou sem permissão de escrita.'
		};
	}
}

async function copyDirRecursive(src: string, dest: string): Promise<number> {
	let movedCount = 0;
	let entries: fs.Dirent[];
	try {
		entries = await fsp.readdir(src, { withFileTypes: true });
	} catch {
		return 0;
	}
	await fsp.mkdir(dest, { recursive: true });
	for (const entry of entries) {
		const sPath = path.join(src, entry.name);
		const dPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			movedCount += await copyDirRecursive(sPath, dPath);
		} else {
			await fsp.copyFile(sPath, dPath);
			movedCount++;
		}
	}
	return movedCount;
}

export async function migrateStorageDirectory(oldResolved: string, newResolved: string): Promise<number> {
	if (path.resolve(oldResolved) === path.resolve(newResolved)) return 0;
	let total = 0;
	for (const sub of ['blobs', 'avatars']) {
		const src = path.join(oldResolved, sub);
		const dst = path.join(newResolved, sub);
		total += await copyDirRecursive(src, dst);
	}
	return total;
}

export async function ensureStorageDir(): Promise<void> {
	await Promise.all([
		fsp.mkdir(path.join(storageRootResolved, 'blobs'), { recursive: true }),
		fsp.mkdir(path.join(storageRootResolved, 'chunks'), { recursive: true }),
		fsp.mkdir(path.join(storageRootResolved, 'avatars'), { recursive: true })
	]);
}

export function sanitizeFileName(name: string): string {
	const trimmed = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
	return trimmed.slice(0, 240) || 'arquivo_sem_nome';
}

export function resolveDiskPath(relativePath: string): string {
	const full = path.resolve(storageRootResolved, relativePath);
	if (!full.startsWith(storageRootResolved + path.sep) && full !== storageRootResolved) {
		throw new Error('Caminho de armazenamento inválido');
	}
	return full;
}

export async function createChunkTempFile(uploadId: string): Promise<string> {
	await ensureStorageDir();
	const relPath = path.join('chunks', `${uploadId}.part`).replace(/\\/g, '/');
	const absPath = resolveDiskPath(relPath);
	const handle = await fsp.open(absPath, 'a');
	await handle.close();
	return relPath;
}

export async function writeChunkAtOffset(
	tempRelPath: string,
	offset: number,
	data: Uint8Array
): Promise<number> {
	await ensureStorageDir();
	const absPath = resolveDiskPath(tempRelPath);
	const handle = await fsp.open(absPath, 'r+').catch(async () => fsp.open(absPath, 'w+'));
	try {
		await handle.write(data, 0, data.byteLength, offset);
	} finally {
		await handle.close();
	}
	const stat = await fsp.stat(absPath);
	return stat.size;
}

export async function finalizeChunkTempFile(tempRelPath: string): Promise<{
	diskPath: string;
	sizeBytes: number;
	sha256: string;
}> {
	await ensureStorageDir();
	const absTemp = resolveDiskPath(tempRelPath);
	const stat = await fsp.stat(absTemp);

	const sha256 = await new Promise<string>((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const rs = fs.createReadStream(absTemp);
		rs.on('data', (chunk) => hash.update(chunk));
		rs.on('end', () => resolve(hash.digest('hex')));
		rs.on('error', reject);
	});

	const id = crypto.randomUUID();
	const prefix = id.slice(0, 2);
	const relDir = path.join('blobs', prefix);
	const absDir = path.join(storageRootResolved, relDir);
	await fsp.mkdir(absDir, { recursive: true });

	const relPath = path.join(relDir, id).replace(/\\/g, '/');
	const absFinal = resolveDiskPath(relPath);
	await fsp.rename(absTemp, absFinal);

	return {
		diskPath: relPath,
		sizeBytes: stat.size,
		sha256
	};
}

export async function removeTempFile(tempRelPath: string | null): Promise<void> {
	if (!tempRelPath) return;
	try {
		await fsp.unlink(resolveDiskPath(tempRelPath));
	} catch {
		// ignore missing temp file
	}
}

export async function saveBufferAsBlob(buffer: Buffer): Promise<{
	diskPath: string;
	sizeBytes: number;
	sha256: string;
}> {
	await ensureStorageDir();
	const id = crypto.randomUUID();
	const prefix = id.slice(0, 2);
	const relDir = path.join('blobs', prefix);
	const absDir = path.join(storageRootResolved, relDir);
	await fsp.mkdir(absDir, { recursive: true });

	const relPath = path.join(relDir, id).replace(/\\/g, '/');
	const absPath = resolveDiskPath(relPath);
	await fsp.writeFile(absPath, buffer);
	const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

	return {
		diskPath: relPath,
		sizeBytes: buffer.byteLength,
		sha256
	};
}

export async function saveAvatarFile(userId: string, file: File): Promise<string> {
	await ensureStorageDir();
	const ext = (path.extname(file.name).toLowerCase() || '.png').replace(/[^.a-z0-9]/g, '');
	const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext) ? ext : '.png';
	const relPath = path.join('avatars', `${userId}-${Date.now()}${safeExt}`).replace(/\\/g, '/');
	const absPath = resolveDiskPath(relPath);
	const buf = Buffer.from(await file.arrayBuffer());
	await fsp.writeFile(absPath, buf);
	return relPath;
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
		'.bmp': 'image/bmp',
		'.avif': 'image/avif',
		'.ico': 'image/x-icon',
		'.mp4': 'video/mp4',
		'.webm': 'video/webm',
		'.mkv': 'video/x-matroska',
		'.mov': 'video/quicktime',
		'.avi': 'video/x-msvideo',
		'.mp3': 'audio/mpeg',
		'.wav': 'audio/wav',
		'.ogg': 'audio/ogg',
		'.flac': 'audio/flac',
		'.m4a': 'audio/mp4',
		'.opus': 'audio/opus',
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
