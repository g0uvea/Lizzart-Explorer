import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPool } from '$lib/server/db';
import { logAudit } from '$lib/server/auth';

export const PATCH: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso negado.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Dados inválidos.' }, { status: 400 });

	const db = getPool();
	const pairs: [string, string][] = [];

	if (typeof body.allow_registration === 'boolean') {
		pairs.push(['allow_registration', body.allow_registration ? 'true' : 'false']);
	}
	if (body.default_quota_gb !== undefined && Number(body.default_quota_gb) > 0) {
		pairs.push(['default_quota_gb', String(Math.round(Number(body.default_quota_gb)))]);
	}
	if (body.max_upload_mb !== undefined && Number(body.max_upload_mb) > 0) {
		pairs.push(['max_upload_mb', String(Math.round(Number(body.max_upload_mb)))]);
	}

	for (const [k, v] of pairs) {
		await db.query(
			`INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
			 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
			[k, v]
		);
	}

	await logAudit({
		userId: locals.user.id,
		action: 'admin.settings_update',
		targetType: 'system',
		details: `Configurações atualizadas`,
		ipAddress: getClientAddress()
	});

	return json({ ok: true });
};
