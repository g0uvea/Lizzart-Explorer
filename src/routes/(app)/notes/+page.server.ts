import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSystemSettings } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/login');
	}
	const sys = await getSystemSettings();
	if (!sys.plugin_notes) {
		throw redirect(302, locals.user.role === 'admin' ? '/plugins' : '/');
	}
	return {};
};
