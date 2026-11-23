import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { ensureStorageDir, resolveDiskPath } from '$lib/server/storage';
import { withIoSlot } from '$lib/server/performance';

let cachedFfmpegBin: string | null = null;

export function getFfmpegBinary(): string | null {
	if (cachedFfmpegBin) return cachedFfmpegBin;

	const systemCandidates = [
		'/usr/bin/ffmpeg',
		'/usr/local/bin/ffmpeg',
		typeof ffmpegStatic === 'string' ? ffmpegStatic : ''
	].filter(Boolean);

	for (const candidate of systemCandidates) {
		try {
			fs.accessSync(candidate, fs.constants.X_OK);
			cachedFfmpegBin = candidate;
			return candidate;
		} catch {
			// continue checking
		}
	}

	return null;
}

function runFfmpeg(binary: string, args: string[]): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn(binary, args, {
			stdio: ['ignore', 'ignore', 'ignore']
		});
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			resolve(false);
		}, 15_000);

		child.on('error', () => {
			clearTimeout(timer);
			resolve(false);
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve(code === 0);
		});
	});
}

// Track in-flight thumbnail generations by key so concurrent requests await the same FFmpeg process
const inFlightThumbs = new Map<string, Promise<string | null>>();

/**
 * Generates (and caches on disk under `storage/thumbs/`) a square 480x480 center-cropped
 * JPEG thumbnail for both Videos and Photos using FFmpeg.
 */
export async function getOrCreateSquareThumbnail(params: {
	nodeId: string;
	diskPath: string;
	sha256: string | null;
	category: 'image' | 'video';
}): Promise<string | null> {
	await ensureStorageDir();

	const cacheKey = `${params.nodeId}-${(params.sha256 || 'v1').slice(0, 16)}`;
	const thumbRelPath = path.join('thumbs', `${cacheKey}.jpg`).replace(/\\/g, '/');
	const thumbAbsPath = resolveDiskPath(thumbRelPath);

	try {
		const stat = await fsp.stat(thumbAbsPath);
		if (stat.size > 64) {
			return thumbAbsPath;
		}
	} catch {
		// Not generated yet
	}

	const existingJob = inFlightThumbs.get(cacheKey);
	if (existingJob) {
		return existingJob;
	}

	const job = withIoSlot(async () => {
		const binary = getFfmpegBinary();
		if (!binary) return null;

		const sourceAbsPath = resolveDiskPath(params.diskPath);
		try {
			await fsp.access(sourceAbsPath);
		} catch {
			return null;
		}

		// Square 480x480 center crop filter
		const vf = 'scale=480:480:force_original_aspect_ratio=increase,crop=480:480';
		const tempAbsPath = `${thumbAbsPath}.tmp.jpg`;

		let ok = false;
		if (params.category === 'video') {
			// Try extracting frame at 1.0s first (avoids black initial frames)
			ok = await runFfmpeg(binary, [
				'-y',
				'-ss',
				'00:00:01.000',
				'-i',
				sourceAbsPath,
				'-frames:v',
				'1',
				'-vf',
				vf,
				'-q:v',
				'4',
				tempAbsPath
			]);

			// Fallback to 0.0s if the video is shorter than 1 second
			if (!ok || !(await fileHasBytes(tempAbsPath))) {
				ok = await runFfmpeg(binary, [
					'-y',
					'-ss',
					'00:00:00.000',
					'-i',
					sourceAbsPath,
					'-frames:v',
					'1',
					'-vf',
					vf,
					'-q:v',
					'4',
					tempAbsPath
				]);
			}
		} else {
			// Photo / Image square thumbnail
			ok = await runFfmpeg(binary, [
				'-y',
				'-i',
				sourceAbsPath,
				'-frames:v',
				'1',
				'-vf',
				vf,
				'-q:v',
				'4',
				tempAbsPath
			]);
		}

		if (ok && (await fileHasBytes(tempAbsPath))) {
			await fsp.rename(tempAbsPath, thumbAbsPath).catch(() => {});
			return thumbAbsPath;
		}

		await fsp.unlink(tempAbsPath).catch(() => {});
		return null;
	}).finally(() => {
		inFlightThumbs.delete(cacheKey);
	});

	inFlightThumbs.set(cacheKey, job);
	return job;
}

async function fileHasBytes(absPath: string): Promise<boolean> {
	try {
		const st = await fsp.stat(absPath);
		return st.size > 64;
	} catch {
		return false;
	}
}
