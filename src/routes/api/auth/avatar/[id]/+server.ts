import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { Readable } from 'node:stream';
import { getPool } from '$lib/server/db';
import { createFileReadStream, detectMimeType, getFileStat } from '$lib/server/storage';

export const GET: RequestHandler = async ({ params }) => {
	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT avatar_path FROM users WHERE id = ? LIMIT 1',
		[params.id]
	);
	const avatarPath = rows[0]?.avatar_path ? String(rows[0].avatar_path) : null;
	if (!avatarPath) {
		return new Response('Not found', { status: 404 });
	}

	try {
		const stat = await getFileStat(avatarPath);
		const stream = createFileReadStream(avatarPath);
		const webStream = Readable.toWeb(stream) as ReadableStream;
		return new Response(webStream, {
			headers: {
				'Content-Type': detectMimeType(avatarPath),
				'Content-Length': String(stat.size),
				'Cache-Control': 'public, max-age=3600'
			}
		});
	} catch {
		return new Response('Not found', { status: 404 });
	}
};
