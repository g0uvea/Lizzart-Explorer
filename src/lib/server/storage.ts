import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { getPerformanceConfig, withIoSlot } from '$lib/server/performance';

export const MIN_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_UPLOAD_CHUNK_BYTES = 20 * 1024 * 1024; // 20 MB hard cap

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
			error:
				err instanceof Error ? err.message : 'Diretório inacessível ou sem permissão de escrita.'
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

export async function migrateStorageDirectory(
	oldResolved: string,
	newResolved: string
): Promise<number> {
	if (path.resolve(oldResolved) === path.resolve(newResolved)) return 0;
	let total = 0;
	for (const sub of ['blobs', 'avatars', 'backups']) {
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
		fsp.mkdir(path.join(storageRootResolved, 'avatars'), { recursive: true }),
		fsp.mkdir(path.join(storageRootResolved, 'backups'), { recursive: true })
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

/**
 * Truncates unconfirmed trailing bytes on a .part file after an abrupt power outage or crash
 * so resuming always starts cleanly from the exact durable byte boundary.
 */
export async function truncateTempFile(tempRelPath: string, safeSize: number): Promise<void> {
	const absPath = resolveDiskPath(tempRelPath);
	const handle = await fsp.open(absPath, 'r+');
	try {
		await handle.truncate(safeSize);
		await handle.datasync();
	} finally {
		await handle.close();
	}
}

/**
 * Streams an incoming chunk directly to disk at `offset` without loading the entire 20 MB chunk
 * into server RAM, optionally verifies SHA-256, and flushes with `datasync()` for power-loss durability.
 */
export async function writeChunkStreamAtOffset(params: {
	tempRelPath: string;
	offset: number;
	totalBytes: number;
	body: ReadableStream<Uint8Array>;
	maxChunkBytes?: number;
	expectedSha256?: string | null;
}): Promise<{ bytesWritten: number; sha256: string }> {
	const maxAllowed = params.maxChunkBytes ?? MAX_UPLOAD_CHUNK_BYTES;

	return withIoSlot(async () => {
		await ensureStorageDir();
		const absPath = resolveDiskPath(params.tempRelPath);
		const handle = await fsp.open(absPath, 'r+').catch(async () => fsp.open(absPath, 'w+'));

		let written = 0;
		const hash = crypto.createHash('sha256');
		const reader = params.body.getReader();

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!value || value.byteLength === 0) continue;

				if (written + value.byteLength > maxAllowed) {
					throw Object.assign(
						new Error(`Chunk excede o limite máximo de ${Math.round(maxAllowed / (1024 * 1024))} MB.`),
						{ statusCode: 413 }
					);
				}
				if (params.offset + written + value.byteLength > params.totalBytes) {
					throw Object.assign(
						new Error('Chunk ultrapassa o tamanho total declarado do arquivo.'),
						{ statusCode: 400 }
					);
				}

				hash.update(value);
				await handle.write(value, 0, value.byteLength, params.offset + written);
				written += value.byteLength;
			}

			const computedSha = hash.digest('hex');
			if (
				params.expectedSha256 &&
				params.expectedSha256.toLowerCase() !== computedSha.toLowerCase()
			) {
				// Roll back unverified trailing bytes if this chunk extended the file
				await handle.truncate(params.offset).catch(() => {});
				throw Object.assign(
					new Error('Falha de integridade SHA-256 no bloco recebido. Reenvie o chunk.'),
					{ statusCode: 422 }
				);
			}

			// Flush written bytes to persistent storage so power outages never corrupt confirmed offsets
			await handle.datasync();
			return { bytesWritten: written, sha256: computedSha };
		} catch (err) {
			reader.cancel().catch(() => {});
			throw err;
		} finally {
			await handle.close();
		}
	});
}

export async function finalizeChunkTempFile(tempRelPath: string): Promise<{
	diskPath: string;
	sizeBytes: number;
	sha256: string;
}> {
	return withIoSlot(async () => {
		await ensureStorageDir();
		const absTemp = resolveDiskPath(tempRelPath);
		const stat = await fsp.stat(absTemp);
		const hwm = getPerformanceConfig().streamHighWaterMark;

		const sha256 = await new Promise<string>((resolve, reject) => {
			const hash = crypto.createHash('sha256');
			const rs = fs.createReadStream(absTemp, { highWaterMark: hwm });
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
	});
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
	return withIoSlot(async () => {
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
	});
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

export function createFileReadStream(
	relativePath: string,
	start?: number,
	end?: number
): fs.ReadStream {
	const absPath = resolveDiskPath(relativePath);
	const highWaterMark = getPerformanceConfig().streamHighWaterMark;
	return fs.createReadStream(
		absPath,
		start !== undefined ? { start, end, highWaterMark } : { highWaterMark }
	);
}

export async function getFileStat(relativePath: string) {
	const absPath = resolveDiskPath(relativePath);
	return fsp.stat(absPath);
}
