import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { removeTempFile, writeChunkAtOffset } from '$lib/server/storage';

const MAX_CHUNK_BYTES = 64 * 1024 * 1024 + 1024; // 64 MB max adaptive chunk

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT * FROM upload_sessions WHERE id = ? AND user_id = ? AND status = 'uploading' LIMIT 1`,
		[params.uploadId, locals.user.id]
	);

	if (rows.length === 0) {
		return json({ error: 'Sessão de upload não encontrada ou já finalizada.' }, { status: 404 });
	}

	const session = rows[0];
	const offset = Number(request.headers.get('x-chunk-offset') ?? '-1');
	const totalBytes = Number(session.total_bytes);

	if (Number.isNaN(offset) || offset < 0 || offset > totalBytes) {
		return json({ error: 'Offset de chunk inválido.' }, { status: 400 });
	}

	const rawBuf = new Uint8Array(await request.arrayBuffer());
	if (rawBuf.byteLength > MAX_CHUNK_BYTES) {
		return json({ error: 'Chunk excede o tamanho máximo de 64 MB.' }, { status: 413 });
	}
	if (offset + rawBuf.byteLength > totalBytes) {
		return json({ error: 'Chunk ultrapassa o tamanho total declarado do arquivo.' }, { status: 400 });
	}

	const newEnd = offset + rawBuf.byteLength;
	await writeChunkAtOffset(String(session.temp_path), offset, rawBuf);

	const uploadedBytes = Math.max(Number(session.uploaded_bytes), newEnd);
	await db.query('UPDATE upload_sessions SET uploaded_bytes = ? WHERE id = ?', [
		uploadedBytes,
		session.id
	]);

	return json({
		ok: true,
		uploadedBytes,
		chunkBytes: rawBuf.byteLength
	});
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT temp_path FROM upload_sessions WHERE id = ? AND user_id = ? LIMIT 1',
		[params.uploadId, locals.user.id]
	);
	if (rows.length > 0) {
		await removeTempFile(String(rows[0].temp_path));
		await db.query("UPDATE upload_sessions SET status = 'aborted' WHERE id = ?", [params.uploadId]);
	}

	return json({ ok: true });
};
