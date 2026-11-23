import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getUserWorkspaces } from '$lib/server/workspaces';
import { getSystemSettings } from '$lib/server/auth';
import { getClientPerformanceConfig } from '$lib/server/performance';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/login');
	}
	const [workspaces, sys] = await Promise.all([
		getUserWorkspaces(locals.user.id),
		getSystemSettings()
	]);
	return {
		user: locals.user,
		workspaces,
		perf: getClientPerformanceConfig(),
		plugins: {
			mc_servers: sys.plugin_mc_servers,
			notes: sys.plugin_notes
		}
	};
};
