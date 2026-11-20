import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { finalizeChunkTempFile, removeTempFile } from '$lib/server/storage';
import { recalculateWorkspaceUsedBytes } from '$lib/server/workspaces';
import { logAudit } from '$lib/server/auth';

export const POST: RequestHandler = async ({ locals, params, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT * FROM upload_sessions WHERE id = ? AND user_id = ? AND status = 'uploading' LIMIT 1`,
		[params.uploadId, locals.user.id]
	);

	if (rows.length === 0) {
		return json({ error: 'Sessão de upload não encontrada.' }, { status: 404 });
	}

	const session = rows[0];
	const totalBytes = Number(session.total_bytes);
	const confirmedBytes = Number(session.uploaded_bytes);

	if (confirmedBytes !== totalBytes) {
		return json(
			{
				error: `Upload incompleto (${confirmedBytes} de ${totalBytes} bytes confirmados). Retome o envio.`
			},
			{ status: 409 }
		);
	}

	let finalized;
	try {
		finalized = await finalizeChunkTempFile(String(session.temp_path));
	} catch {
		return json({ error: 'Arquivo parcial não encontrado para finalização.' }, { status: 400 });
	}

	if (finalized.sizeBytes !== totalBytes) {
		await removeTempFile(finalized.diskPath);
		return json(
			{
				error: `Tamanho final divergente (${finalized.sizeBytes} de ${totalBytes} bytes). Retome o envio.`
			},
			{ status: 409 }
		);
	}

	const nodeId = crypto.randomUUID();
	const workspaceId = String(session.workspace_id);
	const parentId = session.parent_id ? String(session.parent_id) : null;
	const fileName = String(session.file_name);
	const mimeType = String(session.mime_type || 'application/octet-stream');

	await db.query(
		`INSERT INTO storage_nodes (id, workspace_id, created_by, parent_id, type, name, mime_type, size_bytes, disk_path, sha256)
		 VALUES (?, ?, ?, ?, 'file', ?, ?, ?, ?, ?)`,
		[
			nodeId,
			workspaceId,
			locals.user.id,
			parentId,
			fileName,
			mimeType,
			finalized.sizeBytes,
			finalized.diskPath,
			finalized.sha256
		]
	);

	await db.query(
		"UPDATE upload_sessions SET status = 'completed', uploaded_bytes = ? WHERE id = ?",
		[finalized.sizeBytes, session.id]
	);

	const usedBytes = await recalculateWorkspaceUsedBytes(workspaceId);

	await logAudit({
		userId: locals.user.id,
		action: 'file.upload',
		targetType: 'file',
		targetId: nodeId,
		details: `Upload retomável concluído: ${fileName} (${finalized.sizeBytes} bytes)`,
		ipAddress: getClientAddress()
	});

	return json(
		{
			file: {
				id: nodeId,
				workspace_id: workspaceId,
				created_by: locals.user.id,
				parent_id: parentId,
				type: 'file',
				name: fileName,
				mime_type: mimeType,
				size_bytes: finalized.sizeBytes,
				sha256: finalized.sha256,
				is_starred: false,
				is_trashed: false,
				trashed_at: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			},
			used_bytes: usedBytes
		},
		{ status: 201 }
	);
};
