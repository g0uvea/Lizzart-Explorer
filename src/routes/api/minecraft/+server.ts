import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { getPool } from '$lib/server/db';
import { logAudit } from '$lib/server/auth';
import type { McServerRecord } from '$lib/types';

function mapServer(r: RowDataPacket): McServerRecord {
	return {
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
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Não autenticado.' }, { status: 401 });
	if (locals.user.role !== 'admin') {
		return json({ error: 'Painel Minecraft restrito a administradores.' }, { status: 403 });
	}

	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM mc_servers ORDER BY created_at DESC');
	return json({ servers: rows.map(mapServer) });
};

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso negado.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	const name = String(body?.name || '').trim();
	if (name.length < 2) {
		return json({ error: 'Informe um nome para a instância.' }, { status: 400 });
	}

	const id = crypto.randomUUID();
	const db = getPool();

	await db.query(
		`INSERT INTO mc_servers
		 (id, name, description, version, edition_label, host_port, max_players, allocated_ram_mb, motd, gamemode, difficulty, pvp, online_mode, whitelist, status, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offline', ?)`,
		[
			id,
			name,
			String(body?.description || '').trim() || null,
			String(body?.version || '1.21.4').trim(),
			String(body?.edition_label || 'Shell UI').trim(),
			Number(body?.host_port || 25565),
			Number(body?.max_players || 20),
			Number(body?.allocated_ram_mb || 4096),
			String(body?.motd || `Bem-vindo ao ${name}!`).trim(),
			String(body?.gamemode || 'survival'),
			String(body?.difficulty || 'normal'),
			body?.pvp === false ? 0 : 1,
			body?.online_mode === false ? 0 : 1,
			body?.whitelist === true ? 1 : 0,
			locals.user.id
		]
	);

	await logAudit({
		userId: locals.user.id,
		action: 'mc.server_create_shell',
		targetType: 'mc_server',
		targetId: id,
		details: `Instância Minecraft (casca UI) criada: ${name}`,
		ipAddress: getClientAddress()
	});

	return json({ id }, { status: 201 });
};
