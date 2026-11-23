import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSystemSettings } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		throw redirect(302, '/');
	}
	const sys = await getSystemSettings();
	if (!sys.plugin_mc_servers) {
		throw redirect(302, '/plugins');
	}
	return {};
};
