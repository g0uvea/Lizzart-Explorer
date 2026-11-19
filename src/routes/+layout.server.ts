import type { LayoutServerLoad } from './$types';
import { hasAnyAdmin } from '$lib/server/db';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user,
		hasAdmin: await hasAnyAdmin()
	};
};
