import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDbConfig, getPool, reconfigureDbPool, testDbConnection } from '$lib/server/db';
import {
	ensureStorageDir,
	getStorageRoot,
	getStorageRootRaw,
	inspectStorageDirectory,
	migrateStorageDirectory,
	setStorageRoot
} from '$lib/server/storage';
import { updateEnvVariables } from '$lib/server/envConfig';
import { logAudit } from '$lib/server/auth';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}

	const diskInfo = await inspectStorageDirectory(getStorageRootRaw());
	const dbConfig = getDbConfig();

	return json({
		disk: {
			raw_path: getStorageRootRaw(),
			resolved_path: diskInfo.resolvedPath,
			writable: diskInfo.ok,
			free_bytes: diskInfo.freeBytes ?? null,
			total_bytes: diskInfo.totalBytes ?? null
		},
		database: dbConfig
	});
};

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user || locals.user.role !== 'admin') {
		return json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	const action = String(body?.action || '');
	const ip = getClientAddress();

	if (action === 'test-disk') {
		const candidate = String(body?.storage_root || '').trim();
		if (!candidate) {
			return json({ error: 'Informe um diretório válido.' }, { status: 400 });
		}
		const info = await inspectStorageDirectory(candidate);
		if (!info.ok) {
			return json({ error: info.error || 'Diretório inválido.' }, { status: 400 });
		}
		return json({
			ok: true,
			resolved_path: info.resolvedPath,
			free_bytes: info.freeBytes ?? null,
			total_bytes: info.totalBytes ?? null
		});
	}

	if (action === 'save-disk') {
		const candidate = String(body?.storage_root || '').trim();
		const migrate = Boolean(body?.migrate);
		if (!candidate) {
			return json({ error: 'Informe um caminho de diretório válido.' }, { status: 400 });
		}

		const info = await inspectStorageDirectory(candidate);
		if (!info.ok) {
			return json({ error: info.error || 'Diretório sem permissão de escrita.' }, { status: 400 });
		}

		const previousResolved = getStorageRoot();
		let migratedCount = 0;
		if (migrate) {
			migratedCount = await migrateStorageDirectory(previousResolved, info.resolvedPath);
		}

		setStorageRoot(candidate);
		await ensureStorageDir();
		await updateEnvVariables({ STORAGE_ROOT: candidate });

		const db = getPool();
		await db.query(
			`INSERT INTO system_settings (setting_key, setting_value) VALUES ('storage_root', ?)
			 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
			[candidate]
		);

		await logAudit({
			userId: locals.user.id,
			action: 'admin.storage_root_change',
			targetType: 'system',
			details: `Local de armazenamento alterado para "${info.resolvedPath}"${migrate ? ` (${migratedCount} arquivos migrados)` : ''}`,
			ipAddress: ip
		});

		return json({
			ok: true,
			raw_path: candidate,
			resolved_path: info.resolvedPath,
			migrated_count: migratedCount,
			free_bytes: info.freeBytes ?? null,
			total_bytes: info.totalBytes ?? null
		});
	}

	if (action === 'test-db') {
		const host = String(body?.host || '127.0.0.1').trim();
		const port = Number(body?.port || 3306);
		const user = String(body?.user || 'root').trim();
		const password = body?.keep_existing_password ? undefined : String(body?.password ?? '');

		const result = await testDbConnection({ host, port, user, password });
		if (!result.ok) {
			return json({ error: result.error || 'Falha na conexão.' }, { status: 400 });
		}
		return json({ ok: true, version: result.version });
	}

	if (action === 'save-db') {
		const host = String(body?.host || '127.0.0.1').trim();
		const port = Number(body?.port || 3306);
		const user = String(body?.user || 'root').trim();
		const database = String(body?.database || 'lizzart_explorer')
			.trim()
			.replace(/[^a-zA-Z0-9_]/g, '');
		const keepExisting = Boolean(body?.keep_existing_password);
		const password = keepExisting ? (process.env.DB_PASSWORD ?? '') : String(body?.password ?? '');

		if (!host || !user || !database || Number.isNaN(port) || port < 1 || port > 65535) {
			return json({ error: 'Preencha host, porta, usuário e nome do banco válidos.' }, { status: 400 });
		}

		const test = await testDbConnection({ host, port, user, password });
		if (!test.ok) {
			return json({ error: `Conexão recusada: ${test.error}` }, { status: 400 });
		}

		await updateEnvVariables({
			DB_HOST: host,
			DB_PORT: String(port),
			DB_USER: user,
			DB_PASSWORD: password,
			DB_NAME: database
		});

		await reconfigureDbPool({ host, port, user, password, database });

		await logAudit({
			userId: locals.user.id,
			action: 'admin.db_config_change',
			targetType: 'system',
			details: `Conexão MariaDB atualizada: ${user}@${host}:${port}/${database}`,
			ipAddress: ip
		});

		return json({ ok: true, version: test.version });
	}

	return json({ error: 'Ação inválida.' }, { status: 400 });
};
