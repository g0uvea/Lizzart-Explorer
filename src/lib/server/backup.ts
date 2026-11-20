import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { getDbRawConfig, getPool } from '$lib/server/db';
import { ensureStorageDir, resolveDiskPath } from '$lib/server/storage';
import { getSystemSettings, invalidateAllAuthCache, logAudit } from '$lib/server/auth';
import type { BackupRecord } from '$lib/types';

function findDumpBinary(): string | null {
	const candidates = [
		'/usr/bin/mariadb-dump',
		'/usr/local/bin/mariadb-dump',
		'/usr/bin/mysqldump',
		'/usr/local/bin/mysqldump'
	];
	for (const p of candidates) {
		try {
			fs.accessSync(p, fs.constants.X_OK);
			return p;
		} catch {
			// continue
		}
	}
	return null;
}

function findClientBinary(): string | null {
	const candidates = [
		'/usr/bin/mariadb',
		'/usr/local/bin/mariadb',
		'/usr/bin/mysql',
		'/usr/local/bin/mysql'
	];
	for (const p of candidates) {
		try {
			fs.accessSync(p, fs.constants.X_OK);
			return p;
		} catch {
			// continue
		}
	}
	return null;
}

function formatBackupTimestamp(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}Z`;
}

function escapeSqlLiteral(val: unknown): string {
	if (val === null || val === undefined) return 'NULL';
	if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
	if (typeof val === 'bigint') return val.toString();
	if (typeof val === 'boolean') return val ? '1' : '0';
	if (val instanceof Date) {
		return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
	}
	if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
		return `0x${Buffer.from(val).toString('hex')}`;
	}
	const str = String(val)
		.replace(/\\/g, '\\\\')
		.replace(/'/g, "\\'")
		.replace(/\0/g, '\\0')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\x1a/g, '\\Z');
	return `'${str}'`;
}

/**
 * Pure SQL fallback generator (zero external binaries needed) using mysql2.
 */
async function dumpViaPureSql(absPath: string, compress: boolean): Promise<{ sizeBytes: number; sha256: string }> {
	const db = getPool();
	const cfg = getDbRawConfig();

	const hash = crypto.createHash('sha256');
	const out = fs.createWriteStream(absPath, { mode: 0o600 });
	const hasher = new Transform({
		transform(chunk, _enc, cb) {
			hash.update(chunk);
			cb(null, chunk);
		}
	});
	const targetStream = compress ? zlib.createGzip({ level: 6 }) : new Transform({ transform(c, _e, cb) { cb(null, c); } });

	const donePromise = pipeline(targetStream, hasher, out);

	const writeLine = async (line: string) => {
		if (!targetStream.write(line)) {
			await new Promise<void>((r) => targetStream.once('drain', r));
		}
	};

	await writeLine(`-- Lizzart Explorer Database Backup (Pure SQL)\n`);
	await writeLine(`-- Database: ${cfg.database}\n`);
	await writeLine(`-- Generated at: ${new Date().toISOString()}\n\n`);
	await writeLine(`SET FOREIGN_KEY_CHECKS=0;\n`);
	await writeLine(`SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n\n`);

	const [tableRows] = await db.query<RowDataPacket[]>('SHOW FULL TABLES WHERE Table_type = "BASE TABLE"');
	const tables = tableRows
		.map((r) => String(Object.values(r)[0]))
		.filter((t) => t !== 'db_backups');

	for (const table of tables) {
		const safeTable = `\`${table.replace(/`/g, '``')}\``;
		const [createRows] = await db.query<RowDataPacket[]>(`SHOW CREATE TABLE ${safeTable}`);
		const createSql = String(createRows[0]?.['Create Table'] || '');
		await writeLine(`DROP TABLE IF EXISTS ${safeTable};\n`);
		await writeLine(`${createSql};\n\n`);

		const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM ${safeTable}`);
		if (rows.length > 0) {
			const cols = Object.keys(rows[0]).map((c) => `\`${c.replace(/`/g, '``')}\``).join(', ');
			const batchSize = 200;
			for (let i = 0; i < rows.length; i += batchSize) {
				const slice = rows.slice(i, i + batchSize);
				const valuesSql = slice
					.map((row) => `(${Object.values(row).map(escapeSqlLiteral).join(', ')})`)
					.join(',\n');
				await writeLine(`INSERT INTO ${safeTable} (${cols}) VALUES\n${valuesSql};\n`);
			}
			await writeLine('\n');
		}
	}

	await writeLine(`SET FOREIGN_KEY_CHECKS=1;\n`);
	targetStream.end();
	await donePromise;

	const stat = await fsp.stat(absPath);
	return { sizeBytes: stat.size, sha256: hash.digest('hex') };
}

