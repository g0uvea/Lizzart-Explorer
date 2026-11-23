#!/usr/bin/env bun
import os from 'node:os';
import crypto from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import {
	applyPoolPerformanceLimits,
	ensureDatabaseReady,
	getDbConfig,
	getPool,
	resetAdminExistsCache
} from '../src/lib/server/db';
import { hashPassword } from '../src/lib/server/crypto';
import {
	isValidUsername,
	normalizeUsername,
	revokeOtherUserSessions
} from '../src/lib/server/auth';
import {
	deleteDiskBlobIfUnreferenced,
	getStorageRoot,
	inspectStorageDirectory
} from '../src/lib/server/storage';
import {
	listAllWorkspacesAdmin,
	normalizeWorkspaceRole,
	recalculateWorkspaceUsedBytes,
	slugifyWorkspace
} from '../src/lib/server/workspaces';
import {
	getActivePerformanceMode,
	isValidPerformanceMode,
	listPerformanceProfiles,
	setActivePerformanceMode
} from '../src/lib/server/performance';
import {
	createDatabaseBackup,
	deleteDatabaseBackup,
	listDatabaseBackups
} from '../src/lib/server/backup';

// ANSI colors
const C = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	emerald: '\x1b[38;5;42m',
	cyan: '\x1b[36m',
	yellow: '\x1b[33m',
	red: '\x1b[31m',
	white: '\x1b[97m',
	gray: '\x1b[90m'
};

function formatBytes(bytes: number): string {
	if (bytes < 0) return 'Unlimited (∞)';
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	const val = bytes / Math.pow(1024, i);
	return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
	const positional: string[] = [];
	const flags: Record<string, string | boolean> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith('--')) {
			const eqIdx = arg.indexOf('=');
			if (eqIdx !== -1) {
				flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
			} else {
				const key = arg.slice(2);
				const next = args[i + 1];
				if (next && !next.startsWith('-')) {
					flags[key] = next;
					i++;
				} else {
					flags[key] = true;
				}
			}
		} else if (arg.startsWith('-') && arg.length > 1) {
			flags[arg.slice(1)] = true;
		} else {
			positional.push(arg);
		}
	}
	return { positional, flags };
}

function banner() {
	console.log(
		`\n${C.emerald}${C.bold}⚡ LIZZART EXPLORER CLI${C.reset} ${C.gray}(v2.0 — Cloud & Workspaces Server Management)${C.reset}`
	);
	console.log(`${C.gray}──────────────────────────────────────────────────────────────────────────${C.reset}`);
}

function printMainHelp() {
	banner();
	console.log(`${C.bold}USAGE:${C.reset}`);
	console.log(`  ${C.emerald}lizzart${C.reset} <command> [subcommand] [options]\n`);

	console.log(`${C.bold}CORE COMMANDS:${C.reset}`);
	console.log(
		`  ${C.cyan}status${C.reset}                  Show server health, MariaDB status, disk usage, users & workspaces summary`
	);
	console.log(
		`  ${C.cyan}user${C.reset}                    Manage user accounts (list, create, delete, update, reset-password, remove-2fa)`
	);
	console.log(
		`  ${C.cyan}workspace${C.reset}               Manage workspaces, quotas & members (list, create, delete, update, add-user, remove-user, members)`
	);
	console.log(
		`  ${C.cyan}performance${C.reset}             Inspect or switch hardware performance profiles (legacy_mobile, ultra_optimized, optimized, fast, ultra_fast)`
	);
	console.log(
		`  ${C.cyan}backup${C.reset}                  Manage MariaDB database backups (list, create, delete)`
	);
	console.log(
		`  ${C.cyan}-help, --help, help${C.reset}     Show this help screen\n`
	);

	console.log(`${C.bold}QUICK EXAMPLES:${C.reset}`);
	console.log(`  ${C.gray}$${C.reset} lizzart status`);
	console.log(`  ${C.gray}$${C.reset} lizzart user`);
	console.log(`  ${C.gray}$${C.reset} lizzart user create --username joao --first "João" --last "Vitor" --password "secret123" --role admin`);
	console.log(`  ${C.gray}$${C.reset} lizzart workspace`);
	console.log(`  ${C.gray}$${C.reset} lizzart workspace create --name "Design Team" --quota 50`);
	console.log(`  ${C.gray}$${C.reset} lizzart workspace add-user --workspace "Design Team" --username joao --role manager\n`);
}

