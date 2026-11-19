import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { Readable } from 'node:stream';
import { getPool } from '$lib/server/db';
import { verifyPassword } from '$lib/server/crypto';
import { createFileReadStream, getFileStat } from '$lib/server/storage';

export const GET: RequestHandler = async ({ params, url }) => {
	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT sl.*, n.name, n.mime_type, n.disk_path, n.is_trashed
		 FROM share_links sl
		 INNER JOIN storage_nodes n ON n.id = sl.node_id
		 WHERE sl.token = ? AND sl.is_active = 1
		 LIMIT 1`,
		[params.token]
	);

	if (rows.length === 0 || rows[0].is_trashed || !rows[0].disk_path) {
		return new Response('Link inválido ou arquivo removido', { status: 404 });
	}

	const row = rows[0];
	if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
		return new Response('Link expirado', { status: 410 });
	}
	if (row.max_downloads !== null && Number(row.download_count) >= Number(row.max_downloads)) {
		return new Response('Limite de downloads atingido', { status: 410 });
	}

	if (row.password_hash) {
		const password = url.searchParams.get('password') || '';
		const ok = await verifyPassword(password, String(row.password_hash));
		if (!ok) {
			return new Response('Senha obrigatória ou incorreta', { status: 401 });
		}
	}

	let stat;
	try {
		stat = await getFileStat(String(row.disk_path));
	} catch {
		return new Response('Arquivo físico não encontrado', { status: 404 });
	}

	const inline = url.searchParams.get('inline') === '1';
	if (!inline) {
		await db.query('UPDATE share_links SET download_count = download_count + 1 WHERE id = ?', [
			row.id
		]);
	}

	const encodedName = encodeURIComponent(String(row.name));
	const disposition = inline
		? `inline; filename*=UTF-8''${encodedName}`
		: `attachment; filename*=UTF-8''${encodedName}`;

	const stream = createFileReadStream(String(row.disk_path));
	const webStream = Readable.toWeb(stream) as ReadableStream;

	return new Response(webStream, {
		status: 200,
		headers: {
			'Content-Type': String(row.mime_type || 'application/octet-stream'),
			'Content-Length': String(stat.size),
			'Content-Disposition': disposition
		}
	});
};
