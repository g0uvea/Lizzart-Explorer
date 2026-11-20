import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getBackupRowById, restoreDatabaseFromFile } from '$lib/server/backup';
import { ensureStorageDir, resolveDiskPath } from '$lib/server/storage';
import { logAudit } from '$lib/server/auth';

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}

	const contentType = request.headers.get('content-type') || '';

	try {
		if (contentType.includes('multipart/form-data')) {
			const formData = await request.formData();
			const file = formData.get('backup');
			if (!(file instanceof File) || file.size === 0) {
				return json({ error: 'Envie um arquivo .sql ou .sql.gz válido.' }, { status: 400 });
			}
			const lower = file.name.toLowerCase();
			if (!lower.endsWith('.sql') && !lower.endsWith('.sql.gz') && !lower.endsWith('.gz')) {
				return json({ error: 'Formato inválido. Utilize arquivos .sql ou .sql.gz.' }, { status: 400 });
			}
			const compressed = lower.endsWith('.gz');
			await ensureStorageDir();
			const tempRel = path.join('backups', `restore-upload-${crypto.randomUUID()}${compressed ? '.sql.gz' : '.sql'}`);
			const tempAbs = resolveDiskPath(tempRel);
			await fsp.writeFile(tempAbs, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });

			try {
				const { safetyBackupFile } = await restoreDatabaseFromFile(tempAbs, compressed, locals.user.id);
				await logAudit({
					userId: locals.user.id,
					action: 'admin.db_backup_restore',
					targetType: 'backup',
					details: `Banco restaurado via upload "${file.name}" (snapshot de segurança: ${safetyBackupFile})`,
					ipAddress: getClientAddress()
				});
				return json({ ok: true, safetyBackupFile });
			} finally {
				await fsp.unlink(tempAbs).catch(() => {});
			}
		}

		const body = await request.json().catch(() => null);
		const backupId = typeof body?.backupId === 'string' ? body.backupId.trim() : '';
		if (!backupId) {
			return json({ error: 'Informe backupId ou envie um arquivo de backup.' }, { status: 400 });
		}

		const row = await getBackupRowById(backupId);
		if (!row) {
			return json({ error: 'Backup não encontrado.' }, { status: 404 });
		}

		const absPath = resolveDiskPath(String(row.file_path));
		const { safetyBackupFile } = await restoreDatabaseFromFile(
			absPath,
			Boolean(row.compressed),
			locals.user.id
		);

		await logAudit({
			userId: locals.user.id,
			action: 'admin.db_backup_restore',
			targetType: 'backup',
			targetId: backupId,
			details: `Banco restaurado a partir de "${row.file_name}" (snapshot de segurança: ${safetyBackupFile})`,
			ipAddress: getClientAddress()
		});

		return json({ ok: true, safetyBackupFile });
	} catch (err) {
		return json(
			{ error: err instanceof Error ? err.message : 'Falha ao restaurar banco de dados.' },
			{ status: 500 }
		);
	}
};
