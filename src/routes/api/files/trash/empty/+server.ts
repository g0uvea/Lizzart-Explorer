import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { deleteDiskBlobIfUnreferenced, recalculateUserUsedBytes } from '$lib/server/storage';
import { logAudit } from '$lib/server/auth';

export const POST: RequestHandler = async ({ locals, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const db = getPool();
	const [trashedRows] = await db.query<RowDataPacket[]>(
		'SELECT id, disk_path FROM storage_nodes WHERE owner_id = ? AND is_trashed = 1',
		[locals.user.id]
	);

	const diskPaths = trashedRows
		.map((r) => (r.disk_path ? String(r.disk_path) : null))
		.filter((p): p is string => Boolean(p));

	await db.query('DELETE FROM storage_nodes WHERE owner_id = ? AND is_trashed = 1', [
		locals.user.id
	]);

	for (const dp of new Set(diskPaths)) {
		await deleteDiskBlobIfUnreferenced(dp);
	}

	const usedBytes = await recalculateUserUsedBytes(locals.user.id);

	await logAudit({
		userId: locals.user.id,
		action: 'trash.empty',
		targetType: 'user',
		targetId: locals.user.id,
		details: `Lixeira esvaziada (${trashedRows.length} itens removidos)`,
		ipAddress: getClientAddress()
	});

	return json({ ok: true, deletedCount: trashedRows.length, used_bytes: usedBytes });
};
