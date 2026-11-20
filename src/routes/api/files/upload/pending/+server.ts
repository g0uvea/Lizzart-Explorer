import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import { getFileStat } from '$lib/server/storage';

/**
 * Returns incomplete upload sessions for the authenticated user so that after a
 * power outage, browser crash, or network drop, the Transfer Queue can display them
 * and resume seamlessly from the exact durable disk offset.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT us.*, w.name AS workspace_name
		 FROM upload_sessions us
		 INNER JOIN workspaces w ON w.id = us.workspace_id
		 WHERE us.user_id = ? AND us.status = 'uploading' AND us.uploaded_bytes > 0
		 ORDER BY us.updated_at DESC
		 LIMIT 25`,
		[locals.user.id]
	);

	const pending = [];
	for (const r of rows) {
		let diskSize = 0;
		try {
			const stat = await getFileStat(String(r.temp_path));
			diskSize = stat.size;
		} catch {
			diskSize = 0;
		}
		const safeBytes = Math.min(diskSize, Number(r.uploaded_bytes), Number(r.total_bytes));
		if (safeBytes <= 0) continue;

		pending.push({
			uploadId: String(r.id),
			workspaceId: String(r.workspace_id),
			workspaceName: String(r.workspace_name),
			parentId: r.parent_id ? String(r.parent_id) : null,
			fileName: String(r.file_name),
			mimeType: String(r.mime_type || 'application/octet-stream'),
			totalBytes: Number(r.total_bytes),
			uploadedBytes: safeBytes,
			fingerprint: String(r.fingerprint),
			updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at)
		});
	}

	return json({ pending });
};
