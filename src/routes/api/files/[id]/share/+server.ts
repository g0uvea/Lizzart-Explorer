import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { getNodeById } from '$lib/server/permissions';
import { generateToken, hashPassword } from '$lib/server/crypto';
import { logAudit } from '$lib/server/auth';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const node = await getNodeById(params.id);
	if (!node || (node.owner_id !== locals.user.id && locals.user.role !== 'admin')) {
		return json({ error: 'Sem permissão para gerenciar compartilhamentos deste item.' }, { status: 403 });
	}

	const db = getPool();
	const [permRows] = await db.query<RowDataPacket[]>(
		`SELECT np.id, np.node_id, np.user_id, np.permission, np.created_at,
		        u.name AS user_name, u.email AS user_email, u.avatar_color
		 FROM node_permissions np
		 INNER JOIN users u ON u.id = np.user_id
		 WHERE np.node_id = ?
		 ORDER BY np.created_at DESC`,
		[node.id]
	);

	const [linkRows] = await db.query<RowDataPacket[]>(
		`SELECT id, node_id, token, (password_hash IS NOT NULL) AS has_password,
		        expires_at, max_downloads, download_count, is_active, created_at
		 FROM share_links
		 WHERE node_id = ?
		 ORDER BY created_at DESC`,
		[node.id]
	);

	return json({
		permissions: permRows.map((r) => ({
			id: String(r.id),
			node_id: String(r.node_id),
			user_id: String(r.user_id),
			user_name: String(r.user_name),
			user_email: String(r.user_email),
			avatar_color: String(r.avatar_color || '#6366f1'),
			permission: r.permission === 'editor' ? 'editor' : 'viewer',
			created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
		})),
		links: linkRows.map((r) => ({
			id: String(r.id),
			node_id: String(r.node_id),
			token: String(r.token),
			has_password: Boolean(r.has_password),
			expires_at: r.expires_at
				? r.expires_at instanceof Date
					? r.expires_at.toISOString()
					: String(r.expires_at)
				: null,
			max_downloads: r.max_downloads !== null ? Number(r.max_downloads) : null,
			download_count: Number(r.download_count ?? 0),
			is_active: Boolean(r.is_active),
			created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
		}))
	});
};

export const POST: RequestHandler = async ({ locals, params, request, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const node = await getNodeById(params.id);
	if (!node || (node.owner_id !== locals.user.id && locals.user.role !== 'admin')) {
		return json({ error: 'Sem permissão para compartilhar este item.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Dados inválidos.' }, { status: 400 });

	const db = getPool();
	const ip = getClientAddress();

	if (body.mode === 'user') {
		const email = String(body.email || '').trim().toLowerCase();
		const permission = body.permission === 'editor' ? 'editor' : 'viewer';

		const [uRows] = await db.query<RowDataPacket[]>(
			'SELECT id, name, email, avatar_color FROM users WHERE email = ? AND is_active = 1 LIMIT 1',
			[email]
		);
		if (uRows.length === 0) {
			return json({ error: 'Usuário não encontrado com este e-mail.' }, { status: 404 });
		}
		const targetUser = uRows[0];
		if (String(targetUser.id) === node.owner_id) {
			return json({ error: 'Você já é o proprietário deste item.' }, { status: 400 });
		}

		const id = crypto.randomUUID();
		await db.query(
			`INSERT INTO node_permissions (id, node_id, user_id, granted_by, permission)
			 VALUES (?, ?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE permission = VALUES(permission)`,
			[id, node.id, targetUser.id, locals.user.id, permission]
		);

		await logAudit({
			userId: locals.user.id,
			action: 'share.user_grant',
			targetType: node.type,
			targetId: node.id,
			details: `Compartilhado "${node.name}" com ${email} (${permission})`,
			ipAddress: ip
		});

		return json({ ok: true }, { status: 201 });
	}

	if (body.mode === 'link') {
		if (node.type !== 'file') {
			return json(
				{ error: 'Links públicos diretos estão disponíveis para arquivos. Para pastas, compartilhe por usuário.' },
				{ status: 400 }
			);
		}
		const id = crypto.randomUUID();
		const token = generateToken(18);
		const password = typeof body.password === 'string' && body.password.trim() ? body.password.trim() : null;
		const passwordHash = password ? await hashPassword(password) : null;
		const expiresInHours = Number(body.expiresInHours || 0);
		const expiresAt =
			expiresInHours > 0 ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000) : null;
		const maxDownloads =
			body.maxDownloads && Number(body.maxDownloads) > 0 ? Number(body.maxDownloads) : null;

		await db.query(
			`INSERT INTO share_links (id, node_id, created_by, token, password_hash, expires_at, max_downloads, is_active)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
			[id, node.id, locals.user.id, token, passwordHash, expiresAt, maxDownloads]
		);

		await logAudit({
			userId: locals.user.id,
			action: 'share.link_create',
			targetType: node.type,
			targetId: node.id,
			details: `Link público criado para "${node.name}"`,
			ipAddress: ip
		});

		return json({ id, token }, { status: 201 });
	}

	return json({ error: 'Modo de compartilhamento inválido.' }, { status: 400 });
};

export const DELETE: RequestHandler = async ({ locals, params, url, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const node = await getNodeById(params.id);
	if (!node || (node.owner_id !== locals.user.id && locals.user.role !== 'admin')) {
		return json({ error: 'Sem permissão.' }, { status: 403 });
	}

	const db = getPool();
	const permissionId = url.searchParams.get('permissionId');
	const linkId = url.searchParams.get('linkId');

	if (permissionId) {
		await db.query('DELETE FROM node_permissions WHERE id = ? AND node_id = ?', [
			permissionId,
			node.id
		]);
		await logAudit({
			userId: locals.user.id,
			action: 'share.user_revoke',
			targetType: node.type,
			targetId: node.id,
			details: `Permissão de usuário revogada em "${node.name}"`,
			ipAddress: getClientAddress()
		});
		return json({ ok: true });
	}

	if (linkId) {
		await db.query('DELETE FROM share_links WHERE id = ? AND node_id = ?', [linkId, node.id]);
		await logAudit({
			userId: locals.user.id,
			action: 'share.link_revoke',
			targetType: node.type,
			targetId: node.id,
			details: `Link público revogado em "${node.name}"`,
			ipAddress: getClientAddress()
		});
		return json({ ok: true });
	}

	return json({ error: 'Informe permissionId ou linkId.' }, { status: 400 });
};
