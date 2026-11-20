import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { logAudit, MIN_WORKSPACE_QUOTA_GB } from '$lib/server/auth';
import { deleteDiskBlobIfUnreferenced, removeTempFile } from '$lib/server/storage';

export const PATCH: RequestHandler = async ({ locals, params, request, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Dados inválidos.' }, { status: 400 });

	const updates: string[] = [];
	const values: unknown[] = [];

	if (typeof body.name === 'string' && body.name.trim().length >= 2) {
		updates.push('name = ?');
		values.push(body.name.trim().slice(0, 100));
	}
	if (body.description !== undefined) {
		const desc = typeof body.description === 'string' && body.description.trim()
			? body.description.trim().slice(0, 250)
			: null;
		updates.push('description = ?');
		values.push(desc);
	}
	if (typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)) {
		updates.push('color = ?');
		values.push(body.color);
	}
	if (typeof body.is_active === 'boolean') {
		updates.push('is_active = ?');
		values.push(body.is_active ? 1 : 0);
	}
	if (body.quota_gb !== undefined) {
		const gb = Number(body.quota_gb);
		if (Number.isNaN(gb) || (gb >= 0 && gb < MIN_WORKSPACE_QUOTA_GB)) {
			return json(
				{ error: `A cota mínima permitida para workspaces é de ${MIN_WORKSPACE_QUOTA_GB} GB (ou ilimitada).` },
				{ status: 400 }
			);
		}
		updates.push('quota_bytes = ?');
		values.push(gb < 0 ? -1 : Math.round(gb * 1024 * 1024 * 1024));
	}

	if (updates.length === 0) {
		return json({ error: 'Nenhuma alteração fornecida.' }, { status: 400 });
	}

	const db = getPool();
	values.push(params.id);
	await db.query(`UPDATE workspaces SET ${updates.join(', ')} WHERE id = ?`, values);

	await logAudit({
		userId: locals.user.id,
		action: 'admin.workspace_update',
		targetType: 'workspace',
		targetId: params.id,
		details: 'Configurações da workspace atualizadas',
		ipAddress: getClientAddress()
	});

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}

	const db = getPool();
	const [wsRows] = await db.query<RowDataPacket[]>(
		'SELECT name FROM workspaces WHERE id = ? LIMIT 1',
		[params.id]
	);
	if (wsRows.length === 0) {
		return json({ error: 'Workspace não encontrada.' }, { status: 404 });
	}
	const wsName = String(wsRows[0].name);

	const [fileRows] = await db.query<RowDataPacket[]>(
		'SELECT disk_path FROM storage_nodes WHERE workspace_id = ? AND disk_path IS NOT NULL',
		[params.id]
	);
	const diskPaths = fileRows.map((r) => String(r.disk_path));

	const [tempRows] = await db.query<RowDataPacket[]>(
		'SELECT temp_path FROM upload_sessions WHERE workspace_id = ?',
		[params.id]
	);

	// Deleting workspace cascades storage_nodes, upload_sessions, workspace_members, share_links, node_permissions
	await db.query('DELETE FROM workspaces WHERE id = ?', [params.id]);

	for (const dp of new Set(diskPaths)) {
		await deleteDiskBlobIfUnreferenced(dp);
	}
	for (const t of tempRows) {
		if (t.temp_path) await removeTempFile(String(t.temp_path));
	}

	await logAudit({
		userId: locals.user.id,
		action: 'admin.workspace_delete',
		targetType: 'workspace',
		targetId: params.id,
		details: `Workspace "${wsName}" excluída (${diskPaths.length} arquivos removidos do disco)`,
		ipAddress: getClientAddress()
	});

	return json({ ok: true, removedFiles: diskPaths.length });
};
