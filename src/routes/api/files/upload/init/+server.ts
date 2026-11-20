import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { getEffectivePermission } from '$lib/server/permissions';
import { getWorkspaceMembership } from '$lib/server/workspaces';
import {
	createChunkTempFile,
	detectMimeType,
	getFileStat,
	MAX_UPLOAD_CHUNK_BYTES,
	MIN_UPLOAD_CHUNK_BYTES,
	sanitizeFileName,
	truncateTempFile
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
	let workspaceId =
		typeof body.workspaceId === 'string' && body.workspaceId.trim() && body.workspaceId !== 'null'
			? body.workspaceId.trim()
			: null;

	if (!rawName || totalBytes < 0 || !fingerprint) {
		return json({ error: 'Metadados de upload inválidos.' }, { status: 400 });
	}

	if (parentId) {
		const { node: parent, permission } = await getEffectivePermission(locals.user, parentId);
		if (!parent || parent.type !== 'folder' || parent.is_trashed) {
			return json({ error: 'Pasta de destino inválida.' }, { status: 404 });
		}
		if (permission !== 'owner' && permission !== 'editor') {
			return json(
				{ error: 'Sem permissão para enviar arquivos para esta pasta.' },
				{ status: 403 }
			);
		}
		workspaceId = parent.workspace_id;
	} else {
		if (!workspaceId) {
			return json({ error: 'Selecione uma workspace para fazer upload.' }, { status: 400 });
		}
		const membership = await getWorkspaceMembership(locals.user.id, workspaceId);
		if (!membership || membership.role === 'viewer') {
			return json(
				{ error: 'Sem permissão de escrita nesta workspace.' },
				{ status: 403 }
			);
		}
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

	// Look for an existing resumable upload session (e.g., after power loss / network outage / browser reload)
	const [existingRows] = await db.query<RowDataPacket[]>(
		`SELECT * FROM upload_sessions
		 WHERE user_id = ? AND workspace_id = ? AND fingerprint = ? AND status = 'uploading'
		   AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
		 ORDER BY updated_at DESC
		 LIMIT 1`,
		[locals.user.id, workspaceId, fingerprint, parentId, parentId]
	);

	if (existingRows.length > 0) {
		const session = existingRows[0];
		const tempPath = String(session.temp_path);
		let diskSize = 0;
		try {
			const stat = await getFileStat(tempPath);
			diskSize = stat.size;
		} catch {
			await createChunkTempFile(String(session.id));
			diskSize = 0;
		}

		// Crash-safe recovery: confirmed durable offset is min(diskSize, db uploaded_bytes, totalBytes).
		// Truncate any unconfirmed partial tail bytes written right before a power outage!
		const dbUploaded = Number(session.uploaded_bytes);
		const safeOffset = Math.min(diskSize, dbUploaded, totalBytes);
		if (diskSize > safeOffset) {
			await truncateTempFile(tempPath, safeOffset).catch(() => {});
		}
		if (safeOffset !== dbUploaded) {
			await db.query('UPDATE upload_sessions SET uploaded_bytes = ? WHERE id = ?', [
				safeOffset,
				session.id
			]);
		}

		return json({
			uploadId: String(session.id),
			workspaceId,
			uploadedBytes: safeOffset,
			resumed: safeOffset > 0,
			minChunkBytes: MIN_UPLOAD_CHUNK_BYTES,
			maxChunkBytes: MAX_UPLOAD_CHUNK_BYTES
		});
	}

	// Verify workspace quota before starting a new upload session
	const [wsRows] = await db.query<RowDataPacket[]>(
		'SELECT quota_bytes, used_bytes FROM workspaces WHERE id = ? LIMIT 1',
		[workspaceId]
	);
	if (wsRows.length === 0) {
		return json({ error: 'Workspace não encontrada.' }, { status: 404 });
	}
	const quotaBytes = Number(wsRows[0].quota_bytes ?? 0);
	const usedBytes = Number(wsRows[0].used_bytes ?? 0);
	if (quotaBytes >= 0 && usedBytes + totalBytes > quotaBytes) {
		return json(
			{ error: 'Espaço insuficiente na cota de armazenamento desta workspace.' },
			{ status: 413 }
		);
	}

	const cleanName = sanitizeFileName(rawName);
	const mimeType = detectMimeType(
		cleanName,
		typeof body.mimeType === 'string' ? body.mimeType : undefined
	);
	const uploadId = crypto.randomUUID();
	const tempPath = await createChunkTempFile(uploadId);

	await db.query(
		`INSERT INTO upload_sessions
		 (id, workspace_id, user_id, parent_id, fingerprint, file_name, mime_type, total_bytes, uploaded_bytes, temp_path, status)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'uploading')`,
		[
			uploadId,
			workspaceId,
			locals.user.id,
			parentId,
			fingerprint,
			cleanName,
			mimeType,
			totalBytes,
			tempPath
		]
	);

	return json(
		{
			uploadId,
			workspaceId,
			uploadedBytes: 0,
			resumed: false,
			minChunkBytes: MIN_UPLOAD_CHUNK_BYTES,
			maxChunkBytes: MAX_UPLOAD_CHUNK_BYTES
		},
		{ status: 201 }
	);
};
