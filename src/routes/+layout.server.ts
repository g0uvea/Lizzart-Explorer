import type { LayoutServerLoad } from './$types';
import { hasAnyAdmin } from '$lib/server/db';
import { getSystemSettings } from '$lib/server/auth';
import { getClientPerformanceConfig } from '$lib/server/performance';

export const load: LayoutServerLoad = async ({ locals }) => {
	const [hasAdmin, sys] = await Promise.all([hasAnyAdmin(), getSystemSettings()]);
	return {
		user: locals.user,
		hasAdmin,
		perf: getClientPerformanceConfig(),
		plugins: {
			mc_servers: sys.plugin_mc_servers,
			notes: sys.plugin_notes
		},
		locale: {
			language: locals.user?.language ?? sys.default_language,
			country: locals.user?.country ?? sys.default_country,
			defaultLanguage: sys.default_language,
			defaultCountry: sys.default_country
		}
	};
};
