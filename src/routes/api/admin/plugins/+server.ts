import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPool } from '$lib/server/db';
import { getSystemSettings, invalidateSettingsCache, logAudit } from '$lib/server/auth';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}
	const sys = await getSystemSettings();
	return json({
		plugins: {
			mc_servers: sys.plugin_mc_servers,
			notes: sys.plugin_notes
		}
	});
};

export const PATCH: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Dados inválidos.' }, { status: 400 });

	const db = getPool();
	const updates: [string, string][] = [];

	if (typeof body.mc_servers === 'boolean') {
		updates.push(['plugin_mc_servers', body.mc_servers ? '1' : '0']);
	}
	if (typeof body.notes === 'boolean') {
		updates.push(['plugin_notes', body.notes ? '1' : '0']);
	}

	if (updates.length === 0) {
		return json({ error: 'Nenhum plugin informado.' }, { status: 400 });
	}

	for (const [k, v] of updates) {
		await db.query(
			`INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
			 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
			[k, v]
		);
	}

	invalidateSettingsCache();

	await logAudit({
		userId: locals.user.id,
		action: 'admin.plugins_update',
		targetType: 'plugin',
		details: `Plugins atualizados: ${updates.map(([k, v]) => `${k}=${v === '1' ? 'instalado' : 'removido'}`).join(', ')}`,
		ipAddress: getClientAddress()
	});

	const sys = await getSystemSettings();
	return json({
		ok: true,
		plugins: {
			mc_servers: sys.plugin_mc_servers,
			notes: sys.plugin_notes
		}
	});
};
