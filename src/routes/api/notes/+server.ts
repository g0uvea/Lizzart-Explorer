import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { getSystemSettings, logAudit } from '$lib/server/auth';
import { getWorkspaceMembership, recalculateWorkspaceUsedBytes } from '$lib/server/workspaces';
import { sanitizeFileName, saveBufferAsBlob } from '$lib/server/storage';
import type { NoteRecord } from '$lib/types';

function stripMdExt(name: string): string {
	return name.replace(/\.md$/i, '');
}

function ensureMdFileName(title: string): { cleanTitle: string; fileName: string } {
	const raw = stripMdExt(title.trim()) || 'Sem título';
	const cleanTitle = raw.slice(0, 180);
	const fileName = sanitizeFileName(`${cleanTitle}.md`);
	return { cleanTitle, fileName };
}

function mapNoteRow(row: RowDataPacket, permission: 'owner' | 'editor' | 'viewer'): NoteRecord {
	const name = String(row.name);
	const createdByName = row.created_by_name ? String(row.created_by_name).trim() : '';
	return {
		id: String(row.id),
		workspace_id: String(row.workspace_id),
		workspace_name: row.workspace_name ? String(row.workspace_name) : undefined,
		created_by: row.created_by ? String(row.created_by) : null,
		created_by_name: createdByName || undefined,
		created_by_username: row.created_by_username ? String(row.created_by_username) : undefined,
		title: stripMdExt(name),
		name,
		size_bytes: Number(row.size_bytes ?? 0),
		is_starred: Boolean(row.is_starred),
		permission,
		share_count: Number(row.share_count ?? 0),
		link_count: Number(row.link_count ?? 0),
		created_at:
			row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
		updated_at:
			row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at)
	};
}

/**
 * GET /api/notes?workspaceId=<id>&scope=mine|shared
 * Lists ONLY the current user's personal markdown notes inside `workspaceId`
 * (or notes explicitly shared with this user inside `workspaceId`).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const sys = await getSystemSettings();
	if (!sys.plugin_notes) {
		return json({ error: 'O plugin de Anotações não está instalado.' }, { status: 404 });
	}

	const workspaceId = url.searchParams.get('workspaceId') || '';
	const search = (url.searchParams.get('search') || '').trim().toLowerCase();
	if (!workspaceId) {
		return json({ myNotes: [], sharedNotes: [], noWorkspace: true });
	}

	const membership = await getWorkspaceMembership(locals.user.id, workspaceId);
	if (!membership) {
		return json({ error: 'Você não está conectado a esta workspace.' }, { status: 403 });
	}

	const db = getPool();
	const creatorSelect = `CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS created_by_name, u.username AS created_by_username, w.name AS workspace_name`;

	const [myRows, sharedRows] = await Promise.all([
		db.query<RowDataPacket[]>(
			`SELECT n.*, ${creatorSelect},
				(SELECT COUNT(*) FROM node_permissions np WHERE np.node_id = n.id) AS share_count,
				(SELECT COUNT(*) FROM share_links sl WHERE sl.node_id = n.id AND sl.is_active = 1) AS link_count
			 FROM storage_nodes n
			 INNER JOIN workspaces w ON w.id = n.workspace_id
			 LEFT JOIN users u ON u.id = n.created_by
			 WHERE n.workspace_id = ? AND n.created_by = ? AND n.is_note = 1 AND n.is_trashed = 0
			 ORDER BY n.is_starred DESC, n.updated_at DESC`,
			[workspaceId, locals.user.id]
		),
		db.query<RowDataPacket[]>(
			`SELECT n.*, np.permission AS granted_perm, ${creatorSelect},
				(SELECT COUNT(*) FROM node_permissions np2 WHERE np2.node_id = n.id) AS share_count,
				(SELECT COUNT(*) FROM share_links sl WHERE sl.node_id = n.id AND sl.is_active = 1) AS link_count
			 FROM node_permissions np
			 INNER JOIN storage_nodes n ON n.id = np.node_id
			 INNER JOIN workspaces w ON w.id = n.workspace_id
			 LEFT JOIN users u ON u.id = n.created_by
			 WHERE np.user_id = ? AND n.workspace_id = ? AND n.is_note = 1 AND n.is_trashed = 0
			 ORDER BY n.updated_at DESC`,
			[locals.user.id, workspaceId]
		)
	]);

	let myNotes = myRows[0].map((r) => mapNoteRow(r, 'owner'));
	let sharedNotes = sharedRows[0].map((r) =>
		mapNoteRow(r, r.granted_perm === 'editor' ? 'editor' : 'viewer')
	);

	if (search) {
		myNotes = myNotes.filter((n) => n.title.toLowerCase().includes(search));
		sharedNotes = sharedNotes.filter((n) => n.title.toLowerCase().includes(search));
	}

	return json({
		myNotes,
		sharedNotes,
		workspace: membership.workspace
	});
};

/**
 * POST /api/notes
 * Creates a new personal Markdown (.md) note inside the active workspace, visible ONLY to the creator.
 */
