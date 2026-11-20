import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { verifyPassword } from '$lib/server/crypto';
import { checkRateLimit } from '$lib/server/security';

export const GET: RequestHandler = async ({ params }) => {
	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT sl.*, n.name, n.mime_type, n.size_bytes, n.is_trashed, n.created_at AS file_created_at,
		        w.name AS workspace_name,
		        CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS creator_name
		 FROM share_links sl
		 INNER JOIN storage_nodes n ON n.id = sl.node_id
		 INNER JOIN workspaces w ON w.id = n.workspace_id
		 LEFT JOIN users u ON u.id = sl.created_by
		 WHERE sl.token = ? AND sl.is_active = 1 AND w.is_active = 1
		 LIMIT 1`,
		[params.token]
	);

	if (rows.length === 0 || rows[0].is_trashed) {
		return json(
			{ error: 'Link de compartilhamento não encontrado ou revogado.' },
			{ status: 404 }
		);
	}

	const row = rows[0];
	if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
		return json({ error: 'Este link de compartilhamento expirou.' }, { status: 410 });
	}
	if (row.max_downloads !== null && Number(row.download_count) >= Number(row.max_downloads)) {
		return json(
			{ error: 'Este link atingiu o limite máximo de downloads.' },
			{ status: 410 }
		);
	}

	const creator = String(row.creator_name || '').trim();
	const ownerLabel = creator ? `${creator} (${row.workspace_name})` : String(row.workspace_name);

	return json({
		share: {
			token: String(row.token),
			name: String(row.name),
			mime_type: row.mime_type ? String(row.mime_type) : 'application/octet-stream',
			size_bytes: Number(row.size_bytes ?? 0),
			owner_name: ownerLabel,
			has_password: Boolean(row.password_hash),
			expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
			max_downloads: row.max_downloads !== null ? Number(row.max_downloads) : null,
			download_count: Number(row.download_count ?? 0)
		}
	});
};

export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	const rate = checkRateLimit(`share:${getClientAddress()}:${params.token}`, 12, 5 * 60 * 1000);
	if (!rate.allowed) {
		return json(
			{ error: `Muitas tentativas de senha. Aguarde ${rate.retryAfterSec}s.` },
			{ status: 429 }
		);
	}
	const body = await request.json().catch(() => null);
	const password = String(body?.password || '');

	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT password_hash FROM share_links WHERE token = ? AND is_active = 1 LIMIT 1',
		[params.token]
	);

	if (rows.length === 0) {
		return json({ error: 'Link não encontrado.' }, { status: 404 });
	}

	if (rows[0].password_hash) {
		const valid = await verifyPassword(password, String(rows[0].password_hash));
		if (!valid) {
			return json({ error: 'Senha incorreta.' }, { status: 401 });
		}
	}

	return json({ ok: true });
};