function printUserHelp() {
	banner();
	console.log(`${C.bold}USER MANAGEMENT (${C.cyan}lizzart user${C.reset}${C.bold}):${C.reset}\n`);
	console.log(`  ${C.cyan}lizzart user list${C.reset}`);
	console.log(`      List all registered users, roles, status, 2FA, language/country, and connected workspaces.\n`);
	console.log(
		`  ${C.cyan}lizzart user create${C.reset} --username <user> --first <name> --last <surname> --password <pass> [--role admin|user]`
	);
	console.log(`      Create a new user account.\n`);
	console.log(
		`  ${C.cyan}lizzart user update${C.reset} <username> [--first <name>] [--last <surname>] [--role admin|user] [--active true|false] [--lang en|pt|es] [--country BR|US|...]`
	);
	console.log(`      Update user profile attributes, role, active state, language or country.\n`);
	console.log(`  ${C.cyan}lizzart user reset-password${C.reset} <username> --password <new_password>`);
	console.log(`      Reset a user's password (Argon2id) and revoke all active sessions.\n`);
	console.log(`  ${C.cyan}lizzart user remove-2fa${C.reset} <username>`);
	console.log(`      Disable and clear local TOTP 2FA from a user's account.\n`);
	console.log(`  ${C.cyan}lizzart user unlock${C.reset} <username>`);
	console.log(`      Clear failed login counters and unlock a locked user account.\n`);
	console.log(`  ${C.cyan}lizzart user delete${C.reset} <username>`);
	console.log(`      Delete a user account (all workspaces and files remain 100% preserved).\n`);
}

function printWorkspaceHelp() {
	banner();
	console.log(`${C.bold}WORKSPACE MANAGEMENT (${C.cyan}lizzart workspace${C.reset}${C.bold}):${C.reset}\n`);
	console.log(`  ${C.cyan}lizzart workspace list${C.reset}`);
	console.log(`      List all workspaces with disk usage, storage quota, file count, and member count.\n`);
	console.log(
		`  ${C.cyan}lizzart workspace create${C.reset} --name <name> [--quota <GB|unlimited>] [--desc <text>] [--color <#hex>]`
	);
	console.log(`      Create a new independent workspace (minimum quota: 10 GB, or 'unlimited').\n`);
	console.log(
		`  ${C.cyan}lizzart workspace update${C.reset} <id-or-slug-or-name> [--name <new_name>] [--quota <GB|unlimited>] [--desc <text>] [--active true|false]`
	);
	console.log(`      Update workspace name, storage quota, description, or active status.\n`);
	console.log(`  ${C.cyan}lizzart workspace members${C.reset} <id-or-slug-or-name>`);
	console.log(`      List all users connected to a workspace and their permission roles.\n`);
	console.log(
		`  ${C.cyan}lizzart workspace add-user${C.reset} --workspace <id-or-slug-or-name> --username <user> [--role manager|editor|viewer]`
	);
	console.log(`      Connect a user to a workspace (or update their existing role).\n`);
	console.log(
		`  ${C.cyan}lizzart workspace remove-user${C.reset} --workspace <id-or-slug-or-name> --username <user>`
	);
	console.log(`      Disconnect a user from a workspace without deleting any files.\n`);
	console.log(`  ${C.cyan}lizzart workspace recalculate${C.reset} <id-or-slug-or-name>`);
	console.log(`      Recalculate exact disk usage from storage nodes for a workspace.\n`);
	console.log(`  ${C.cyan}lizzart workspace delete${C.reset} <id-or-slug-or-name>`);
	console.log(`      Permanently delete a workspace and all its files from disk.\n`);
}

async function findWorkspace(query: string): Promise<RowDataPacket | null> {
	const db = getPool();
	const q = query.trim();
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT * FROM workspaces WHERE id = ? OR slug = ? OR LOWER(name) = LOWER(?) LIMIT 1',
		[q, q, q]
	);
	return rows[0] ?? null;
}

