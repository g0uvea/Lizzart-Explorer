import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';
import { hashPassword } from '../crypto';

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD ?? '';
const DB_NAME = process.env.DB_NAME || 'lizzart_explorer';

let pool: Pool | null = null;
let initPromise: Promise<void> | null = null;

export function getPool(): Pool {
	if (!pool) {
		pool = mysql.createPool({
			host: DB_HOST,
			port: DB_PORT,
			user: DB_USER,
			password: DB_PASSWORD,
			database: DB_NAME,
			waitForConnections: true,
			connectionLimit: 15,
			queueLimit: 0,
			charset: 'utf8mb4',
			timezone: 'Z'
		});
	}
	return pool;
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

async function initializeDatabase(): Promise<void> {
	// 1. Create database if it does not exist
	const bootstrap = await mysql.createConnection({
		host: DB_HOST,
		port: DB_PORT,
		user: DB_USER,
		password: DB_PASSWORD
	});

	try {
		await bootstrap.query(
			`CREATE DATABASE IF NOT EXISTS \`${DB_NAME.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
		);
	} finally {
		await bootstrap.end();
	}

	const db = getPool();

	// 2. Create tables idempotently
	await db.query(`
		CREATE TABLE IF NOT EXISTS users (
			id CHAR(36) NOT NULL,
			name VARCHAR(120) NOT NULL,
			email VARCHAR(190) NOT NULL,
			password_hash VARCHAR(255) NOT NULL,
			role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
			quota_bytes BIGINT NOT NULL DEFAULT 10737418240,
			used_bytes BIGINT NOT NULL DEFAULT 0,
			is_active TINYINT(1) NOT NULL DEFAULT 1,
			avatar_color VARCHAR(32) NOT NULL DEFAULT '#6366f1',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_users_email (email)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	await db.query(`
		CREATE TABLE IF NOT EXISTS sessions (
			id VARCHAR(128) NOT NULL,
			user_id CHAR(36) NOT NULL,
			ip_address VARCHAR(64) NULL,
			user_agent VARCHAR(255) NULL,
			expires_at DATETIME NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			KEY idx_sessions_user (user_id),
			KEY idx_sessions_expires (expires_at),
			CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	await db.query(`
		CREATE TABLE IF NOT EXISTS storage_nodes (
			id CHAR(36) NOT NULL,
			owner_id CHAR(36) NOT NULL,
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
			KEY idx_nodes_owner_parent_trash (owner_id, parent_id, is_trashed),
			KEY idx_nodes_owner_star (owner_id, is_starred, is_trashed),
			KEY idx_nodes_disk_path (disk_path),
			KEY idx_nodes_name (name),
			CONSTRAINT fk_nodes_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE,
			CONSTRAINT fk_nodes_parent FOREIGN KEY (parent_id) REFERENCES storage_nodes (id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	await db.query(`
		CREATE TABLE IF NOT EXISTS node_permissions (
			id CHAR(36) NOT NULL,
			node_id CHAR(36) NOT NULL,
			user_id CHAR(36) NOT NULL,
			granted_by CHAR(36) NOT NULL,
			permission ENUM('viewer', 'editor') NOT NULL DEFAULT 'viewer',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY uq_node_user (node_id, user_id),
			KEY idx_perm_user (user_id),
			CONSTRAINT fk_perm_node FOREIGN KEY (node_id) REFERENCES storage_nodes (id) ON DELETE CASCADE,
			CONSTRAINT fk_perm_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
			CONSTRAINT fk_perm_granted_by FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	await db.query(`
		CREATE TABLE IF NOT EXISTS share_links (
			id CHAR(36) NOT NULL,
			node_id CHAR(36) NOT NULL,
			created_by CHAR(36) NOT NULL,
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
			CONSTRAINT fk_share_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

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

	await db.query(`
		CREATE TABLE IF NOT EXISTS system_settings (
			setting_key VARCHAR(64) NOT NULL,
			setting_value TEXT NOT NULL,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (setting_key)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
	`);

	await db.query(`
		CREATE TABLE IF NOT EXISTS mc_servers (
			id CHAR(36) NOT NULL,
			name VARCHAR(120) NOT NULL,
			description VARCHAR(255) NULL,
			version VARCHAR(32) NOT NULL DEFAULT '1.21.4',
			edition_label VARCHAR(32) NOT NULL DEFAULT 'Vanilla',
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

	// 3. Default system settings
	const defaultSettings: [string, string][] = [
		['allow_registration', 'true'],
		['default_quota_gb', '10'],
		['max_upload_mb', '512']
	];
	for (const [key, value] of defaultSettings) {
		await db.query(
			'INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES (?, ?)',
			[key, value]
		);
	}

	// 4. Default admin user if none exists
	const [userCountRows] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM users');
	const totalUsers = Number(userCountRows[0]?.total ?? 0);

	if (totalUsers === 0) {
		const adminId = crypto.randomUUID();
		const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@lizzart.local';
		const adminPass = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
		const passwordHash = await hashPassword(adminPass);

		await db.query(
			`INSERT INTO users (id, name, email, password_hash, role, quota_bytes, used_bytes, is_active, avatar_color)
			 VALUES (?, ?, ?, ?, 'admin', ?, 0, 1, '#6366f1')`,
			[adminId, 'Administrador', adminEmail, passwordHash, 100 * 1024 * 1024 * 1024]
		);

		// Create welcome folders for admin
		const docsId = crypto.randomUUID();
		const mediaId = crypto.randomUUID();
		const backupsId = crypto.randomUUID();
		await db.query(
			`INSERT INTO storage_nodes (id, owner_id, parent_id, type, name) VALUES
			 (?, ?, NULL, 'folder', 'Documentos'),
			 (?, ?, NULL, 'folder', 'Mídia & Imagens'),
			 (?, ?, NULL, 'folder', 'Backups')`,
			[docsId, adminId, mediaId, adminId, backupsId, adminId]
		);

		// Seed showcase shell Minecraft servers (interface only)
		const [mcRows] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM mc_servers');
		if (Number(mcRows[0]?.total ?? 0) === 0) {
			await db.query(
				`INSERT INTO mc_servers (id, name, description, version, edition_label, host_port, max_players, allocated_ram_mb, motd, gamemode, difficulty, pvp, online_mode, whitelist, status, created_by)
				 VALUES
				 (?, 'Lizzart Survival SMP', 'Servidor principal de sobrevivência com amigos', '1.21.4', 'Vanilla', 25565, 24, 6144, 'Lizzart Survival SMP • Temporada 1', 'survival', 'hard', 1, 1, 1, 'offline', ?),
				 (?, 'Arena Criativo & Testes', 'Mundo plano para construções e testes de redstone', '1.21.4', 'Custom Shell', 25566, 12, 2048, 'Lizzart Criativo • Construa livremente', 'creative', 'peaceful', 0, 1, 0, 'offline', ?)`,
				[crypto.randomUUID(), adminId, crypto.randomUUID(), adminId]
			);
		}
	}
}