/**
 * Native mariadb-dump / mysqldump execution (no shell interpolation, MYSQL_PWD via env).
 */
async function dumpViaBinary(
	binary: string,
	absPath: string,
	compress: boolean
): Promise<{ sizeBytes: number; sha256: string }> {
	const cfg = getDbRawConfig();
	const args = [
		`--host=${cfg.host}`,
		`--port=${cfg.port}`,
		`--user=${cfg.user}`,
		'--single-transaction',
		'--quick',
		'--hex-blob',
		'--routines',
		'--triggers',
		'--default-character-set=utf8mb4',
		`--ignore-table=${cfg.database}.db_backups`,
		cfg.database
	];

	const child = spawn(binary, args, {
		env: {
			...process.env,
			MYSQL_PWD: cfg.password
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});

	let stderr = '';
	child.stderr.on('data', (chunk) => {
		stderr += chunk.toString('utf8');
	});

	const hash = crypto.createHash('sha256');
	const hasher = new Transform({
		transform(chunk, _enc, cb) {
			hash.update(chunk);
			cb(null, chunk);
		}
	});
	const out = fs.createWriteStream(absPath, { mode: 0o600 });

	const exitPromise = new Promise<number>((resolve, reject) => {
		child.on('error', reject);
		child.on('close', (code) => resolve(code ?? 1));
	});

	if (compress) {
		await pipeline(child.stdout, zlib.createGzip({ level: 6 }), hasher, out);
	} else {
		await pipeline(child.stdout, hasher, out);
	}

	const exitCode = await exitPromise;
	if (exitCode !== 0) {
		await fsp.unlink(absPath).catch(() => {});
		throw new Error(stderr.trim() || `mariadb-dump encerrou com código ${exitCode}`);
	}

	const stat = await fsp.stat(absPath);
	if (stat.size < 20) {
		await fsp.unlink(absPath).catch(() => {});
		throw new Error('Dump gerado está vazio.');
	}

	return { sizeBytes: stat.size, sha256: hash.digest('hex') };
}

export async function createDatabaseBackup(options?: {
	compress?: boolean;
	createdBy?: string | null;
	prefix?: string;
}): Promise<BackupRecord> {
	await ensureStorageDir();
	const compress = options?.compress !== false;
	const prefix = options?.prefix || 'lizzart-backup';
	const ext = compress ? '.sql.gz' : '.sql';
	const fileName = `${prefix}-${formatBackupTimestamp()}${ext}`;
	const relPath = path.join('backups', fileName).replace(/\\/g, '/');
	const absPath = resolveDiskPath(relPath);

	const binary = findDumpBinary();
	let method: 'mariadb-dump' | 'sql-native' = 'sql-native';
	let result: { sizeBytes: number; sha256: string };

	if (binary) {
		try {
			result = await dumpViaBinary(binary, absPath, compress);
			method = 'mariadb-dump';
		} catch {
			// Seamless fallback to pure SQL dump
			result = await dumpViaPureSql(absPath, compress);
			method = 'sql-native';
		}
	} else {
		result = await dumpViaPureSql(absPath, compress);
		method = 'sql-native';
	}

	const id = crypto.randomUUID();
	const db = getPool();
	await db.query(
		`INSERT INTO db_backups (id, file_name, file_path, size_bytes, sha256, method, compressed, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			fileName,
			relPath,
			result.sizeBytes,
			result.sha256,
			method,
			compress ? 1 : 0,
			options?.createdBy ?? null
		]
	);

	return {
		id,
		file_name: fileName,
		size_bytes: result.sizeBytes,
		sha256: result.sha256,
		method,
		compressed: compress,
		created_by_username: null,
		created_at: new Date().toISOString(),
		exists_on_disk: true
	};
}

export async function listDatabaseBackups(): Promise<BackupRecord[]> {
	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT b.*, u.username AS created_by_username
		 FROM db_backups b
		 LEFT JOIN users u ON u.id = b.created_by
		 ORDER BY b.created_at DESC`
	);

	const records: BackupRecord[] = [];
	for (const r of rows) {
		let exists = false;
		try {
			await fsp.access(resolveDiskPath(String(r.file_path)));
			exists = true;
		} catch {
			exists = false;
		}
		records.push({
			id: String(r.id),
			file_name: String(r.file_name),
			size_bytes: Number(r.size_bytes ?? 0),
			sha256: String(r.sha256),
			method:
				r.method === 'mariadb-dump' || r.method === 'uploaded' ? r.method : 'sql-native',
			compressed: Boolean(r.compressed),
			created_by_username: r.created_by_username ? String(r.created_by_username) : null,
			created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
			exists_on_disk: exists
		});
	}
	return records;
}

export async function getBackupRowById(id: string): Promise<RowDataPacket | null> {
	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT * FROM db_backups WHERE id = ? LIMIT 1',
		[id]
	);
	return rows[0] ?? null;
}

