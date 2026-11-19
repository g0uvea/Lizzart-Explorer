import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPool } from '$lib/server/db';
import { logAudit } from '$lib/server/auth';

export const PATCH: RequestHandler = async ({ locals, params, request, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso negado.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Dados inválidos.' }, { status: 400 });

	const db = getPool();
	const fields: string[] = [];
	const values: unknown[] = [];

	const allowedStrings = ['name', 'description', 'version', 'edition_label', 'motd', 'gamemode', 'difficulty'];
	for (const key of allowedStrings) {
		if (typeof body[key] === 'string') {
			fields.push(`${key} = ?`);
			values.push(body[key].trim());
		}
	}

	const allowedInts = ['host_port', 'max_players', 'allocated_ram_mb'];
	for (const key of allowedInts) {
		if (body[key] !== undefined && !Number.isNaN(Number(body[key]))) {
			fields.push(`${key} = ?`);
			values.push(Number(body[key]));
		}
	}

	const allowedBools = ['pvp', 'online_mode', 'whitelist'];
	for (const key of allowedBools) {
		if (typeof body[key] === 'boolean') {
			fields.push(`${key} = ?`);
			values.push(body[key] ? 1 : 0);
		}
	}

	if (fields.length === 0) {
		return json({ error: 'Nenhuma alteração enviada.' }, { status: 400 });
	}

	values.push(params.id);
	await db.query(`UPDATE mc_servers SET ${fields.join(', ')} WHERE id = ?`, values);

	await logAudit({
		userId: locals.user.id,
		action: 'mc.server_update_shell',
		targetType: 'mc_server',
		targetId: params.id,
		details: 'Propriedades do servidor Minecraft (casca UI) atualizadas',
		ipAddress: getClientAddress()
	});

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso negado.' }, { status: 403 });
	}

	const db = getPool();
	await db.query('DELETE FROM mc_servers WHERE id = ?', [params.id]);

	await logAudit({
		userId: locals.user.id,
		action: 'mc.server_delete_shell',
		targetType: 'mc_server',
		targetId: params.id,
		details: 'Instância Minecraft (casca UI) removida',
		ipAddress: getClientAddress()
	});

	return json({ ok: true });
};