async function cmdStatus() {
	banner();
	await ensureDatabaseReady();
	const db = getPool();
	const dbCfg = getDbConfig();

	const [[userStats], [wsStats], [nodeStats], [linkStats], [sessionStats], [settingsRows]] =
		await Promise.all([
			db.query<RowDataPacket[]>(
				`SELECT COUNT(*) AS total,
				        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admins,
				        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
				        SUM(CASE WHEN totp_enabled = 1 THEN 1 ELSE 0 END) AS totp
				 FROM users`
			),
			db.query<RowDataPacket[]>(
				`SELECT COUNT(*) AS total,
				        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
				        COALESCE(SUM(used_bytes), 0) AS used_bytes
				 FROM workspaces`
			),
			db.query<RowDataPacket[]>(
				`SELECT
				   SUM(CASE WHEN type = 'file' AND is_trashed = 0 THEN 1 ELSE 0 END) AS files,
				   SUM(CASE WHEN type = 'folder' AND is_trashed = 0 THEN 1 ELSE 0 END) AS folders,
				   SUM(CASE WHEN is_trashed = 1 THEN 1 ELSE 0 END) AS trashed,
				   COALESCE(SUM(CASE WHEN type = 'file' THEN size_bytes ELSE 0 END), 0) AS total_bytes
				 FROM storage_nodes`
			),
			db.query<RowDataPacket[]>(
				`SELECT COUNT(*) AS links, COALESCE(SUM(download_count), 0) AS downloads
				 FROM share_links WHERE is_active = 1`
			),
			db.query<RowDataPacket[]>(
				'SELECT COUNT(*) AS active_sessions FROM sessions WHERE expires_at > CURRENT_TIMESTAMP'
			),
			db.query<RowDataPacket[]>('SELECT setting_key, setting_value FROM system_settings')
		]);

	const settingsMap = new Map<string, string>();
	for (const r of settingsRows) {
		settingsMap.set(String(r.setting_key), String(r.setting_value));
	}

	const storagePath = settingsMap.get('storage_root') || getStorageRoot();
	const diskInfo = await inspectStorageDirectory(storagePath);

	const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
	const freeMemMb = Math.round(os.freemem() / (1024 * 1024));
	const usedMemMb = totalMemMb - freeMemMb;
	const cpus = os.cpus();

	console.log(`${C.bold}🖥️  HOST & RUNTIME:${C.reset}`);
	console.log(`   OS / Arch          : ${os.type()} ${os.release()} (${os.arch()})`);
	console.log(`   CPU                : ${cpus[0]?.model || 'Generic CPU'} (${cpus.length} cores)`);
	console.log(`   System RAM         : ${usedMemMb} MB used / ${totalMemMb} MB total (${freeMemMb} MB free)`);
	console.log(`   Performance Mode   : ${C.emerald}${settingsMap.get('performance_mode') || getActivePerformanceMode()}${C.reset}`);
	console.log(
		`   Default Locale     : Language=${C.cyan}${(settingsMap.get('default_language') || 'en').toUpperCase()}${C.reset} | Country=${C.cyan}${settingsMap.get('default_country') || 'US'}${C.reset}\n`
	);

	console.log(`${C.bold}🗄️  DATABASE & STORAGE:${C.reset}`);
	console.log(`   MariaDB Connection : ${C.emerald}ONLINE${C.reset} (${dbCfg.user}@${dbCfg.host}:${dbCfg.port}/${dbCfg.database})`);
	console.log(`   Storage Directory  : ${diskInfo.resolvedPath}`);
	console.log(`   App Disk Used      : ${C.emerald}${formatBytes(Number(nodeStats[0]?.total_bytes ?? 0))}${C.reset}`);
	if (diskInfo.totalBytes !== undefined && diskInfo.freeBytes !== undefined) {
		const diskUsed = diskInfo.totalBytes - diskInfo.freeBytes;
		const pct = diskInfo.totalBytes > 0 ? Math.round((diskUsed / diskInfo.totalBytes) * 100) : 0;
		console.log(
			`   Filesystem Partition: ${formatBytes(diskInfo.freeBytes)} free of ${formatBytes(diskInfo.totalBytes)} (${pct}% used)`
		);
	}
	console.log(
		`   Stored Objects     : ${Number(nodeStats[0]?.files ?? 0)} files | ${Number(nodeStats[0]?.folders ?? 0)} folders | ${Number(nodeStats[0]?.trashed ?? 0)} in trash\n`
	);

	console.log(`${C.bold}👥 USERS & WORKSPACES:${C.reset}`);
	console.log(
		`   Total Users        : ${C.white}${Number(userStats[0]?.total ?? 0)}${C.reset} (${Number(userStats[0]?.active ?? 0)} active, ${Number(userStats[0]?.admins ?? 0)} admins, ${Number(userStats[0]?.totp ?? 0)} with 2FA)`
	);
	console.log(`   Active Sessions    : ${Number(sessionStats[0]?.active_sessions ?? 0)} connected devices`);
	console.log(
		`   Total Workspaces   : ${C.white}${Number(wsStats[0]?.total ?? 0)}${C.reset} (${Number(wsStats[0]?.active ?? 0)} active)`
	);
	console.log(
		`   Public Share Links : ${Number(linkStats[0]?.links ?? 0)} active links (${Number(linkStats[0]?.downloads ?? 0)} downloads)\n`
	);
}

