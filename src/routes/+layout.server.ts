import type { LayoutServerLoad } from './$types';
import { hasAnyAdmin } from '$lib/server/db';
import { getClientPerformanceConfig } from '$lib/server/performance';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user,
		hasAdmin: await hasAnyAdmin(),
		perf: getClientPerformanceConfig()
	};
};
