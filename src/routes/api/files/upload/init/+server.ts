import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { getEffectivePermission } from '$lib/server/permissions';
import {
	createChunkTempFile,
	detectMimeType,
	getFileStat,
	sanitizeFileName
} from '$lib/server/storage';
import { getSystemSettings } from '$lib/server/auth';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Requisição inválida.' }, { status: 400 });

	const rawName = String(body.fileName || '').trim();
	const totalBytes = Number(body.totalBytes ?? -1);
	const fingerprint = String(body.fingerprint || '').trim().slice(0, 240);
	const parentId =
		typeof body.parentId === 'string' && body.parentId.trim() && body.parentId !== 'null'
			? body.parentId.trim()
			: null;

	if (!rawName || totalBytes < 0 || !fingerprint) {
		return json({ error: 'Metadados de upload inválidos.' }, { status: 400 });
	}

	let ownerId = locals.user.id;
	if (parentId) {
		const { node: parent, permission } = await getEffectivePermission(locals.user, parentId);
		if (!parent || parent.type !== 'folder' || parent.is_trashed) {
			return json({ error: 'Pasta de destino inválida.' }, { status: 404 });
		}
		if (permission !== 'owner' && permission !== 'editor') {
			return json({ error: 'Sem permissão para enviar arquivos para esta pasta.' }, { status: 403 });
		}
		ownerId = parent.owner_id;
	}

	const settings = await getSystemSettings();
	const maxUploadBytes = settings.max_upload_mb * 1024 * 1024;
	if (totalBytes > maxUploadBytes) {
		return json(
			{ error: `O arquivo excede o limite de ${settings.max_upload_mb} MB configurado.` },
			{ status: 413 }
		);
	}

	const db = getPool();

	// Check if there is an existing resumable session for this user + fingerprint + parent
	const [existingRows] = await db.query<RowDataPacket[]>(
		`SELECT * FROM upload_sessions
		 WHERE user_id = ? AND fingerprint = ? AND status = 'uploading'
		   AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
		 ORDER BY updated_at DESC
		 LIMIT 1`,
		[locals.user.id, fingerprint, parentId, parentId]
	);

	if (existingRows.length > 0) {
		const session = existingRows[0];
		let diskSize = 0;
		try {
			const stat = await getFileStat(String(session.temp_path));
			diskSize = stat.size;
		} catch {
			// Recreate temp file if vanished
			await createChunkTempFile(String(session.id));
			diskSize = 0;
		}
		const safeOffset = Math.min(diskSize, Number(session.uploaded_bytes), totalBytes);
		if (safeOffset !== Number(session.uploaded_bytes)) {
			await db.query('UPDATE upload_sessions SET uploaded_bytes = ? WHERE id = ?', [
				safeOffset,
				session.id
			]);
		}

		return json({
			uploadId: String(session.id),
			uploadedBytes: safeOffset,
			resumed: safeOffset > 0
		});
	}

	// Verify owner quota before creating a new upload session
	const [ownerRows] = await db.query<RowDataPacket[]>(
		'SELECT quota_bytes, used_bytes FROM users WHERE id = ? LIMIT 1',
		[ownerId]
	);
	const quotaBytes = Number(ownerRows[0]?.quota_bytes ?? 0);
	const usedBytes = Number(ownerRows[0]?.used_bytes ?? 0);
	if (quotaBytes >= 0 && usedBytes + totalBytes > quotaBytes) {
		return json({ error: 'Espaço insuficiente na cota de armazenamento.' }, { status: 413 });
	}

	const cleanName = sanitizeFileName(rawName);
	const mimeType = detectMimeType(cleanName, typeof body.mimeType === 'string' ? body.mimeType : undefined);
	const uploadId = crypto.randomUUID();
	const tempPath = await createChunkTempFile(uploadId);

	await db.query(
		`INSERT INTO upload_sessions
		 (id, user_id, owner_id, parent_id, fingerprint, file_name, mime_type, total_bytes, uploaded_bytes, temp_path, status)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'uploading')`,
		[uploadId, locals.user.id, ownerId, parentId, fingerprint, cleanName, mimeType, totalBytes, tempPath]
	);

	return json({ uploadId, uploadedBytes: 0, resumed: false }, { status: 201 });
};
