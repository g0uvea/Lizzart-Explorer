import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import fsp from 'node:fs/promises';
import { getPool } from '$lib/server/db';
import { getEffectivePermission } from '$lib/server/permissions';
import {
	deleteDiskBlobIfUnreferenced,
	resolveDiskPath,
	sanitizeFileName,
	saveBufferAsBlob
} from '$lib/server/storage';
import { recalculateWorkspaceUsedBytes } from '$lib/server/workspaces';
import { logAudit } from '$lib/server/auth';

function stripMdExt(name: string): string {
	return name.replace(/\.md$/i, '');
}

function ensureMdFileName(title: string): { cleanTitle: string; fileName: string } {
	const raw = stripMdExt(title.trim()) || 'Sem título';
	const cleanTitle = raw.slice(0, 180);
	const fileName = sanitizeFileName(`${cleanTitle}.md`);
	return { cleanTitle, fileName };
}

/**
 * GET /api/notes/[id]
 * Reads a personal note's metadata and UTF-8 Markdown content.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const { node, permission } = await getEffectivePermission(locals.user, params.id);
	if (!node || !permission || !node.is_note || node.is_trashed) {
		return json({ error: 'Anotação não encontrada ou sem acesso.' }, { status: 404 });
	}

	let content = '';
	if (node.disk_path) {
		try {
			content = await fsp.readFile(resolveDiskPath(node.disk_path), 'utf8');
		} catch {
			content = '';
		}
	}

	const db = getPool();
	const [metaRows] = await db.query<RowDataPacket[]>(
		`SELECT
			(SELECT COUNT(*) FROM node_permissions np WHERE np.node_id = ?) AS share_count,
			(SELECT COUNT(*) FROM share_links sl WHERE sl.node_id = ? AND sl.is_active = 1) AS link_count`,
		[node.id, node.id]
	);

	return json({
		note: {
			id: node.id,
			workspace_id: node.workspace_id,
			created_by: node.created_by,
			title: stripMdExt(node.name),
			name: node.name,
			content,
			size_bytes: Number(node.size_bytes ?? 0),
			is_starred: Boolean(node.is_starred),
			permission,
			share_count: Number(metaRows[0]?.share_count ?? 0),
			link_count: Number(metaRows[0]?.link_count ?? 0),
			created_at:
				node.created_at instanceof Date ? node.created_at.toISOString() : String(node.created_at),
			updated_at:
				node.updated_at instanceof Date ? node.updated_at.toISOString() : String(node.updated_at)
		}
	});
};

/**
 * PATCH /api/notes/[id]
 * Saves markdown content, title, or favorite state of a personal note.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const { node, permission } = await getEffectivePermission(locals.user, params.id);
	if (!node || !permission || !node.is_note || node.is_trashed) {
		return json({ error: 'Anotação não encontrada.' }, { status: 404 });
	}
	if (permission !== 'owner' && permission !== 'editor') {
		return json({ error: 'Você possui apenas permissão de leitura nesta anotação.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Dados inválidos.' }, { status: 400 });

	const db = getPool();
	let nextName = node.name;
	let nextTitle = stripMdExt(node.name);
	let nextStarred = Boolean(node.is_starred);
	let nextDiskPath = node.disk_path;
	let nextSizeBytes = Number(node.size_bytes ?? 0);
	let nextSha256 = node.sha256;
	const oldDiskPath = node.disk_path;

	if (typeof body.title === 'string') {
		const formatted = ensureMdFileName(body.title);
		nextTitle = formatted.cleanTitle;
		nextName = formatted.fileName;
	}

	if (typeof body.is_starred === 'boolean') {
		nextStarred = body.is_starred;
	}

	if (typeof body.content === 'string') {
		const buf = Buffer.from(body.content, 'utf8');
		const blob = await saveBufferAsBlob(buf);
		nextDiskPath = blob.diskPath;
		nextSizeBytes = blob.sizeBytes;
		nextSha256 = blob.sha256;
	}

	await db.query(
		`UPDATE storage_nodes
		 SET name = ?, is_starred = ?, disk_path = ?, size_bytes = ?, sha256 = ?, updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`,
		[nextName, nextStarred ? 1 : 0, nextDiskPath, nextSizeBytes, nextSha256, node.id]
	);

	if (oldDiskPath && oldDiskPath !== nextDiskPath) {
		await deleteDiskBlobIfUnreferenced(oldDiskPath);
	}

	const usedBytes = await recalculateWorkspaceUsedBytes(node.workspace_id);

	return json({
		ok: true,
		title: nextTitle,
		name: nextName,
		size_bytes: nextSizeBytes,
		is_starred: nextStarred,
		updated_at: new Date().toISOString(),
		used_bytes: usedBytes
	});
};

/**
 * DELETE /api/notes/[id]
 * Permanently deletes a personal note (only the note owner can delete it).
 */
export const DELETE: RequestHandler = async ({ locals, params, getClientAddress }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const { node, permission } = await getEffectivePermission(locals.user, params.id);
	if (!node || !node.is_note) {
		return json({ error: 'Anotação não encontrada.' }, { status: 404 });
	}
	if (permission !== 'owner') {
		return json({ error: 'Apenas o criador da anotação pode excluí-la.' }, { status: 403 });
	}

	const db = getPool();
	const oldDiskPath = node.disk_path;
	await db.query('DELETE FROM storage_nodes WHERE id = ?', [node.id]);
	await deleteDiskBlobIfUnreferenced(oldDiskPath);
	const usedBytes = await recalculateWorkspaceUsedBytes(node.workspace_id);

	await logAudit({
		userId: locals.user.id,
		action: 'notes.delete',
		targetType: 'file',
		targetId: node.id,
		details: `Anotação pessoal excluída: "${node.name}"`,
		ipAddress: getClientAddress()
	});

	return json({ ok: true, used_bytes: usedBytes });
};
