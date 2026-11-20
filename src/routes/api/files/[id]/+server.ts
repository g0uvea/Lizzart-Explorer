import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { collectDescendantNodeIds, getEffectivePermission } from '$lib/server/permissions';
import { deleteDiskBlobIfUnreferenced, sanitizeFileName } from '$lib/server/storage';
import { recalculateWorkspaceUsedBytes } from '$lib/server/workspaces';
import { logAudit } from '$lib/server/auth';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const { node, permission } = await getEffectivePermission(locals.user, params.id);
	if (!node || !permission) {
		return json({ error: 'Item não encontrado ou sem permissão.' }, { status: 404 });
	}

	return json({
		node: {
			id: node.id,
			workspace_id: node.workspace_id,
			created_by: node.created_by,
			parent_id: node.parent_id,
			type: node.type,
			name: node.name,
			mime_type: node.mime_type,
			size_bytes: Number(node.size_bytes),
			sha256: node.sha256,
			is_starred: Boolean(node.is_starred),
			is_trashed: Boolean(node.is_trashed),
			trashed_at: node.trashed_at,
			created_at: node.created_at,
			updated_at: node.updated_at,
			permission
		}
	});
};

export const PATCH: RequestHandler = async ({ locals, params, request, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const { node, permission } = await getEffectivePermission(locals.user, params.id);
	if (!node || !permission) {
		return json({ error: 'Item não encontrado ou sem permissão.' }, { status: 404 });
	}

	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Dados inválidos.' }, { status: 400 });

	const db = getPool();
	const ip = getClientAddress();

	// Star/unstar (manager or editor)
	if (typeof body.is_starred === 'boolean') {
		if (permission !== 'owner' && permission !== 'editor') {
			return json({ error: 'Sem permissão para favoritar este item.' }, { status: 403 });
		}
		await db.query('UPDATE storage_nodes SET is_starred = ? WHERE id = ?', [
			body.is_starred ? 1 : 0,
			node.id
		]);
	}

	// Restore from trash (manager or editor)
	if (body.restore === true) {
		if (permission !== 'owner' && permission !== 'editor') {
			return json({ error: 'Sem permissão para restaurar.' }, { status: 403 });
		}
		let targetParentId = node.parent_id;
		if (targetParentId) {
			const [pRows] = await db.query<RowDataPacket[]>(
				'SELECT id, is_trashed FROM storage_nodes WHERE id = ? AND workspace_id = ? LIMIT 1',
				[targetParentId, node.workspace_id]
			);
			if (pRows.length === 0 || pRows[0].is_trashed) {
				targetParentId = null;
			}
		}

		await db.query(
			'UPDATE storage_nodes SET is_trashed = 0, trashed_at = NULL, parent_id = ? WHERE id = ?',
			[targetParentId, node.id]
		);

		if (node.type === 'folder') {
			const descendants = await collectDescendantNodeIds(node.id);
			if (descendants.length > 0) {
				const ids = descendants.map((d) => d.id);
				const placeholders = ids.map(() => '?').join(',');
				await db.query(
					`UPDATE storage_nodes SET is_trashed = 0, trashed_at = NULL WHERE id IN (${placeholders})`,
					ids
				);
			}
		}

		await logAudit({
			userId: locals.user.id,
			action: 'node.restore',
			targetType: node.type,
			targetId: node.id,
			details: `Restaurado da lixeira: ${node.name}`,
			ipAddress: ip
		});
		return json({ ok: true });
	}

	// Rename (manager or editor)
	if (typeof body.name === 'string') {
		if (permission !== 'owner' && permission !== 'editor') {
			return json({ error: 'Sem permissão para renomear.' }, { status: 403 });
		}
		const cleanName = sanitizeFileName(body.name);
		await db.query('UPDATE storage_nodes SET name = ? WHERE id = ?', [cleanName, node.id]);
		await logAudit({
			userId: locals.user.id,
			action: 'node.rename',
			targetType: node.type,
			targetId: node.id,
			details: `Renomeado de "${node.name}" para "${cleanName}"`,
			ipAddress: ip
		});
	}

	// Move to another folder inside the same workspace (manager or editor)
	if (body.parent_id !== undefined) {
		if (permission !== 'owner' && permission !== 'editor') {
			return json({ error: 'Sem permissão para mover este item.' }, { status: 403 });
		}
		const newParentId = body.parent_id ? String(body.parent_id) : null;

		if (newParentId === node.id) {
			return json(
				{ error: 'Não é possível mover uma pasta para dentro de si mesma.' },
				{ status: 400 }
			);
		}

		if (newParentId) {
			const [pRows] = await db.query<RowDataPacket[]>(
				`SELECT id, workspace_id, type, is_trashed FROM storage_nodes WHERE id = ? LIMIT 1`,
				[newParentId]
			);
			if (
				pRows.length === 0 ||
				String(pRows[0].workspace_id) !== node.workspace_id ||
				pRows[0].type !== 'folder' ||
				pRows[0].is_trashed
			) {
				return json({ error: 'Pasta de destino inválida nesta workspace.' }, { status: 400 });
			}

			if (node.type === 'folder') {
				const descendants = await collectDescendantNodeIds(node.id);
				if (descendants.some((d) => d.id === newParentId)) {
					return json(
						{ error: 'Não é possível mover uma pasta para uma de suas subpastas.' },
						{ status: 400 }
					);
				}
			}
		}

		await db.query('UPDATE storage_nodes SET parent_id = ? WHERE id = ?', [newParentId, node.id]);
		await logAudit({
			userId: locals.user.id,
			action: 'node.move',
			targetType: node.type,
			targetId: node.id,
			details: `Movido: ${node.name}`,
			ipAddress: ip
		});
	}

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params, url, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const { node, permission } = await getEffectivePermission(locals.user, params.id);
	if (!node || !permission) {
		return json({ error: 'Item não encontrado.' }, { status: 404 });
	}

	const permanent = url.searchParams.get('permanent') === 'true';
	if (permanent && permission !== 'owner') {
		return json(
			{ error: 'Apenas gestores da workspace podem excluir permanentemente.' },
			{ status: 403 }
		);
	}
	if (!permanent && permission !== 'owner' && permission !== 'editor') {
		return json({ error: 'Sem permissão para excluir.' }, { status: 403 });
	}

	const db = getPool();
	const ip = getClientAddress();

	if (!permanent) {
		const now = new Date();
		await db.query('UPDATE storage_nodes SET is_trashed = 1, trashed_at = ? WHERE id = ?', [
			now,
			node.id
		]);
		if (node.type === 'folder') {
			const descendants = await collectDescendantNodeIds(node.id);
			if (descendants.length > 0) {
				const ids = descendants.map((d) => d.id);
				const placeholders = ids.map(() => '?').join(',');
				await db.query(
					`UPDATE storage_nodes SET is_trashed = 1, trashed_at = ? WHERE id IN (${placeholders})`,
					[now, ...ids]
				);
			}
		}

		await logAudit({
			userId: locals.user.id,
			action: 'node.trash',
			targetType: node.type,
			targetId: node.id,
			details: `Enviado para lixeira: ${node.name}`,
			ipAddress: ip
		});
		return json({ ok: true });
	}

	const diskPaths: string[] = [];
	if (node.disk_path) diskPaths.push(node.disk_path);

	if (node.type === 'folder') {
		const descendants = await collectDescendantNodeIds(node.id);
		for (const d of descendants) {
			if (d.disk_path) diskPaths.push(d.disk_path);
		}
	}

	await db.query('DELETE FROM storage_nodes WHERE id = ?', [node.id]);

	for (const dp of new Set(diskPaths)) {
		await deleteDiskBlobIfUnreferenced(dp);
	}

	const usedBytes = await recalculateWorkspaceUsedBytes(node.workspace_id);

	await logAudit({
		userId: locals.user.id,
		action: 'node.delete_permanent',
		targetType: node.type,
		targetId: node.id,
		details: `Excluído permanentemente: ${node.name}`,
		ipAddress: ip
	});

	return json({ ok: true, used_bytes: usedBytes });
};
