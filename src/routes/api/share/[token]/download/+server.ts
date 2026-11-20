import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import type fs from 'node:fs';
import { Readable } from 'node:stream';
import { getPool } from '$lib/server/db';
import { verifyPassword } from '$lib/server/crypto';
import { createFileReadStream, getFileStat } from '$lib/server/storage';

type ResolvedShare =
	| { ok: false; error: Response }
	| { ok: true; row: RowDataPacket; stat: fs.Stats };

async function resolvePublicShare(token: string, url: URL): Promise<ResolvedShare> {
	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT sl.*, n.name, n.mime_type, n.disk_path, n.sha256, n.is_trashed
		 FROM share_links sl
		 INNER JOIN storage_nodes n ON n.id = sl.node_id
		 INNER JOIN workspaces w ON w.id = n.workspace_id
		 WHERE sl.token = ? AND sl.is_active = 1 AND w.is_active = 1
		 LIMIT 1`,
		[token]
	);

	if (rows.length === 0 || rows[0].is_trashed || !rows[0].disk_path) {
		return { ok: false, error: new Response('Link inválido ou arquivo removido', { status: 404 }) };
	}

	const row = rows[0];
	if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
		return { ok: false, error: new Response('Link expirado', { status: 410 }) };
	}
	if (row.max_downloads !== null && Number(row.download_count) >= Number(row.max_downloads)) {
		return { ok: false, error: new Response('Limite de downloads atingido', { status: 410 }) };
	}

	if (row.password_hash) {
		const password = url.searchParams.get('password') || '';
		const ok = await verifyPassword(password, String(row.password_hash));
		if (!ok) {
			return { ok: false, error: new Response('Senha obrigatória ou incorreta', { status: 401 }) };
		}
	}

	let stat;
	try {
		stat = await getFileStat(String(row.disk_path));
	} catch {
		return { ok: false, error: new Response('Arquivo físico não encontrado', { status: 404 }) };
	}

	return { ok: true, row, stat };
}

export const HEAD: RequestHandler = async ({ params, url }) => {
	const resolved = await resolvePublicShare(params.token, url);
	if (!resolved.ok) return resolved.error;
	const { row, stat } = resolved;
	return new Response(null, {
		status: 200,
		headers: {
			'Content-Type': String(row.mime_type || 'application/octet-stream'),
			'Content-Length': String(stat.size),
			'Accept-Ranges': 'bytes',
			...(row.sha256 ? { ETag: `"${row.sha256}"` } : {})
		}
	});
};

export const GET: RequestHandler = async ({ params, url, request }) => {
	const resolved = await resolvePublicShare(params.token, url);
	if (!resolved.ok) return resolved.error;
	const { row, stat } = resolved;

	const fileSize = stat.size;
	const inline = url.searchParams.get('inline') === '1';
	const etag = row.sha256 ? `"${row.sha256}"` : null;
	const ifRange = request.headers.get('if-range');
	let rangeHeader = request.headers.get('range');
	if (ifRange && etag && ifRange.trim() !== etag) {
		rangeHeader = null;
	}

	if (!inline && (!rangeHeader || rangeHeader.startsWith('bytes=0-'))) {
		const db = getPool();
		await db.query('UPDATE share_links SET download_count = download_count + 1 WHERE id = ?', [
			row.id
		]);
	}

	const encodedName = encodeURIComponent(String(row.name));
	const disposition = inline
		? `inline; filename*=UTF-8''${encodedName}`
		: `attachment; filename*=UTF-8''${encodedName}`;

	const commonHeaders: Record<string, string> = {
		'Content-Type': String(row.mime_type || 'application/octet-stream'),
		'Accept-Ranges': 'bytes',
		'Content-Disposition': disposition,
		...(etag ? { ETag: etag } : {})
	};

	if (rangeHeader && fileSize > 0) {
		const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
		if (match) {
			const start = match[1] ? parseInt(match[1], 10) : 0;
			const end = match[2] ? Math.min(parseInt(match[2], 10), fileSize - 1) : fileSize - 1;
			if (start <= end && start < fileSize) {
				const chunkSize = end - start + 1;
				const stream = createFileReadStream(String(row.disk_path), start, end);
				const webStream = Readable.toWeb(stream) as ReadableStream;
				return new Response(webStream, {
					status: 206,
					headers: {
						...commonHeaders,
						'Content-Length': String(chunkSize),
						'Content-Range': `bytes ${start}-${end}/${fileSize}`,
						'Cache-Control': 'no-transform'
					}
				});
			}
		}
	}

	const stream = createFileReadStream(String(row.disk_path));
	const webStream = Readable.toWeb(stream) as ReadableStream;

	return new Response(webStream, {
		status: 200,
		headers: {
			...commonHeaders,
			'Content-Length': String(fileSize)
		}
	});
};
