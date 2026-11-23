import type { RequestHandler } from './$types';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { getEffectivePermission } from '$lib/server/permissions';
import { getOrCreateSquareThumbnail } from '$lib/server/thumbnails';
import { createFileReadStream, getFileStat } from '$lib/server/storage';
import { getFileCategory } from '$lib/utils';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) {
		return new Response('Não autenticado.', { status: 401 });
	}

	const { node, permission } = await getEffectivePermission(locals.user, params.id);
	if (!node || !permission || node.type !== 'file' || !node.disk_path || node.is_trashed) {
		return new Response('Arquivo não encontrado.', { status: 404 });
	}

	const category = getFileCategory('file', node.mime_type, node.name);
	if (category !== 'image' && category !== 'video') {
		return new Response('Thumbnail não suportada para este formato.', { status: 400 });
	}

	// SVG images can be served directly
	if ((node.mime_type || '').toLowerCase() === 'image/svg+xml' || node.name.toLowerCase().endsWith('.svg')) {
		const stat = await getFileStat(node.disk_path);
		const stream = createFileReadStream(node.disk_path);
		return new Response(Readable.toWeb(stream) as ReadableStream, {
			status: 200,
			headers: {
				'Content-Type': 'image/svg+xml',
				'Content-Length': String(stat.size),
				'Cache-Control': 'private, max-age=86400'
			}
		});
	}

	const thumbAbsPath = await getOrCreateSquareThumbnail({
		nodeId: node.id,
		diskPath: node.disk_path,
		sha256: node.sha256,
		category
	});

	if (thumbAbsPath) {
		const stat = await fs.promises.stat(thumbAbsPath);
		const stream = fs.createReadStream(thumbAbsPath);
		return new Response(Readable.toWeb(stream) as ReadableStream, {
			status: 200,
			headers: {
				'Content-Type': 'image/jpeg',
				'Content-Length': String(stat.size),
				'Cache-Control': 'private, max-age=86400'
			}
		});
	}

	// Fallback for images if FFmpeg couldn't decode an exotic format: stream original image
	if (category === 'image') {
		const stat = await getFileStat(node.disk_path);
		const stream = createFileReadStream(node.disk_path);
		return new Response(Readable.toWeb(stream) as ReadableStream, {
			status: 200,
			headers: {
				'Content-Type': node.mime_type || 'image/jpeg',
				'Content-Length': String(stat.size),
				'Cache-Control': 'private, max-age=3600'
			}
		});
	}

	return new Response('Não foi possível gerar thumbnail.', { status: 404 });
};
