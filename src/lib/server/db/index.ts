import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import {
	getPerformanceConfig,
	isValidPerformanceMode,
	runtimeCache,
	setActivePerformanceMode
} from '$lib/server/performance';

export interface DbConnectionConfig {
	host: string;
	port: number;
	user: string;
	password: string;
	database: string;
}

let currentConfig: DbConnectionConfig = {
	host: process.env.DB_HOST || '127.0.0.1',
	port: Number(process.env.DB_PORT || 3306),
	user: process.env.DB_USER || 'root',
	password: process.env.DB_PASSWORD ?? '',
	database: process.env.DB_NAME || 'lizzart_explorer'
};

let pool: Pool | null = null;
let poolConnectionLimit = 0;
let initPromise: Promise<void> | null = null;
let cachedAdminExists = false;

export function getDbConfig(): Omit<DbConnectionConfig, 'password'> & { has_password: boolean } {
	return {
		host: currentConfig.host,
		port: currentConfig.port,
		user: currentConfig.user,
		database: currentConfig.database,
		has_password: currentConfig.password.length > 0
	};
}

export function getDbRawConfig(): DbConnectionConfig {
	return { ...currentConfig };
}

export function getPool(): Pool {
	const perf = getPerformanceConfig();
	if (!pool) {
		poolConnectionLimit = perf.dbConnectionLimit;
		pool = mysql.createPool({
			host: currentConfig.host,
			port: currentConfig.port,
			user: currentConfig.user,
			password: currentConfig.password,
			database: currentConfig.database,
			waitForConnections: true,
			connectionLimit: perf.dbConnectionLimit,
			queueLimit: perf.dbQueueLimit,
			enableKeepAlive: true,
			keepAliveInitialDelay: 15_000,
			charset: 'utf8mb4',
			timezone: 'Z'
		});
	}
	return pool;
}

/**
 * Recreates the MariaDB connection pool when the performance profile changes
 * so the new connectionLimit / queueLimit takes effect immediately.
 */
export async function applyPoolPerformanceLimits(): Promise<void> {
	const perf = getPerformanceConfig();
	if (!pool || poolConnectionLimit === perf.dbConnectionLimit) return;

	const oldPool = pool;
	pool = null;
	poolConnectionLimit = 0;
	getPool();
	await oldPool.end().catch(() => {});
}

export async function testDbConnection(
	cfg: Partial<DbConnectionConfig>
): Promise<{ ok: boolean; version?: string; error?: string }> {
	const host = cfg.host || currentConfig.host;
	const port = Number(cfg.port || currentConfig.port);
	const user = cfg.user || currentConfig.user;
	const password = cfg.password !== undefined ? cfg.password : currentConfig.password;

	try {
		const conn = await mysql.createConnection({
			host,
			port,
			user,
			password,
			connectTimeout: 5000
		});
		try {
			const [rows] = await conn.query<RowDataPacket[]>('SELECT VERSION() AS version');
			return { ok: true, version: String(rows[0]?.version || 'MariaDB') };
		} finally {
			await conn.end();
		}
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : 'Não foi possível conectar ao MariaDB.'
		};
	}
}

export async function reconfigureDbPool(next: DbConnectionConfig): Promise<void> {
	const oldPool = pool;
	currentConfig = { ...next };
	pool = null;
	poolConnectionLimit = 0;
	initPromise = null;
	cachedAdminExists = false;
	runtimeCache.clear();

	if (oldPool) {
		await oldPool.end().catch(() => {});
	}
	await ensureDatabaseReady();
}

export async function ensureDatabaseReady(): Promise<void> {
	if (!initPromise) {
		initPromise = initializeDatabase().catch((err) => {
			initPromise = null;
			throw err;
		});
	}
	return initPromise;
}

export function resetAdminExistsCache(): void {
	cachedAdminExists = false;
}

export async function hasAnyAdmin(): Promise<boolean> {
	if (cachedAdminExists) return true;
	await ensureDatabaseReady();
	const db = getPool();
	const [rows] = await db.query<RowDataPacket[]>(
		"SELECT COUNT(*) AS total FROM users WHERE role = 'admin'"
	);
	const exists = Number(rows[0]?.total ?? 0) > 0;
	if (exists) cachedAdminExists = true;
	return exists;
}

