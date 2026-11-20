import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getUserWorkspaces } from '$lib/server/workspaces';
import { getClientPerformanceConfig } from '$lib/server/performance';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/login');
	}
	const workspaces = await getUserWorkspaces(locals.user.id);
	return {
		user: locals.user,
		workspaces,
		perf: getClientPerformanceConfig()
	};
};
