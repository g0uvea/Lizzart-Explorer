import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { deleteDiskBlobIfUnreferenced } from '$lib/server/storage';
import { getWorkspaceMembership, recalculateWorkspaceUsedBytes } from '$lib/server/workspaces';
import { logAudit } from '$lib/server/auth';

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const body = await request.json().catch(() => null);
	const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId.trim() : '';
	if (!workspaceId) {
		return json({ error: 'Informe a workspace.' }, { status: 400 });
	}

	const membership = await getWorkspaceMembership(locals.user.id, workspaceId);
	if (!membership || membership.role !== 'manager') {
		return json(
			{ error: 'Apenas gestores da workspace podem esvaziar a lixeira.' },
			{ status: 403 }
		);
	}

	const db = getPool();
	const [trashedRows] = await db.query<RowDataPacket[]>(
		'SELECT id, disk_path FROM storage_nodes WHERE workspace_id = ? AND is_trashed = 1',
		[workspaceId]
	);

	const diskPaths = trashedRows
		.map((r) => (r.disk_path ? String(r.disk_path) : null))
		.filter((p): p is string => Boolean(p));

	await db.query('DELETE FROM storage_nodes WHERE workspace_id = ? AND is_trashed = 1', [
		workspaceId
	]);

	for (const dp of new Set(diskPaths)) {
		await deleteDiskBlobIfUnreferenced(dp);
	}

	const usedBytes = await recalculateWorkspaceUsedBytes(workspaceId);

	await logAudit({
		userId: locals.user.id,
		action: 'trash.empty',
		targetType: 'workspace',
		targetId: workspaceId,
		details: `Lixeira da workspace "${membership.workspace.name}" esvaziada (${trashedRows.length} itens)`,
		ipAddress: getClientAddress()
	});

	return json({ ok: true, deletedCount: trashedRows.length, used_bytes: usedBytes });
};
