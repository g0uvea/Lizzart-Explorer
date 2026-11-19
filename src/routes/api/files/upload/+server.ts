import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { getEffectivePermission } from '$lib/server/permissions';
import {
	detectMimeType,
	recalculateUserUsedBytes,
	sanitizeFileName,
	saveUploadedFile
} from '$lib/server/storage';
import { getSystemSettings, logAudit } from '$lib/server/auth';

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const formData = await request.formData().catch(() => null);
	if (!formData) {
		return json({ error: 'Requisição multipart inválida.' }, { status: 400 });
	}

	const parentIdRaw = formData.get('parentId');
	const parentId =
		typeof parentIdRaw === 'string' && parentIdRaw.trim() && parentIdRaw !== 'null'
			? parentIdRaw.trim()
			: null;

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

	const files = formData.getAll('files').filter((f): f is File => f instanceof File);
	if (files.length === 0) {
		return json({ error: 'Nenhum arquivo enviado.' }, { status: 400 });
	}

	const settings = await getSystemSettings();
	const maxUploadBytes = settings.max_upload_mb * 1024 * 1024;
	const db = getPool();

	const [ownerRows] = await db.query<RowDataPacket[]>(
		'SELECT quota_bytes, used_bytes FROM users WHERE id = ? LIMIT 1',
		[ownerId]
	);
	const quotaBytes = Number(ownerRows[0]?.quota_bytes ?? 0);
	let currentUsed = Number(ownerRows[0]?.used_bytes ?? 0);

	// Pre-validate size and quota
	let batchSize = 0;
	for (const file of files) {
		if (file.size > maxUploadBytes) {
			return json(
				{
					error: `O arquivo "${file.name}" excede o limite de ${settings.max_upload_mb} MB por arquivo.`
				},
				{ status: 413 }
			);
		}
		batchSize += file.size;
	}

	if (quotaBytes >= 0 && currentUsed + batchSize > quotaBytes) {
		return json(
			{ error: 'Espaço insuficiente na cota de armazenamento.' },
			{ status: 413 }
		);
	}

	const created = [];
	const ip = getClientAddress();

	for (const file of files) {
		const cleanName = sanitizeFileName(file.name);
		const mimeType = detectMimeType(cleanName, file.type);
		const { diskPath, sizeBytes, sha256 } = await saveUploadedFile(file);
		const id = crypto.randomUUID();

		await db.query(
			`INSERT INTO storage_nodes (id, owner_id, parent_id, type, name, mime_type, size_bytes, disk_path, sha256)
			 VALUES (?, ?, ?, 'file', ?, ?, ?, ?, ?)`,
			[id, ownerId, parentId, cleanName, mimeType, sizeBytes, diskPath, sha256]
		);

		currentUsed += sizeBytes;
		created.push({
			id,
			owner_id: ownerId,
			parent_id: parentId,
			type: 'file',
			name: cleanName,
			mime_type: mimeType,
			size_bytes: sizeBytes,
			sha256,
			is_starred: false,
			is_trashed: false,
			trashed_at: null,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		});

		await logAudit({
			userId: locals.user.id,
			action: 'file.upload',
			targetType: 'file',
			targetId: id,
			details: `Upload: ${cleanName} (${sizeBytes} bytes)`,
			ipAddress: ip
		});
	}

	const usedBytes = await recalculateUserUsedBytes(ownerId);

	return json({ files: created, used_bytes: usedBytes }, { status: 201 });
};
