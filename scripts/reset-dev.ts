#!/usr/bin/env bun
import fsp from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { ensureDatabaseReady, getDbRawConfig, getPool } from '../src/lib/server/db';
import { ensureStorageDir, getStorageRoot } from '../src/lib/server/storage';

async function resetDev() {
	console.log('\n\x1b[38;5;42m\x1b[1m🔄 LIZZART EXPLORER — FULL DEVELOPMENT RESET\x1b[0m');
	console.log('\x1b[90m──────────────────────────────────────────────────────────────\x1b[0m');

	const cfg = getDbRawConfig();
	const safeDb = cfg.database.replace(/`/g, '');

	// 1. Drop and recreate MariaDB database cleanly
	console.log(`1. Resetting MariaDB database \`${safeDb}\` (${cfg.user}@${cfg.host}:${cfg.port})...`);
	const conn = await mysql.createConnection({
		host: cfg.host,
		port: cfg.port,
		user: cfg.user,
		password: cfg.password
	});

	try {
		await conn.query(`DROP DATABASE IF EXISTS \`${safeDb}\``);
		await conn.query(
			`CREATE DATABASE \`${safeDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
		);
	} finally {
		await conn.end();
	}

	// 2. Re-initialize fresh schema & default system settings
	await ensureDatabaseReady();
	await getPool().end();
	console.log('   \x1b[38;5;42m✔ Database schema recreated from scratch (0 users, ready for /setup).\x1b[0m');

	// 3. Wipe local storage directory (blobs, chunks, avatars, backups)
	const storageRoot = getStorageRoot();
	console.log(`2. Cleaning local storage directory (${storageRoot})...`);
	await fsp.rm(storageRoot, { recursive: true, force: true }).catch(() => {});
	await ensureStorageDir();
	console.log('   \x1b[38;5;42m✔ Storage subdirectories (blobs, chunks, avatars, backups) wiped and recreated.\x1b[0m');

	// 4. Clean Vite & SvelteKit caches
	const rootDir = process.cwd();
	for (const rel of ['node_modules/.vite']) {
		const target = path.resolve(rootDir, rel);
		await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
	}
	console.log('3. Cleared Vite module cache (node_modules/.vite).');

	console.log('\n\x1b[38;5;42m\x1b[1m✨ Reset complete! Start the app with `make dev` (or `bun run dev`) to test from /setup.\x1b[0m\n');
}

resetDev().catch((err) => {
	console.error('\x1b[31m✖ Failed to reset development environment:\x1b[0m', err instanceof Error ? err.message : err);
	process.exit(1);
});
