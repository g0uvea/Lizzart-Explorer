import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { getEffectivePermission } from '$lib/server/permissions';
import {
	getWorkspaceMembership,
	workspaceRoleToEffectivePermission
} from '$lib/server/workspaces';
import { sanitizeFileName } from '$lib/server/storage';
import { logAudit } from '$lib/server/auth';

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const body = await request.json().catch(() => null);
	const rawName = String(body?.name || '').trim();
	const parentId = body?.parentId ? String(body.parentId) : null;
	let workspaceId = body?.workspaceId ? String(body.workspaceId) : null;

	if (!rawName) {
		return json({ error: 'Informe um nome para a pasta.' }, { status: 400 });
	}

	const name = sanitizeFileName(rawName);
	let effectivePerm: 'owner' | 'editor' = 'owner';

	if (parentId) {
		const { node: parent, permission } = await getEffectivePermission(locals.user, parentId);
		if (!parent || parent.type !== 'folder' || parent.is_trashed) {
			return json({ error: 'Pasta de destino inválida.' }, { status: 404 });
		}
		if (permission !== 'owner' && permission !== 'editor') {
			return json({ error: 'Sem permissão para criar pastas aqui.' }, { status: 403 });
		}
		workspaceId = parent.workspace_id;
		effectivePerm = permission;
	} else {
		if (!workspaceId) {
			return json({ error: 'Selecione uma workspace para criar a pasta.' }, { status: 400 });
		}
		const membership = await getWorkspaceMembership(locals.user.id, workspaceId);
		if (!membership || membership.role === 'viewer') {
			return json({ error: 'Sem permissão de escrita nesta workspace.' }, { status: 403 });
		}
		effectivePerm = workspaceRoleToEffectivePermission(membership.role) as 'owner' | 'editor';
	}

	const db = getPool();
	const id = crypto.randomUUID();
	await db.query(
		`INSERT INTO storage_nodes (id, workspace_id, created_by, parent_id, type, name)
		 VALUES (?, ?, ?, ?, 'folder', ?)`,
		[id, workspaceId, locals.user.id, parentId, name]
	);

	await logAudit({
		userId: locals.user.id,
		action: 'folder.create',
		targetType: 'folder',
		targetId: id,
		details: `Pasta criada: ${name}`,
		ipAddress: getClientAddress()
	});

	return json(
		{
			node: {
				id,
				workspace_id: workspaceId,
				created_by: locals.user.id,
				parent_id: parentId,
				type: 'folder',
				name,
				mime_type: null,
				size_bytes: 0,
				sha256: null,
				is_starred: false,
				is_trashed: false,
				trashed_at: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				permission: effectivePerm
			}
		},
		{ status: 201 }
	);
};
