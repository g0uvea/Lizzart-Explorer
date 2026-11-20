import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { applyPoolPerformanceLimits, getPool } from '$lib/server/db';
import { invalidateSettingsCache, logAudit } from '$lib/server/auth';
import {
	getClientPerformanceConfig,
	getPerformanceConfig,
	getPerformanceTelemetry,
	isValidPerformanceMode,
	listPerformanceProfiles,
	setActivePerformanceMode
} from '$lib/server/performance';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}

	return json({
		activeMode: getPerformanceConfig().mode,
		profiles: listPerformanceProfiles(),
		telemetry: getPerformanceTelemetry(),
		clientConfig: getClientPerformanceConfig()
	});
};

export const PATCH: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	const mode = body?.mode;
	if (!isValidPerformanceMode(mode)) {
		return json(
			{
				error:
					'Perfil inválido. Use: ultra_optimized, optimized, fast ou ultra_fast.'
			},
			{ status: 400 }
		);
	}

	const db = getPool();
	await db.query(
		`INSERT INTO system_settings (setting_key, setting_value) VALUES ('performance_mode', ?)
		 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
		[mode]
	);

	setActivePerformanceMode(mode);
	await applyPoolPerformanceLimits();
	invalidateSettingsCache();

	const profile = getPerformanceConfig();
	await logAudit({
		userId: locals.user.id,
		action: 'admin.performance_mode_change',
		targetType: 'system',
		details: `Perfil de desempenho alterado para "${profile.label}" (${mode})`,
		ipAddress: getClientAddress()
	});

	return json({
		ok: true,
		activeMode: mode,
		profile: {
			mode: profile.mode,
			label: profile.label,
			tagline: profile.tagline
		},
		telemetry: getPerformanceTelemetry(),
		clientConfig: getClientPerformanceConfig()
	});
};
