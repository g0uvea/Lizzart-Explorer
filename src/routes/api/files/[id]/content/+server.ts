import type { RequestHandler } from './$types';
import { Readable } from 'node:stream';
import { getEffectivePermission } from '$lib/server/permissions';
import { createFileReadStream, getFileStat } from '$lib/server/storage';
import { logAudit } from '$lib/server/auth';

export const GET: RequestHandler = async ({ locals, params, url, request, getClientAddress }) => {
	if (!locals.user) {
		return new Response('Não autenticado', { status: 401 });
	}

	const { node, permission } = await getEffectivePermission(locals.user, params.id);
	if (!node || !permission || node.type !== 'file' || !node.disk_path) {
		return new Response('Arquivo não encontrado ou sem permissão', { status: 404 });
	}

	let stat;
	try {
		stat = await getFileStat(node.disk_path);
	} catch {
		return new Response('Arquivo físico não encontrado no disco', { status: 404 });
	}

	const fileSize = stat.size;
	const download = url.searchParams.get('download') === '1';
	const mime = node.mime_type || 'application/octet-stream';
	const encodedName = encodeURIComponent(node.name);
	const disposition = download
		? `attachment; filename*=UTF-8''${encodedName}`
		: `inline; filename*=UTF-8''${encodedName}`;

	if (download) {
		await logAudit({
			userId: locals.user.id,
			action: 'file.download',
			targetType: 'file',
			targetId: node.id,
			details: `Download: ${node.name}`,
			ipAddress: getClientAddress()
		});
	}

	const rangeHeader = request.headers.get('range');
	if (rangeHeader && fileSize > 0) {
		const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
		if (match) {
			const start = match[1] ? parseInt(match[1], 10) : 0;
			const end = match[2] ? Math.min(parseInt(match[2], 10), fileSize - 1) : fileSize - 1;
			if (start <= end && start < fileSize) {
				const chunkSize = end - start + 1;
				const stream = createFileReadStream(node.disk_path, start, end);
				const webStream = Readable.toWeb(stream) as ReadableStream;
				return new Response(webStream, {
					status: 206,
					headers: {
						'Content-Type': mime,
						'Content-Length': String(chunkSize),
						'Content-Range': `bytes ${start}-${end}/${fileSize}`,
						'Accept-Ranges': 'bytes',
						'Content-Disposition': disposition
					}
				});
			}
		}
	}

	const stream = createFileReadStream(node.disk_path);
	const webStream = Readable.toWeb(stream) as ReadableStream;
	return new Response(webStream, {
		status: 200,
		headers: {
			'Content-Type': mime,
			'Content-Length': String(fileSize),
			'Accept-Ranges': 'bytes',
			'Content-Disposition': disposition,
			'Cache-Control': 'private, max-age=60'
		}
	});
};
