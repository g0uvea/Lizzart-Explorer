import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import {
	getFileStat,
	MAX_UPLOAD_CHUNK_BYTES,
	removeTempFile,
	writeChunkStreamAtOffset
} from '$lib/server/storage';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT * FROM upload_sessions WHERE id = ? AND user_id = ? LIMIT 1',
		[params.uploadId, locals.user.id]
	);
	if (rows.length === 0) {
		return json({ error: 'Sessão de upload não encontrada.' }, { status: 404 });
	}
	const s = rows[0];
	let diskSize = 0;
	try {
		const stat = await getFileStat(String(s.temp_path));
		diskSize = stat.size;
	} catch {
		diskSize = 0;
	}
	const confirmedBytes = Math.min(diskSize, Number(s.uploaded_bytes), Number(s.total_bytes));
	return json({
		uploadId: String(s.id),
		status: String(s.status),
		totalBytes: Number(s.total_bytes),
		uploadedBytes: confirmedBytes
	});
};

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
	const currentUploaded = Number(session.uploaded_bytes);
	const expectedSha = request.headers.get('x-chunk-sha256')?.trim() || null;

	// Enforce sequential/non-gapped offsets so sparse holes can never corrupt files after power loss
	if (Number.isNaN(offset) || offset < 0 || offset > totalBytes || offset > currentUploaded) {
		return json(
			{
				error: 'Offset de chunk inválido ou fora de sequência.',
				expectedOffset: currentUploaded
			},
			{ status: 409 }
		);
	}

	// Fast reject declared oversized chunks before reading body
	const contentLength = Number(request.headers.get('content-length') || 0);
	if (contentLength > MAX_UPLOAD_CHUNK_BYTES) {
		return json(
			{ error: 'Chunk excede o limite máximo permitido de 20 MB.' },
			{ status: 413 }
		);
	}

	if (!request.body) {
		return json({ error: 'Corpo do bloco vazio.' }, { status: 400 });
	}

	try {
		const { bytesWritten, sha256 } = await writeChunkStreamAtOffset({
			tempRelPath: String(session.temp_path),
			offset,
			totalBytes,
			body: request.body,
			maxChunkBytes: MAX_UPLOAD_CHUNK_BYTES,
			expectedSha256: expectedSha
		});

		const newEnd = offset + bytesWritten;
		const uploadedBytes = Math.max(currentUploaded, newEnd);
		await db.query('UPDATE upload_sessions SET uploaded_bytes = ? WHERE id = ?', [
			uploadedBytes,
			session.id
		]);

		return json({
			ok: true,
			uploadedBytes,
			chunkBytes: bytesWritten,
			chunkSha256: sha256
		});
	} catch (err) {
		const statusCode =
			typeof (err as { statusCode?: number })?.statusCode === 'number'
				? (err as { statusCode: number }).statusCode
				: 500;
		return json(
			{ error: err instanceof Error ? err.message : 'Erro ao gravar bloco no disco.' },
			{ status: statusCode }
		);
	}
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
		await db.query("UPDATE upload_sessions SET status = 'aborted' WHERE id = ?", [
			params.uploadId
		]);
	}

	return json({ ok: true });
};
