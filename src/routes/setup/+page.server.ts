import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { hasAnyAdmin } from '$lib/server/db';

export const load: PageServerLoad = async () => {
	const exists = await hasAnyAdmin();
	if (exists) {
		throw redirect(302, '/login');
	}
	return {};
};