async function cmdUser(args: string[]) {
	const sub = args[0];
	if (!sub || sub === 'help' || sub === '--help' || sub === '-help') {
		printUserHelp();
		return;
	}

	await ensureDatabaseReady();
	const db = getPool();
	const { positional, flags } = parseFlags(args.slice(1));

	if (sub === 'list') {
		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT u.username, u.first_name, u.last_name, u.role, u.is_active, u.totp_enabled,
			        u.language, u.country, u.created_at,
			        (SELECT COUNT(*) FROM workspace_members wm WHERE wm.user_id = u.id) AS ws_count
			 FROM users u
			 ORDER BY u.created_at ASC`
		);
		banner();
		console.log(`${C.bold}USERS (${rows.length}):${C.reset}\n`);
		if (rows.length === 0) {
			console.log(`  ${C.yellow}No users found. Run 'lizzart user create' or visit /setup.${C.reset}\n`);
			return;
		}
		for (const r of rows) {
			const status = r.is_active ? `${C.emerald}ACTIVE${C.reset}` : `${C.red}DISABLED${C.reset}`;
			const role = r.role === 'admin' ? `${C.cyan}ADMIN${C.reset}` : 'USER';
			const twoFa = r.totp_enabled ? `${C.emerald}2FA:ON${C.reset}` : `${C.gray}2FA:OFF${C.reset}`;
			const lang = `${String(r.language || 'en').toUpperCase()}/${String(r.country || 'US').toUpperCase()}`;
			console.log(
				`  • ${C.bold}@${String(r.username).padEnd(18)}${C.reset} ${String(`${r.first_name} ${r.last_name}`).padEnd(22)} [${role}] [${status}] [${twoFa}] [Locale: ${lang}] [Workspaces: ${r.ws_count}]`
			);
		}
		console.log('');
		return;
	}

	if (sub === 'create') {
		const username = normalizeUsername(String(flags.username || positional[0] || ''));
		const firstName = String(flags.first || flags['first-name'] || '').trim();
		const lastName = String(flags.last || flags['last-name'] || '').trim();
		const password = String(flags.password || '');
		const role = flags.role === 'admin' ? 'admin' : 'user';

		if (!isValidUsername(username)) {
			console.error(`${C.red}Error: Invalid --username (3-32 lowercase chars, digits, ., -, _).${C.reset}`);
			process.exit(1);
		}
		if (firstName.length < 2 || lastName.length < 2) {
			console.error(`${C.red}Error: Provide --first and --last (min 2 chars each).${C.reset}`);
			process.exit(1);
		}
		if (password.length < 8) {
			console.error(`${C.red}Error: --password must be at least 8 characters.${C.reset}`);
			process.exit(1);
		}

		const [existing] = await db.query<RowDataPacket[]>(
			'SELECT id FROM users WHERE username = ? LIMIT 1',
			[username]
		);
		if (existing.length > 0) {
			console.error(`${C.red}Error: User @${username} already exists.${C.reset}`);
			process.exit(1);
		}

		const [sysRows] = await db.query<RowDataPacket[]>(
			"SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('default_language', 'default_country')"
		);
		const sysMap = new Map(sysRows.map((r) => [String(r.setting_key), String(r.setting_value)]));
		const lang = String(flags.lang || sysMap.get('default_language') || 'en');
		const country = String(flags.country || sysMap.get('default_country') || 'US').toUpperCase();

		const id = crypto.randomUUID();
		const hash = await hashPassword(password);
		await db.query(
			`INSERT INTO users (id, username, first_name, last_name, password_hash, role, is_active, language, country)
			 VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
			[id, username, firstName, lastName, hash, role, lang, country]
		);
		if (role === 'admin') resetAdminExistsCache();
		console.log(`${C.emerald}✔ User @${username} (${firstName} ${lastName}) created with role '${role}'!${C.reset}`);
		return;
	}

	if (sub === 'update') {
		const username = normalizeUsername(String(positional[0] || flags.username || ''));
		if (!username) {
			console.error(`${C.red}Error: Specify the username to update.${C.reset}`);
			process.exit(1);
		}
		const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM users WHERE username = ? LIMIT 1', [
			username
		]);
		if (rows.length === 0) {
			console.error(`${C.red}Error: User @${username} not found.${C.reset}`);
			process.exit(1);
		}
		const u = rows[0];
		const firstName = flags.first !== undefined ? String(flags.first).trim() : String(u.first_name);
		const lastName = flags.last !== undefined ? String(flags.last).trim() : String(u.last_name);
		const role =
			flags.role === 'admin' || flags.role === 'user' ? flags.role : String(u.role);
		const isActive =
			flags.active !== undefined ? (String(flags.active) === 'true' || flags.active === '1' ? 1 : 0) : Number(u.is_active);
		const lang = flags.lang !== undefined ? String(flags.lang) : String(u.language || 'en');
		const country =
			flags.country !== undefined ? String(flags.country).toUpperCase() : String(u.country || 'US');

		await db.query(
			`UPDATE users SET first_name = ?, last_name = ?, role = ?, is_active = ?, language = ?, country = ? WHERE id = ?`,
			[firstName, lastName, role, isActive, lang, country, u.id]
		);
		resetAdminExistsCache();
		console.log(`${C.emerald}✔ User @${username} updated successfully.${C.reset}`);
		return;
	}

	if (sub === 'reset-password') {
		const username = normalizeUsername(String(positional[0] || flags.username || ''));
		const newPassword = String(flags.password || '');
		if (!username || newPassword.length < 8) {
			console.error(`${C.red}Usage: lizzart user reset-password <username> --password <min_8_chars>${C.reset}`);
			process.exit(1);
		}
		const [rows] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE username = ? LIMIT 1', [
			username
		]);
		if (rows.length === 0) {
			console.error(`${C.red}Error: User @${username} not found.${C.reset}`);
			process.exit(1);
		}
		const hash = await hashPassword(newPassword);
		await db.query(
			'UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?',
			[hash, rows[0].id]
		);
		await revokeOtherUserSessions(String(rows[0].id), null);
		console.log(`${C.emerald}✔ Password reset for @${username} and all active sessions revoked.${C.reset}`);
		return;
	}

	if (sub === 'remove-2fa') {
		const username = normalizeUsername(String(positional[0] || flags.username || ''));
		if (!username) {
			console.error(`${C.red}Usage: lizzart user remove-2fa <username>${C.reset}`);
			process.exit(1);
		}
		const [rows] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE username = ? LIMIT 1', [
			username
		]);
		if (rows.length === 0) {
			console.error(`${C.red}Error: User @${username} not found.${C.reset}`);
			process.exit(1);
		}
		await db.query(
			'UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = ?',
			[rows[0].id]
		);
		console.log(`${C.emerald}✔ Local 2FA (TOTP) removed from @${username}.${C.reset}`);
		return;
	}

	if (sub === 'unlock') {
		const username = normalizeUsername(String(positional[0] || flags.username || ''));
		if (!username) {
			console.error(`${C.red}Usage: lizzart user unlock <username>${C.reset}`);
			process.exit(1);
		}
		await db.query(
			'UPDATE users SET failed_login_count = 0, locked_until = NULL, is_active = 1 WHERE username = ?',
			[username]
		);
		console.log(`${C.emerald}✔ Account @${username} unlocked and activated.${C.reset}`);
		return;
	}

	if (sub === 'delete') {
		const username = normalizeUsername(String(positional[0] || flags.username || ''));
		if (!username) {
			console.error(`${C.red}Usage: lizzart user delete <username>${C.reset}`);
			process.exit(1);
		}
		const [rows] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE username = ? LIMIT 1', [
			username
		]);
		if (rows.length === 0) {
			console.error(`${C.red}Error: User @${username} not found.${C.reset}`);
			process.exit(1);
		}
		await db.query('DELETE FROM users WHERE id = ?', [rows[0].id]);
		resetAdminExistsCache();
		console.log(`${C.emerald}✔ User @${username} deleted (all workspaces and files preserved).${C.reset}`);
		return;
	}

	printUserHelp();
}

