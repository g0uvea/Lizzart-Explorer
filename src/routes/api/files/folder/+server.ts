import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { getEffectivePermission } from '$lib/server/permissions';
import { sanitizeFileName } from '$lib/server/storage';
import { logAudit } from '$lib/server/auth';

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const body = await request.json().catch(() => null);
	const rawName = String(body?.name || '').trim();
	const parentId = body?.parentId ? String(body.parentId) : null;

	if (!rawName) {
		return json({ error: 'Informe um nome para a pasta.' }, { status: 400 });
	}

	const name = sanitizeFileName(rawName);
	let ownerId = locals.user.id;

	if (parentId) {
		const { node: parent, permission } = await getEffectivePermission(locals.user, parentId);
		if (!parent || parent.type !== 'folder' || parent.is_trashed) {
			return json({ error: 'Pasta de destino inválida.' }, { status: 404 });
		}
		if (permission !== 'owner' && permission !== 'editor') {
			return json({ error: 'Sem permissão para criar pastas aqui.' }, { status: 403 });
		}
		ownerId = parent.owner_id;
	}

	const db = getPool();
	const id = crypto.randomUUID();
	await db.query(
		`INSERT INTO storage_nodes (id, owner_id, parent_id, type, name)
		 VALUES (?, ?, ?, 'folder', ?)`,
		[id, ownerId, parentId, name]
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
				owner_id: ownerId,
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
				permission: 'owner'
			}
		},
		{ status: 201 }
	);
};
