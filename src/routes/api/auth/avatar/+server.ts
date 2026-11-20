import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import fsp from 'node:fs/promises';
import { getPool } from '$lib/server/db';
import { resolveDiskPath, saveAvatarFile } from '$lib/server/storage';
import { invalidateUserAuthCache } from '$lib/server/auth';

const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const formData = await request.formData().catch(() => null);
	const file = formData?.get('avatar');
	if (!(file instanceof File)) {
		return json({ error: 'Envie uma imagem válida.' }, { status: 400 });
	}
	if (!file.type.startsWith('image/')) {
		return json({ error: 'O arquivo deve ser uma imagem (PNG, JPG, WebP ou GIF).' }, { status: 400 });
	}
	if (file.size > MAX_AVATAR_BYTES) {
		return json({ error: 'Imagem muito grande (máximo 8 MB).' }, { status: 413 });
	}

	const db = getPool();
	const [prevRows] = await db.query<RowDataPacket[]>(
		'SELECT avatar_path FROM users WHERE id = ? LIMIT 1',
		[locals.user.id]
	);
	const prevPath = prevRows[0]?.avatar_path ? String(prevRows[0].avatar_path) : null;

	const relPath = await saveAvatarFile(locals.user.id, file);
	await db.query('UPDATE users SET avatar_path = ? WHERE id = ?', [relPath, locals.user.id]);
	invalidateUserAuthCache(locals.user.id);

	if (prevPath) {
		await fsp.unlink(resolveDiskPath(prevPath)).catch(() => {});
	}

	return json({
		avatar_url: `/api/auth/avatar/${locals.user.id}?v=${encodeURIComponent(relPath)}`
	});
};

export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });

	const db = getPool();
	const [prevRows] = await db.query<RowDataPacket[]>(
		'SELECT avatar_path FROM users WHERE id = ? LIMIT 1',
		[locals.user.id]
	);
	const prevPath = prevRows[0]?.avatar_path ? String(prevRows[0].avatar_path) : null;

	await db.query('UPDATE users SET avatar_path = NULL WHERE id = ?', [locals.user.id]);
	invalidateUserAuthCache(locals.user.id);
	if (prevPath) {
		await fsp.unlink(resolveDiskPath(prevPath)).catch(() => {});
	}

	return json({ ok: true });
};
