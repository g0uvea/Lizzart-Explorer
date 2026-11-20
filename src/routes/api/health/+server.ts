import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ensureDatabaseReady, getPool } from '$lib/server/db';
import { getActivePerformanceMode } from '$lib/server/performance';
import { getStorageRootRaw, inspectStorageDirectory } from '$lib/server/storage';

export const GET: RequestHandler = async () => {
	try {
		await ensureDatabaseReady();
		const db = getPool();
		await db.query('SELECT 1');
		const storage = await inspectStorageDirectory(getStorageRootRaw());
		return json({
			status: 'ok',
			database: 'connected',
			storage: storage.ok ? 'writable' : 'error',
			performance_mode: getActivePerformanceMode(),
			uptime_sec: Math.floor(process.uptime())
		});
	} catch (err) {
		return json(
			{
				status: 'degraded',
				error: err instanceof Error ? err.message : 'Health check failed'
			},
			{ status: 503 }
		);
	}
};