export async function deleteDatabaseBackup(id: string): Promise<boolean> {
	const row = await getBackupRowById(id);
	if (!row) return false;

	try {
		await fsp.unlink(resolveDiskPath(String(row.file_path)));
	} catch {
		// ignore missing file
	}

	const db = getPool();
	await db.query('DELETE FROM db_backups WHERE id = ?', [id]);
	return true;
}

export async function pruneOldBackups(retentionCount: number): Promise<number> {
	const keep = Math.max(1, retentionCount);
	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT id, file_path FROM db_backups ORDER BY created_at DESC LIMIT 1000 OFFSET ?',
		[keep]
	);

	let removed = 0;
	for (const r of rows) {
		await fsp.unlink(resolveDiskPath(String(r.file_path))).catch(() => {});
		await db.query('DELETE FROM db_backups WHERE id = ?', [r.id]);
		removed++;
	}
	return removed;
}

/**
 * Restores a .sql or .sql.gz backup file into MariaDB after automatically creating
 * a safety pre-restore snapshot.
 */
export async function restoreDatabaseFromFile(
	absPath: string,
	compressed: boolean,
	triggeredBy: string | null
): Promise<{ safetyBackupFile: string }> {
	// 1. Always create an automatic safety snapshot before touching live tables
	const safety = await createDatabaseBackup({
		compress: true,
		createdBy: triggeredBy,
		prefix: 'pre-restore-safety'
	});

	const cfg = getDbRawConfig();
	const clientBin = findClientBinary();

	if (clientBin) {
		const child = spawn(
			clientBin,
			[
				`--host=${cfg.host}`,
				`--port=${cfg.port}`,
				`--user=${cfg.user}`,
				'--default-character-set=utf8mb4',
				cfg.database
			],
			{
				env: { ...process.env, MYSQL_PWD: cfg.password },
				stdio: ['pipe', 'ignore', 'pipe']
			}
		);

		let stderr = '';
		child.stderr.on('data', (d) => {
			stderr += d.toString('utf8');
		});

		const exitPromise = new Promise<number>((resolve, reject) => {
			child.on('error', reject);
			child.on('close', (code) => resolve(code ?? 1));
		});

		const src = fs.createReadStream(absPath);
		if (compressed) {
			await pipeline(src, zlib.createGunzip(), child.stdin);
		} else {
			await pipeline(src, child.stdin);
		}

		const code = await exitPromise;
		if (code !== 0) {
			throw new Error(stderr.trim() || `Falha na restauração (código ${code}).`);
		}
	} else {
		// Pure mysql2 multi-statement restore fallback
		const raw = await fsp.readFile(absPath);
		const sql = compressed ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
		const conn = await mysql.createConnection({
			host: cfg.host,
			port: cfg.port,
			user: cfg.user,
			password: cfg.password,
			database: cfg.database,
			multipleStatements: true,
			charset: 'utf8mb4'
		});
		try {
			await conn.query(sql);
		} finally {
			await conn.end();
		}
	}

	invalidateAllAuthCache();
	return { safetyBackupFile: safety.file_name };
}

// ============================================================================
// Lightweight Auto-Backup Scheduler (checks every hour)
// ============================================================================
let schedulerStarted = false;

export function ensureBackupSchedulerStarted(): void {
	if (schedulerStarted) return;
	schedulerStarted = true;

	setInterval(async () => {
		try {
			const settings = await getSystemSettings();
			if (settings.auto_backup_interval === 'off') return;

			const intervalMs =
				settings.auto_backup_interval === 'weekly'
					? 7 * 24 * 60 * 60 * 1000
					: 24 * 60 * 60 * 1000;

			const db = getPool();
			const [rows] = await db.query<RowDataPacket[]>(
				'SELECT created_at FROM db_backups ORDER BY created_at DESC LIMIT 1'
			);
			const lastAt = rows[0]?.created_at ? new Date(rows[0].created_at).getTime() : 0;
			if (Date.now() - lastAt >= intervalMs) {
				const backup = await createDatabaseBackup({
					compress: true,
					createdBy: null,
					prefix: 'auto-backup'
				});
				await pruneOldBackups(settings.backup_retention_count);
				await logAudit({
					userId: null,
					action: 'system.auto_backup',
					targetType: 'backup',
					targetId: backup.id,
					details: `Backup automático criado: ${backup.file_name} (${backup.size_bytes} bytes)`
				});
			}
		} catch {
			// Background scheduler should never crash the server
		}
	}, 60 * 60 * 1000).unref?.();
}
