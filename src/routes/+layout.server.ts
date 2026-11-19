import type { LayoutServerLoad } from './$types';
import { getSystemSettings } from '$lib/server/auth';

export const load: LayoutServerLoad = async ({ locals }) => {
	const settings = await getSystemSettings();
	return {
		user: locals.user,
		allowRegistration: settings.allow_registration
	};
};
