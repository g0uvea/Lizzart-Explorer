import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import type { McServerRecord } from '$lib/types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		throw redirect(302, '/');
	}

	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM mc_servers WHERE id = ? LIMIT 1', [
		params.id
	]);

	if (rows.length === 0) {
		throw error(404, 'Instância Minecraft não encontrada.');
	}

	const r = rows[0];
	const server: McServerRecord = {
		id: String(r.id),
		name: String(r.name),
		description: r.description ? String(r.description) : null,
		version: String(r.version),
		edition_label: String(r.edition_label),
		host_port: Number(r.host_port),
		max_players: Number(r.max_players),
		allocated_ram_mb: Number(r.allocated_ram_mb),
		motd: String(r.motd),
		gamemode: String(r.gamemode),
		difficulty: String(r.difficulty),
		pvp: Boolean(r.pvp),
		online_mode: Boolean(r.online_mode),
		whitelist: Boolean(r.whitelist),
		status: (r.status as McServerRecord['status']) || 'offline',
		created_by: r.created_by ? String(r.created_by) : null,
		created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
	};

	return { server };
};
