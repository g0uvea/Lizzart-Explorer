import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createDatabaseBackup,
	listDatabaseBackups,
	pruneOldBackups
} from '$lib/server/backup';
import { getSystemSettings, logAudit } from '$lib/server/auth';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}

	const [backups, settings] = await Promise.all([listDatabaseBackups(), getSystemSettings()]);
	return json({
		backups,
		auto_backup_interval: settings.auto_backup_interval,
		backup_retention_count: settings.backup_retention_count
	});
};

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}

	const body = await request.json().catch(() => ({}));
	const compress = body?.compress !== false;

	try {
		const backup = await createDatabaseBackup({
			compress,
			createdBy: locals.user.id
		});
		const settings = await getSystemSettings();
		await pruneOldBackups(settings.backup_retention_count);

		await logAudit({
			userId: locals.user.id,
			action: 'admin.db_backup_create',
			targetType: 'backup',
			targetId: backup.id,
			details: `Backup criado (${backup.method}): ${backup.file_name} (${backup.size_bytes} bytes)`,
			ipAddress: getClientAddress()
		});

		return json({ backup }, { status: 201 });
	} catch (err) {
		return json(
			{
				error: err instanceof Error ? err.message : 'Erro ao gerar backup do MariaDB.'
			},
			{ status: 500 }
		);
	}
};