export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const sys = await getSystemSettings();
	if (!sys.plugin_notes) {
		return json({ error: 'O plugin de Anotações não está instalado.' }, { status: 404 });
	}

	const body = await request.json().catch(() => null);
	const workspaceId = String(body?.workspaceId || '');
	if (!workspaceId) {
		return json({ error: 'Selecione uma workspace para criar anotações.' }, { status: 400 });
	}

	const membership = await getWorkspaceMembership(locals.user.id, workspaceId);
	if (!membership) {
		return json({ error: 'Você não pertence a esta workspace.' }, { status: 403 });
	}

	const { cleanTitle, fileName } = ensureMdFileName(String(body?.title || 'Nova Anotação'));
	const initialContent =
		typeof body?.content === 'string'
			? body.content
			: `# ${cleanTitle}\n\nComece a escrever sua anotação em **Markdown** aqui...\n`;

	const buf = Buffer.from(initialContent, 'utf8');
	const ws = membership.workspace;
	if (ws.quota_bytes >= 0 && ws.used_bytes + buf.byteLength > ws.quota_bytes) {
		return json({ error: 'Cota de armazenamento da workspace excedida.' }, { status: 413 });
	}

	const blob = await saveBufferAsBlob(buf);
	const id = crypto.randomUUID();
	const db = getPool();

	await db.query(
		`INSERT INTO storage_nodes
		 (id, workspace_id, created_by, parent_id, type, name, mime_type, size_bytes, disk_path, sha256, is_note, is_starred, is_trashed)
		 VALUES (?, ?, ?, NULL, 'file', ?, 'text/markdown', ?, ?, ?, 1, 0, 0)`,
		[id, workspaceId, locals.user.id, fileName, blob.sizeBytes, blob.diskPath, blob.sha256]
	);

	const usedBytes = await recalculateWorkspaceUsedBytes(workspaceId);

	await logAudit({
		userId: locals.user.id,
		action: 'notes.create',
		targetType: 'file',
		targetId: id,
		details: `Anotação pessoal criada: "${fileName}" na workspace ${ws.name}`,
		ipAddress: getClientAddress()
	});

	const note: NoteRecord = {
		id,
		workspace_id: workspaceId,
		workspace_name: ws.name,
		created_by: locals.user.id,
		created_by_name: locals.user.full_name,
		created_by_username: locals.user.username,
		title: cleanTitle,
		name: fileName,
		content: initialContent,
		size_bytes: blob.sizeBytes,
		is_starred: false,
		permission: 'owner',
		share_count: 0,
		link_count: 0,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString()
	};

	return json({ note, quota: { used_bytes: usedBytes, quota_bytes: ws.quota_bytes } }, { status: 201 });
};