async function columnExists(db: Pool, table: string, column: string): Promise<boolean> {
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT 1 FROM information_schema.COLUMNS
		 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
		[currentConfig.database, table, column]
	);
	return rows.length > 0;
}

async function safeAlter(db: Pool, sql: string): Promise<void> {
	try {
		await db.query(sql);
	} catch {
		// Ignore idempotent migration errors (already applied)
	}
}

async function initializeDatabase(): Promise<void> {
	const bootstrap = await mysql.createConnection({
		host: currentConfig.host,
		port: currentConfig.port,
		user: currentConfig.user,
		password: currentConfig.password
	});

	try {
		await bootstrap.query(
			`CREATE DATABASE IF NOT EXISTS \`${currentConfig.database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
		);
	} finally {
		await bootstrap.end();
	}

	const db = getPool();

	// 1. Users (no longer owns storage quota — quotas live inside workspaces!)
	await db.query(`
		CREATE TABLE IF NOT EXISTS users (
			id CHAR(36) NOT NULL,
			username VARCHAR(64) NOT NULL,
			first_name VARCHAR(80) NOT NULL,
			last_name VARCHAR(80) NOT NULL,
			password_hash VARCHAR(255) NOT NULL,
			role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
			is_active TINYINT(1) NOT NULL DEFAULT 1,
			avatar_color VARCHAR(32) NOT NULL DEFAULT '#10b981',
			avatar_path VARCHAR(255) NULL,
			accent_color VARCHAR(32) NOT NULL DEFAULT '#10b981',
			layout_density ENUM('normal', 'compact') NOT NULL DEFAULT 'normal',
			default_view_mode ENUM('grid', 'list') NOT NULL DEFAULT 'grid',
			default_sort_by ENUM('name', 'date', 'size') NOT NULL DEFAULT 'name',
			default_sort_dir ENUM('asc', 'desc') NOT NULL DEFAULT 'asc',
			totp_secret VARCHAR(512) NULL,
			totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
			totp_last_step BIGINT NULL,
			failed_login_count INT NOT NULL DEFAULT 0,
			locked_until DATETIME NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_users_username (username)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	// Upgrade v2 users columns safely if upgrading from older schema
	if (!(await columnExists(db, 'users', 'totp_last_step'))) {
		await safeAlter(db, 'ALTER TABLE users MODIFY COLUMN totp_secret VARCHAR(512) NULL');
		await safeAlter(db, 'ALTER TABLE users ADD COLUMN totp_last_step BIGINT NULL AFTER totp_enabled');
		await safeAlter(db, 'ALTER TABLE users ADD COLUMN failed_login_count INT NOT NULL DEFAULT 0 AFTER totp_last_step');
		await safeAlter(db, 'ALTER TABLE users ADD COLUMN locked_until DATETIME NULL AFTER failed_login_count');
	}

	// 2. Sessions (EdDSA JWT + HMAC-SHA512 refresh token rotation & reuse detection)
	await db.query(`
		CREATE TABLE IF NOT EXISTS sessions (
			id CHAR(36) NOT NULL,
			user_id CHAR(36) NOT NULL,
			token_family CHAR(36) NOT NULL,
			refresh_token_hash CHAR(128) NOT NULL,
			previous_token_hash CHAR(128) NULL,
			rotated_at DATETIME NULL,
			rotation_count INT NOT NULL DEFAULT 0,
			device_label VARCHAR(120) NULL,
			ip_address VARCHAR(64) NULL,
			user_agent VARCHAR(255) NULL,
			last_used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			expires_at DATETIME NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_sessions_refresh_hash (refresh_token_hash),
			KEY idx_sessions_prev_hash (previous_token_hash),
			KEY idx_sessions_family (token_family),
			KEY idx_sessions_user (user_id),
			KEY idx_sessions_expires (expires_at),
			CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	// Upgrade v2 sessions columns safely
	if (!(await columnExists(db, 'sessions', 'token_family'))) {
		await safeAlter(db, 'ALTER TABLE sessions MODIFY COLUMN refresh_token_hash CHAR(128) NOT NULL');
		await safeAlter(db, 'ALTER TABLE sessions ADD COLUMN token_family CHAR(36) NOT NULL DEFAULT "" AFTER user_id');
		await safeAlter(db, 'ALTER TABLE sessions ADD COLUMN previous_token_hash CHAR(128) NULL AFTER refresh_token_hash');
		await safeAlter(db, 'ALTER TABLE sessions ADD COLUMN rotated_at DATETIME NULL AFTER previous_token_hash');
		await safeAlter(db, 'ALTER TABLE sessions ADD COLUMN rotation_count INT NOT NULL DEFAULT 0 AFTER rotated_at');
		await safeAlter(db, 'ALTER TABLE sessions ADD COLUMN device_label VARCHAR(120) NULL AFTER rotation_count');
		await safeAlter(db, 'ALTER TABLE sessions ADD KEY idx_sessions_prev_hash (previous_token_hash)');
		await safeAlter(db, 'ALTER TABLE sessions ADD KEY idx_sessions_family (token_family)');
		await db.query("UPDATE sessions SET token_family = id WHERE token_family = ''").catch(() => {});
	}

	// 3. Workspaces & Workspace Members (decoupled from users!)
	await db.query(`
		CREATE TABLE IF NOT EXISTS workspaces (
			id CHAR(36) NOT NULL,
			name VARCHAR(120) NOT NULL,
			slug VARCHAR(80) NOT NULL,
			description VARCHAR(255) NULL,
			color VARCHAR(32) NOT NULL DEFAULT '#10b981',
			quota_bytes BIGINT NOT NULL DEFAULT 10737418240,
			used_bytes BIGINT NOT NULL DEFAULT 0,
			is_active TINYINT(1) NOT NULL DEFAULT 1,
			created_by CHAR(36) NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_workspaces_slug (slug),
			CONSTRAINT fk_workspaces_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	await db.query(`
		CREATE TABLE IF NOT EXISTS workspace_members (
			id CHAR(36) NOT NULL,
			workspace_id CHAR(36) NOT NULL,
			user_id CHAR(36) NOT NULL,
			role ENUM('manager', 'editor', 'viewer') NOT NULL DEFAULT 'editor',
			assigned_by CHAR(36) NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_ws_member (workspace_id, user_id),
			KEY idx_ws_member_user (user_id),
			CONSTRAINT fk_ws_member_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
			CONSTRAINT fk_ws_member_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
			CONSTRAINT fk_ws_member_assigner FOREIGN KEY (assigned_by) REFERENCES users (id) ON DELETE SET NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	// 4. Storage Nodes (owned by workspaces, NOT users!)
	await db.query(`
		CREATE TABLE IF NOT EXISTS storage_nodes (
			id CHAR(36) NOT NULL,
			workspace_id CHAR(36) NOT NULL,
			created_by CHAR(36) NULL,
			parent_id CHAR(36) NULL,
			type ENUM('folder', 'file') NOT NULL,
			name VARCHAR(255) NOT NULL,
			mime_type VARCHAR(190) NULL,
			size_bytes BIGINT NOT NULL DEFAULT 0,
			disk_path VARCHAR(512) NULL,
			sha256 CHAR(64) NULL,
			is_starred TINYINT(1) NOT NULL DEFAULT 0,
			is_trashed TINYINT(1) NOT NULL DEFAULT 0,
			trashed_at DATETIME NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_nodes_ws_parent_trash (workspace_id, parent_id, is_trashed),
			KEY idx_nodes_ws_star (workspace_id, is_starred, is_trashed),
			KEY idx_nodes_disk_path (disk_path),
			KEY idx_nodes_name (name),
			CONSTRAINT fk_nodes_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
			CONSTRAINT fk_nodes_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
			CONSTRAINT fk_nodes_parent FOREIGN KEY (parent_id) REFERENCES storage_nodes (id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	// Seamless migration from v2 storage_nodes (owner_id -> workspace_id + created_by)
	if (!(await columnExists(db, 'storage_nodes', 'workspace_id'))) {
		await safeAlter(db, 'ALTER TABLE storage_nodes ADD COLUMN workspace_id CHAR(36) NULL AFTER id');
		await safeAlter(db, 'ALTER TABLE storage_nodes ADD COLUMN created_by CHAR(36) NULL AFTER workspace_id');

		// Migrate existing user-owned nodes into dedicated workspaces per legacy owner
		const [legacyOwners] = await db.query<RowDataPacket[]>(
			`SELECT DISTINCT n.owner_id, u.username, u.first_name, u.quota_bytes, u.used_bytes
			 FROM storage_nodes n
			 INNER JOIN users u ON u.id = n.owner_id`
		);
		for (const lo of legacyOwners) {
			const wsId = crypto.randomUUID();
			const slug = `migrated-${String(lo.username).slice(0, 48)}-${wsId.slice(0, 6)}`;
			await db.query(
				`INSERT INTO workspaces (id, name, slug, description, quota_bytes, used_bytes, created_by)
				 VALUES (?, ?, ?, 'Workspace migrada automaticamente', ?, ?, ?)`,
				[
					wsId,
					`Workspace de ${lo.first_name || lo.username}`,
					slug,
					Number(lo.quota_bytes ?? 10737418240),
					Number(lo.used_bytes ?? 0),
					lo.owner_id
				]
			);
			await db.query(
				`INSERT IGNORE INTO workspace_members (id, workspace_id, user_id, role, assigned_by)
				 VALUES (?, ?, ?, 'manager', ?)`,
				[crypto.randomUUID(), wsId, lo.owner_id, lo.owner_id]
			);
			await db.query(
				'UPDATE storage_nodes SET workspace_id = ?, created_by = owner_id WHERE owner_id = ?',
				[wsId, lo.owner_id]
			);
		}
		await safeAlter(db, 'ALTER TABLE storage_nodes DROP FOREIGN KEY fk_nodes_owner');
		await safeAlter(db, 'ALTER TABLE storage_nodes DROP COLUMN owner_id');
		await safeAlter(db, 'ALTER TABLE storage_nodes MODIFY COLUMN workspace_id CHAR(36) NOT NULL');
		await safeAlter(db, 'ALTER TABLE storage_nodes ADD KEY idx_nodes_ws_parent_trash (workspace_id, parent_id, is_trashed)');
		await safeAlter(db, 'ALTER TABLE storage_nodes ADD KEY idx_nodes_ws_star (workspace_id, is_starred, is_trashed)');
		await safeAlter(db, 'ALTER TABLE storage_nodes ADD CONSTRAINT fk_nodes_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE');
		await safeAlter(db, 'ALTER TABLE storage_nodes ADD CONSTRAINT fk_nodes_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL');
	}

	// 5. Upload Sessions (resumable chunks scoped to workspace)
	await db.query(`
		CREATE TABLE IF NOT EXISTS upload_sessions (
			id CHAR(36) NOT NULL,
			workspace_id CHAR(36) NOT NULL,
			user_id CHAR(36) NOT NULL,
			parent_id CHAR(36) NULL,
			fingerprint VARCHAR(255) NOT NULL,
			file_name VARCHAR(255) NOT NULL,
			mime_type VARCHAR(190) NOT NULL DEFAULT 'application/octet-stream',
			total_bytes BIGINT NOT NULL,
			uploaded_bytes BIGINT NOT NULL DEFAULT 0,
			temp_path VARCHAR(512) NOT NULL,
			status ENUM('uploading', 'completed', 'aborted') NOT NULL DEFAULT 'uploading',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_upload_lookup (user_id, workspace_id, fingerprint, status),
			CONSTRAINT fk_upload_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
			CONSTRAINT fk_upload_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	if (!(await columnExists(db, 'upload_sessions', 'workspace_id'))) {
		await db.query('DELETE FROM upload_sessions').catch(() => {});
		await safeAlter(db, 'ALTER TABLE upload_sessions DROP FOREIGN KEY fk_upload_owner');
		await safeAlter(db, 'ALTER TABLE upload_sessions DROP COLUMN owner_id');
		await safeAlter(db, 'ALTER TABLE upload_sessions ADD COLUMN workspace_id CHAR(36) NOT NULL AFTER id');
		await safeAlter(db, 'ALTER TABLE upload_sessions ADD CONSTRAINT fk_upload_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE');
	}

	// 6. Node Permissions (cross-workspace sharing by @user)
	await db.query(`
		CREATE TABLE IF NOT EXISTS node_permissions (
			id CHAR(36) NOT NULL,
			node_id CHAR(36) NOT NULL,
			user_id CHAR(36) NOT NULL,
			granted_by CHAR(36) NULL,
			permission ENUM('viewer', 'editor') NOT NULL DEFAULT 'viewer',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_node_user (node_id, user_id),
			KEY idx_perm_user (user_id),
			CONSTRAINT fk_perm_node FOREIGN KEY (node_id) REFERENCES storage_nodes (id) ON DELETE CASCADE,
			CONSTRAINT fk_perm_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
			CONSTRAINT fk_perm_granted_by FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE SET NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	// 7. Share Links (public links remain alive even if creator user is deleted)
	await db.query(`
		CREATE TABLE IF NOT EXISTS share_links (
			id CHAR(36) NOT NULL,
			node_id CHAR(36) NOT NULL,
			created_by CHAR(36) NULL,
			token VARCHAR(64) NOT NULL,
			password_hash VARCHAR(255) NULL,
			expires_at DATETIME NULL,
			max_downloads INT NULL,
			download_count INT NOT NULL DEFAULT 0,
			is_active TINYINT(1) NOT NULL DEFAULT 1,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_share_token (token),
			KEY idx_share_node (node_id),
			CONSTRAINT fk_share_node FOREIGN KEY (node_id) REFERENCES storage_nodes (id) ON DELETE CASCADE,
			CONSTRAINT fk_share_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	// 8. Database Backups
	await db.query(`
		CREATE TABLE IF NOT EXISTS db_backups (
			id CHAR(36) NOT NULL,
			file_name VARCHAR(255) NOT NULL,
			file_path VARCHAR(512) NOT NULL,
			size_bytes BIGINT NOT NULL DEFAULT 0,
			sha256 CHAR(64) NOT NULL,
			method ENUM('mariadb-dump', 'sql-native', 'uploaded') NOT NULL DEFAULT 'mariadb-dump',
			compressed TINYINT(1) NOT NULL DEFAULT 1,
			created_by CHAR(36) NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_backups_created (created_at),
			CONSTRAINT fk_backup_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	// 9. Audit Logs
	await db.query(`
		CREATE TABLE IF NOT EXISTS audit_logs (
			id BIGINT NOT NULL AUTO_INCREMENT,
			user_id CHAR(36) NULL,
			action VARCHAR(64) NOT NULL,
			target_type VARCHAR(32) NULL,
			target_id CHAR(36) NULL,
			details TEXT NULL,
			ip_address VARCHAR(64) NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_audit_created (created_at),
			KEY idx_audit_user (user_id),
			CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	// 10. System Settings
	await db.query(`
		CREATE TABLE IF NOT EXISTS system_settings (
			setting_key VARCHAR(64) NOT NULL,
			setting_value TEXT NOT NULL,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (setting_key)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	// 11. Minecraft UI Shell
	await db.query(`
		CREATE TABLE IF NOT EXISTS mc_servers (
			id CHAR(36) NOT NULL,
			name VARCHAR(120) NOT NULL,
			description VARCHAR(255) NULL,
			version VARCHAR(32) NOT NULL DEFAULT '1.21.4',
			edition_label VARCHAR(32) NOT NULL DEFAULT 'Interface Casca',
			host_port INT NOT NULL DEFAULT 25565,
			max_players INT NOT NULL DEFAULT 20,
			allocated_ram_mb INT NOT NULL DEFAULT 4096,
			motd VARCHAR(255) NOT NULL DEFAULT 'Bem-vindo ao Lizzart Craft!',
			gamemode VARCHAR(32) NOT NULL DEFAULT 'survival',
			difficulty VARCHAR(32) NOT NULL DEFAULT 'normal',
			pvp TINYINT(1) NOT NULL DEFAULT 1,
			online_mode TINYINT(1) NOT NULL DEFAULT 1,
			whitelist TINYINT(1) NOT NULL DEFAULT 0,
			status ENUM('offline', 'online', 'starting', 'stopping') NOT NULL DEFAULT 'offline',
			created_by CHAR(36) NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			CONSTRAINT fk_mc_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	const defaultSettings: [string, string][] = [
		['default_quota_gb', '10'],
		['max_upload_mb', '10240'],
		['storage_root', process.env.STORAGE_ROOT || './storage'],
		['performance_mode', 'optimized'],
		['auto_backup_interval', 'off'],
		['backup_retention_count', '10']
	];
	for (const [key, value] of defaultSettings) {
		await db.query(
			'INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES (?, ?)',
			[key, value]
		);
	}

	// Load persisted performance mode and apply immediately
	const [perfRows] = await db.query<RowDataPacket[]>(
		"SELECT setting_value FROM system_settings WHERE setting_key = 'performance_mode' LIMIT 1"
	);
	const savedMode = perfRows[0]?.setting_value;
	if (isValidPerformanceMode(savedMode)) {
		setActivePerformanceMode(savedMode);
		await applyPoolPerformanceLimits();
	}
}