async function cmdWorkspace(args: string[]) {
	const sub = args[0];
	if (!sub || sub === 'help' || sub === '--help' || sub === '-help') {
		printWorkspaceHelp();
		return;
	}

	await ensureDatabaseReady();
	const db = getPool();
	const { positional, flags } = parseFlags(args.slice(1));

	if (sub === 'list') {
		const list = await listAllWorkspacesAdmin();
		banner();
		console.log(`${C.bold}WORKSPACES (${list.length}):${C.reset}\n`);
		if (list.length === 0) {
			console.log(`  ${C.yellow}No workspaces created yet. Run 'lizzart workspace create --name "My Team" --quota 25'.${C.reset}\n`);
			return;
		}
		for (const w of list) {
			const status = w.is_active ? `${C.emerald}ACTIVE${C.reset}` : `${C.red}INACTIVE${C.reset}`;
			const usage = `${formatBytes(w.used_bytes)} / ${formatBytes(w.quota_bytes)}`;
			console.log(
				`  • ${C.bold}${w.name.padEnd(22)}${C.reset} (slug: ${C.cyan}${w.slug}${C.reset}) [${status}]`
			);
			console.log(
				`    ID: ${C.gray}${w.id}${C.reset} | Disk: ${C.emerald}${usage}${C.reset} | Files: ${w.file_count} | Folders: ${w.folder_count} | Members: ${w.member_count}`
			);
		}
		console.log('');
		return;
	}

	if (sub === 'create') {
		const name = String(flags.name || positional[0] || '').trim();
		const desc = flags.desc ? String(flags.desc).trim() : null;
		const color = typeof flags.color === 'string' ? flags.color : '#10b981';
		const rawQuota = String(flags.quota ?? '25').toLowerCase();
		const isUnlimited = rawQuota === 'unlimited' || rawQuota === 'inf' || rawQuota === '-1';
		const quotaGb = isUnlimited ? -1 : Math.max(10, Number(rawQuota) || 25);
		const quotaBytes = isUnlimited ? -1 : Math.round(quotaGb * 1024 * 1024 * 1024);

		if (name.length < 2) {
			console.error(`${C.red}Usage: lizzart workspace create --name <Workspace Name> [--quota <GB|unlimited>]${C.reset}`);
			process.exit(1);
		}

		const id = crypto.randomUUID();
		const slug = `${slugifyWorkspace(name)}-${id.slice(0, 6)}`;
		await db.query(
			`INSERT INTO workspaces (id, name, slug, description, color, quota_bytes, used_bytes, is_active)
			 VALUES (?, ?, ?, ?, ?, ?, 0, 1)`,
			[id, name, slug, desc, color, quotaBytes]
		);
		console.log(
			`${C.emerald}✔ Workspace "${name}" created! (Slug: ${slug}, Quota: ${formatBytes(quotaBytes)})${C.reset}`
		);
		return;
	}

	if (sub === 'update') {
		const target = String(positional[0] || flags.workspace || '');
		const ws = await findWorkspace(target);
		if (!ws) {
			console.error(`${C.red}Error: Workspace "${target}" not found.${C.reset}`);
			process.exit(1);
		}

		const name = flags.name !== undefined ? String(flags.name).trim() : String(ws.name);
		const desc = flags.desc !== undefined ? String(flags.desc).trim() : ws.description;
		const isActive =
			flags.active !== undefined ? (String(flags.active) === 'true' || flags.active === '1' ? 1 : 0) : Number(ws.is_active);

		let quotaBytes = Number(ws.quota_bytes);
		if (flags.quota !== undefined) {
			const rawQ = String(flags.quota).toLowerCase();
			if (rawQ === 'unlimited' || rawQ === 'inf' || rawQ === '-1') {
				quotaBytes = -1;
			} else {
				const gb = Math.max(10, Number(rawQ) || 10);
				quotaBytes = Math.round(gb * 1024 * 1024 * 1024);
			}
		}

		await db.query(
			'UPDATE workspaces SET name = ?, description = ?, quota_bytes = ?, is_active = ? WHERE id = ?',
			[name, desc, quotaBytes, isActive, ws.id]
		);
		console.log(
			`${C.emerald}✔ Workspace "${name}" updated (Quota: ${formatBytes(quotaBytes)}, Active: ${Boolean(isActive)}).${C.reset}`
		);
		return;
	}

	if (sub === 'members') {
		const target = String(positional[0] || flags.workspace || '');
		const ws = await findWorkspace(target);
		if (!ws) {
			console.error(`${C.red}Error: Workspace "${target}" not found.${C.reset}`);
			process.exit(1);
		}
		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT wm.role, wm.created_at, u.username, u.first_name, u.last_name, u.role AS sys_role
			 FROM workspace_members wm
			 INNER JOIN users u ON u.id = wm.user_id
			 WHERE wm.workspace_id = ?
			 ORDER BY wm.created_at ASC`,
			[ws.id]
		);
		banner();
		console.log(`${C.bold}MEMBERS OF WORKSPACE "${ws.name}" (${rows.length}):${C.reset}`);
		console.log(`Disk Usage: ${C.emerald}${formatBytes(Number(ws.used_bytes))} / ${formatBytes(Number(ws.quota_bytes))}${C.reset}\n`);
		for (const r of rows) {
			console.log(
				`  • ${C.bold}@${String(r.username).padEnd(18)}${C.reset} ${String(`${r.first_name} ${r.last_name}`).padEnd(22)} [Workspace Role: ${C.cyan}${String(r.role).toUpperCase()}${C.reset}]`
			);
		}
		console.log('');
		return;
	}

	if (sub === 'add-user') {
		const wsQuery = String(flags.workspace || positional[0] || '');
		const username = normalizeUsername(String(flags.username || positional[1] || ''));
		const role = normalizeWorkspaceRole(flags.role || 'editor');

		const ws = await findWorkspace(wsQuery);
		if (!ws) {
			console.error(`${C.red}Error: Workspace "${wsQuery}" not found.${C.reset}`);
			process.exit(1);
		}
		const [uRows] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE username = ? LIMIT 1', [
			username
		]);
		if (uRows.length === 0) {
			console.error(`${C.red}Error: User @${username} not found.${C.reset}`);
			process.exit(1);
		}

		await db.query(
			`INSERT INTO workspace_members (id, workspace_id, user_id, role)
			 VALUES (?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE role = VALUES(role)`,
			[crypto.randomUUID(), ws.id, uRows[0].id, role]
		);
		console.log(`${C.emerald}✔ User @${username} connected to workspace "${ws.name}" as '${role}'.${C.reset}`);
		return;
	}

	if (sub === 'remove-user') {
		const wsQuery = String(flags.workspace || positional[0] || '');
		const username = normalizeUsername(String(flags.username || positional[1] || ''));
		const ws = await findWorkspace(wsQuery);
		if (!ws) {
			console.error(`${C.red}Error: Workspace "${wsQuery}" not found.${C.reset}`);
			process.exit(1);
		}
		const [uRows] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE username = ? LIMIT 1', [
			username
		]);
		if (uRows.length === 0) {
			console.error(`${C.red}Error: User @${username} not found.${C.reset}`);
			process.exit(1);
		}
		await db.query('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?', [
			ws.id,
			uRows[0].id
		]);
		console.log(`${C.emerald}✔ User @${username} removed from workspace "${ws.name}".${C.reset}`);
		return;
	}

	if (sub === 'recalculate') {
		const target = String(positional[0] || flags.workspace || '');
		const ws = await findWorkspace(target);
		if (!ws) {
			console.error(`${C.red}Error: Workspace "${target}" not found.${C.reset}`);
			process.exit(1);
		}
		const used = await recalculateWorkspaceUsedBytes(String(ws.id));
		console.log(`${C.emerald}✔ Recalculated "${ws.name}" disk usage: ${formatBytes(used)}.${C.reset}`);
		return;
	}

	if (sub === 'delete') {
		const target = String(positional[0] || flags.workspace || '');
		const ws = await findWorkspace(target);
		if (!ws) {
			console.error(`${C.red}Error: Workspace "${target}" not found.${C.reset}`);
			process.exit(1);
		}
		const [files] = await db.query<RowDataPacket[]>(
			"SELECT disk_path FROM storage_nodes WHERE workspace_id = ? AND type = 'file' AND disk_path IS NOT NULL",
			[ws.id]
		);
		await db.query('DELETE FROM workspaces WHERE id = ?', [ws.id]);
		for (const f of files) {
			await deleteDiskBlobIfUnreferenced(String(f.disk_path));
		}
		console.log(`${C.emerald}✔ Workspace "${ws.name}" and its ${files.length} file(s) permanently deleted.${C.reset}`);
		return;
	}

	printWorkspaceHelp();
}

async function cmdPerformance(args: string[]) {
	await ensureDatabaseReady();
	const db = getPool();
	const sub = args[0];

	if (sub === 'set' && args[1]) {
		const nextMode = args[1];
		if (!isValidPerformanceMode(nextMode)) {
			console.error(
				`${C.red}Error: Invalid profile "${nextMode}". Valid options: legacy_mobile, ultra_optimized, optimized, fast, ultra_fast.${C.reset}`
			);
			process.exit(1);
		}
		await db.query(
			"INSERT INTO system_settings (setting_key, setting_value) VALUES ('performance_mode', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
			[nextMode]
		);
		setActivePerformanceMode(nextMode);
		await applyPoolPerformanceLimits();
		console.log(`${C.emerald}✔ Active performance profile switched to '${nextMode}'!${C.reset}`);
		return;
	}

	banner();
	const current = getActivePerformanceMode();
	const profiles = listPerformanceProfiles();
	console.log(`${C.bold}HARDWARE PERFORMANCE PROFILES (Current: ${C.emerald}${current}${C.reset}${C.bold}):${C.reset}\n`);
	for (const p of profiles) {
		const mark = p.mode === current ? `${C.emerald}● ACTIVE${C.reset}` : `${C.gray}○${C.reset}`;
		console.log(`  ${mark} ${C.bold}${p.mode.padEnd(18)}${C.reset} — ${C.cyan}${p.label}${C.reset}`);
		console.log(
			`     DB Pool: ${p.dbConnectionLimit} conns | Stream Chunk: ${p.streamHighWaterMarkKb} KB | Parallel I/O: ${p.maxConcurrentIo} | Argon2: ${p.argon2MemoryMb} MiB`
		);
	}
	console.log(`\n${C.bold}SWITCH PROFILE:${C.reset} lizzart performance set <legacy_mobile|ultra_optimized|optimized|fast|ultra_fast>\n`);
}

async function cmdBackup(args: string[]) {
	await ensureDatabaseReady();
	const sub = args[0] || 'list';

	if (sub === 'create') {
		const bk = await createDatabaseBackup({ compress: true, prefix: 'cli-backup' });
		console.log(
			`${C.emerald}✔ Database backup created: ${bk.file_name} (${formatBytes(bk.size_bytes)}, SHA-256: ${bk.sha256.slice(0, 16)}...)${C.reset}`
		);
		return;
	}

	if (sub === 'delete' && args[1]) {
		const ok = await deleteDatabaseBackup(args[1]);
		if (!ok) {
			console.error(`${C.red}Error: Backup ID "${args[1]}" not found.${C.reset}`);
			process.exit(1);
		}
		console.log(`${C.emerald}✔ Backup deleted.${C.reset}`);
		return;
	}

	const list = await listDatabaseBackups();
	banner();
	console.log(`${C.bold}DATABASE BACKUPS (${list.length}):${C.reset}\n`);
	for (const b of list) {
		console.log(
			`  • ${C.bold}${b.id}${C.reset} | ${C.cyan}${b.file_name}${C.reset} | ${formatBytes(b.size_bytes)} | ${b.created_at}`
		);
	}
	console.log(`\n${C.bold}COMMANDS:${C.reset} lizzart backup list | lizzart backup create | lizzart backup delete <id>\n`);
}

async function main() {
	const args = process.argv.slice(2);
	const cmd = args[0];

	try {
		if (!cmd || cmd === '-help' || cmd === '--help' || cmd === '-h' || cmd === 'help') {
			printMainHelp();
		} else if (cmd === 'status') {
			await cmdStatus();
		} else if (cmd === 'user' || cmd === 'users') {
			await cmdUser(args.slice(1));
		} else if (cmd === 'workspace' || cmd === 'workspaces' || cmd === 'ws') {
			await cmdWorkspace(args.slice(1));
		} else if (cmd === 'performance' || cmd === 'perf') {
			await cmdPerformance(args.slice(1));
		} else if (cmd === 'backup' || cmd === 'backups') {
			await cmdBackup(args.slice(1));
		} else {
			console.error(`${C.red}Unknown command: "${cmd}"${C.reset}`);
			printMainHelp();
			process.exit(1);
		}
	} finally {
		const pool = getPool();
		await pool.end().catch(() => {});
	}
}

main().catch((err) => {
	console.error(`${C.red}CLI Fatal Error:${C.reset}`, err instanceof Error ? err.message : err);
	process.exit(1);
});
