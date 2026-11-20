import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { logAudit, MIN_WORKSPACE_QUOTA_GB } from '$lib/server/auth';
import { listAllWorkspacesAdmin, slugifyWorkspace } from '$lib/server/workspaces';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}
	const workspaces = await listAllWorkspacesAdmin();
	return json({ workspaces });
};

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	const name = String(body?.name || '').trim();
	const description =
		typeof body?.description === 'string' && body.description.trim()
			? body.description.trim().slice(0, 250)
			: null;
	const color =
		typeof body?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)
			? body.color
			: '#10b981';
	const unlimited = Boolean(body?.unlimited);
	const rawQuotaGb = Number(body?.quota_gb ?? MIN_WORKSPACE_QUOTA_GB);

	if (name.length < 2 || name.length > 100) {
		return json({ error: 'O nome da workspace deve ter entre 2 e 100 caracteres.' }, { status: 400 });
	}
	if (!unlimited && (Number.isNaN(rawQuotaGb) || rawQuotaGb < MIN_WORKSPACE_QUOTA_GB)) {
		return json(
			{ error: `A cota mínima de uma workspace é de ${MIN_WORKSPACE_QUOTA_GB} GB (ou ilimitada).` },
			{ status: 400 }
		);
	}

	const quotaBytes = unlimited ? -1 : Math.round(rawQuotaGb * 1024 * 1024 * 1024);
	const id = crypto.randomUUID();
	const baseSlug = slugifyWorkspace(name);

	const db = getPool();
	let slug = baseSlug;
	const [existingSlug] = await db.query<RowDataPacket[]>(
		'SELECT id FROM workspaces WHERE slug = ? LIMIT 1',
		[slug]
	);
	if (existingSlug.length > 0) {
		slug = `${baseSlug}-${id.slice(0, 6)}`;
	}

	// Workspace is created standalone (no user auto-connected — admin connects users explicitly)
	await db.query(
		`INSERT INTO workspaces (id, name, slug, description, color, quota_bytes, used_bytes, is_active, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)`,
		[id, name, slug, description, color, quotaBytes, locals.user.id]
	);

	await logAudit({
		userId: locals.user.id,
		action: 'admin.workspace_create',
		targetType: 'workspace',
		targetId: id,
		details: `Workspace criada: "${name}" (cota: ${unlimited ? 'Ilimitada' : `${rawQuotaGb} GB`})`,
		ipAddress: getClientAddress()
	});

	return json(
		{
			workspace: {
				id,
				name,
				slug,
				description,
				color,
				quota_bytes: quotaBytes,
				used_bytes: 0,
				is_active: true
			}
		},
		{ status: 201 }
	);
};
