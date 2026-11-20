import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { applyPoolPerformanceLimits, getPool } from '$lib/server/db';
import {
	invalidateSettingsCache,
	logAudit,
	MIN_WORKSPACE_QUOTA_GB
} from '$lib/server/auth';
import { isValidPerformanceMode, setActivePerformanceMode } from '$lib/server/performance';

export const PATCH: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso negado.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Dados inválidos.' }, { status: 400 });

	const db = getPool();
	const pairs: [string, string][] = [];

	if (body.default_quota_gb !== undefined) {
		const val = Math.round(Number(body.default_quota_gb));
		if (Number.isNaN(val) || val < MIN_WORKSPACE_QUOTA_GB) {
			return json(
				{ error: `A cota padrão mínima para workspaces é de ${MIN_WORKSPACE_QUOTA_GB} GB.` },
				{ status: 400 }
			);
		}
		pairs.push(['default_quota_gb', String(val)]);
	}
	if (body.max_upload_mb !== undefined && Number(body.max_upload_mb) >= 10) {
		pairs.push(['max_upload_mb', String(Math.round(Number(body.max_upload_mb)))]);
	}
	if (body.performance_mode !== undefined) {
		if (!isValidPerformanceMode(body.performance_mode)) {
			return json({ error: 'Perfil de desempenho inválido.' }, { status: 400 });
		}
		pairs.push(['performance_mode', body.performance_mode]);
		setActivePerformanceMode(body.performance_mode);
		await applyPoolPerformanceLimits();
	}
	if (body.auto_backup_interval !== undefined) {
		const val = String(body.auto_backup_interval);
		if (!['off', 'daily', 'weekly'].includes(val)) {
			return json({ error: 'Intervalo de backup automático inválido.' }, { status: 400 });
		}
		pairs.push(['auto_backup_interval', val]);
	}
	if (body.backup_retention_count !== undefined) {
		const val = Math.max(1, Math.min(100, Math.round(Number(body.backup_retention_count))));
		if (!Number.isNaN(val)) {
			pairs.push(['backup_retention_count', String(val)]);
		}
	}

	for (const [k, v] of pairs) {
		await db.query(
			`INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
			 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
			[k, v]
		);
	}

	invalidateSettingsCache();

	await logAudit({
		userId: locals.user.id,
		action: 'admin.settings_update',
		targetType: 'system',
		details: `Configurações atualizadas: ${pairs.map(([k, v]) => `${k}=${v}`).join(', ')}`,
		ipAddress: getClientAddress()
	});

	return json({ ok: true });
};
