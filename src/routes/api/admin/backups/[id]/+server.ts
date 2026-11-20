import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Readable } from 'node:stream';
import { deleteDatabaseBackup, getBackupRowById } from '$lib/server/backup';
import { createFileReadStream, getFileStat } from '$lib/server/storage';
import { logAudit } from '$lib/server/auth';

export const GET: RequestHandler = async ({ locals, params, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return new Response('Acesso restrito a administradores', { status: 403 });
	}

	const row = await getBackupRowById(params.id);
	if (!row) {
		return new Response('Backup não encontrado', { status: 404 });
	}

	const relPath = String(row.file_path);
	let stat;
	try {
		stat = await getFileStat(relPath);
	} catch {
		return new Response('Arquivo de backup não encontrado no disco', { status: 404 });
	}

	await logAudit({
		userId: locals.user.id,
		action: 'admin.db_backup_download',
		targetType: 'backup',
		targetId: params.id,
		details: `Backup baixado: ${row.file_name}`,
		ipAddress: getClientAddress()
	});

	const stream = createFileReadStream(relPath);
	const webStream = Readable.toWeb(stream) as ReadableStream;
	const encodedName = encodeURIComponent(String(row.file_name));

	return new Response(webStream, {
		status: 200,
		headers: {
			'Content-Type': row.compressed ? 'application/gzip' : 'application/sql; charset=utf-8',
			'Content-Length': String(stat.size),
			'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
			'X-Backup-SHA256': String(row.sha256 || '')
		}
	});
};

export const DELETE: RequestHandler = async ({ locals, params, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}

	const row = await getBackupRowById(params.id);
	if (!row) {
		return json({ error: 'Backup não encontrado.' }, { status: 404 });
	}

	await deleteDatabaseBackup(params.id);
	await logAudit({
		userId: locals.user.id,
		action: 'admin.db_backup_delete',
		targetType: 'backup',
		targetId: params.id,
		details: `Backup removido: ${row.file_name}`,
		ipAddress: getClientAddress()
	});

	return json({ ok: true });
};
