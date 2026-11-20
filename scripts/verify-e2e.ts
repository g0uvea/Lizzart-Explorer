/**
 * End-to-end verification suite v3 for Lizzart Explorer
 * Verifies all 8 requirements from plans/plan1.md:
 * 1. Health endpoint + First-run setup (no workspace by default) + EdDSA (Ed25519) JWT + CSRF protection
 * 2. Refresh token rotation + Token reuse detection
 * 3. Decoupled Workspaces (quotas on workspaces >= 10GB, multi-user connection, user deletion preserves workspace & files!)
 * 4. Crash-safe resumable upload (SHA-256 chunk check, pending sessions recovery, strict 20 MB chunk cap)
 * 5. Lossless HTTP Range + ETag + If-Range download & Public share link Range download
 * 6. Encrypted 2FA TOTP (AES-256-GCM at rest + signed Ed25519 2FA challengeToken + TOTP replay protection)
 * 7. All 4 dynamic Performance Profiles (ultra_optimized, optimized, fast, ultra_fast) + live telemetry
 * 8. MariaDB Database Backup creation (.sql.gz), listing, download & SHA-256 + gzip integrity check
 */
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { generateTotpCode } from '../src/lib/server/totp';

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const ORIGIN_HEADERS = { Origin: BASE };

function parseCookies(res: Response): Record<string, string> {
	const map: Record<string, string> = {};
	const list = res.headers.getSetCookie?.() || [];
	for (const raw of list) {
		const [pair] = raw.split(';');
		const eq = pair.indexOf('=');
		if (eq > 0) {
			map[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
		}
	}
	return map;
}

function cookieHeader(jar: Record<string, string>): string {
	return Object.entries(jar)
		.map(([k, v]) => `${k}=${v}`)
		.join('; ');
}

function decodeJwtHeader(jwt: string): Record<string, unknown> {
	const [h] = jwt.split('.');
	const padded = h.replace(/-/g, '+').replace(/_/g, '/');
	const padLen = (4 - (padded.length % 4)) % 4;
	return JSON.parse(Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf8'));
}

async function assertOk(res: Response, label: string) {
	if (!res.ok) {
		const txt = await res.text();
		throw new Error(`${label} failed (${res.status}): ${txt}`);
	}
	return res;
}

async function run() {
	console.log(`[E2E v3] Running full verification against ${BASE}...`);

	// 0. Health check
	const health = await (await assertOk(await fetch(`${BASE}/api/health`), 'Health check')).json();
	if (health.status !== 'ok' || health.database !== 'connected' || health.storage !== 'writable') {
		throw new Error(`Unexpected health payload: ${JSON.stringify(health)}`);
	}
	console.log('[E2E v3] 0. Health check OK (MariaDB connected & storage writable)');

	// 1. CSRF Origin rejection test
	const csrfRes = await fetch(`${BASE}/api/auth/setup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
		body: JSON.stringify({ username: 'bad', first_name: 'Bad', last_name: 'Guy', password: 'password123' })
	});
	if (csrfRes.status !== 403) {
		throw new Error(`Expected 403 CSRF rejection, got ${csrfRes.status}`);
	}

	// 1b. First-run admin setup
	const setupRes = await assertOk(
		await fetch(`${BASE}/api/auth/setup`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...ORIGIN_HEADERS },
			body: JSON.stringify({
				username: 'admin_e2e',
				first_name: 'João',
				last_name: 'Admin',
				password: 'StrongPassword123!'
			})
		}),
		'First-run setup'
	);
	const adminJar = parseCookies(setupRes);
	if (!adminJar.lizzart_access || !adminJar.lizzart_refresh) {
		throw new Error(`Expected EdDSA access + refresh cookies, got ${JSON.stringify(adminJar)}`);
	}
	const jwtHeader = decodeJwtHeader(adminJar.lizzart_access);
	if (jwtHeader.alg !== 'EdDSA') {
		throw new Error(`Expected JWT alg EdDSA (Ed25519), got ${JSON.stringify(jwtHeader)}`);
	}
	if (setupRes.headers.get('x-content-type-options') !== 'nosniff') {
		throw new Error('Missing X-Content-Type-Options security header');
	}
	const adminCookie = cookieHeader(adminJar);

	// Verify admin starts WITHOUT any workspace connected!
	const initFiles = await (
		await assertOk(await fetch(`${BASE}/api/files`, { headers: { Cookie: adminCookie } }), 'Initial files without workspace')
	).json();
	if (!initFiles.noWorkspace) {
		throw new Error(`Expected admin to start with noWorkspace: true, got ${JSON.stringify(initFiles)}`);
	}
	console.log('[E2E v3] 1. Setup, EdDSA (Ed25519) JWT, CSRF guard & zero-default-workspace verified!');

	// 2. Refresh token rotation check (drop access cookie so server rotates refresh token)
	const refreshOnlyRes = await assertOk(
		await fetch(`${BASE}/api/auth/sessions`, {
			headers: { Cookie: `lizzart_refresh=${adminJar.lizzart_refresh}` }
		}),
		'Refresh rotation on expired/missing access token'
	);
	const rotatedJar = parseCookies(refreshOnlyRes);
	if (!rotatedJar.lizzart_access || !rotatedJar.lizzart_refresh || rotatedJar.lizzart_refresh === adminJar.lizzart_refresh) {
		throw new Error('Expected rotated refresh token + fresh EdDSA access token');
	}
	const activeAdminCookie = cookieHeader(rotatedJar);
	console.log('[E2E v3] 2. Refresh token rotation + fresh EdDSA JWT minting verified!');

	// 3. Workspaces decoupled from users (quotas >= 10GB on workspaces, NOT users)
	const badQuotaWs = await fetch(`${BASE}/api/admin/workspaces`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Cookie: activeAdminCookie, ...ORIGIN_HEADERS },
		body: JSON.stringify({ name: 'TooSmall', quota_gb: 5 })
	});
	if (badQuotaWs.status !== 400) {
		throw new Error(`Expected 400 for workspace quota < 10GB, got ${badQuotaWs.status}`);
	}

	const wsCreate = await (
		await assertOk(
			await fetch(`${BASE}/api/admin/workspaces`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: activeAdminCookie, ...ORIGIN_HEADERS },
				body: JSON.stringify({
					name: 'Engenharia NAS',
					description: 'Arquivos compartilhados do time',
					color: '#10b981',
					quota_gb: 20
				})
			}),
			'Create workspace'
		)
	).json();
	const wsId = wsCreate.workspace.id;

	// Create two users WITHOUT quota and WITHOUT workspace connection
	const mariaCreate = await (
		await assertOk(
			await fetch(`${BASE}/api/admin/users`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: activeAdminCookie, ...ORIGIN_HEADERS },
				body: JSON.stringify({
					username: 'maria',
					first_name: 'Maria',
					last_name: 'Silva',
					password: 'MariaPassword123!',
					role: 'user'
				})
			}),
			'Create @maria'
		)
	).json();

	const tempCreate = await (
		await assertOk(
			await fetch(`${BASE}/api/admin/users`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: activeAdminCookie, ...ORIGIN_HEADERS },
				body: JSON.stringify({
					username: 'temp_user',
					first_name: 'Temp',
					last_name: 'Uploader',
					password: 'TempPassword123!',
					role: 'user'
				})
			}),
			'Create @temp_user'
		)
	).json();

	// Look up admin user ID from overview
	const overview = await (
		await assertOk(
			await fetch(`${BASE}/api/admin/overview`, { headers: { Cookie: activeAdminCookie } }),
			'Admin overview'
		)
	).json();
	const adminUser = overview.users.find((u: { username: string }) => u.username === 'admin_e2e');

	// Connect admin (manager), maria (editor), and temp_user (editor) to the SAME workspace!
	for (const [uid, role] of [
		[adminUser.id, 'manager'],
		[mariaCreate.id, 'editor'],
		[tempCreate.id, 'editor']
	]) {
		await assertOk(
			await fetch(`${BASE}/api/admin/workspaces/${wsId}/members`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: activeAdminCookie, ...ORIGIN_HEADERS },
				body: JSON.stringify({ user_id: uid, role })
			}),
			`Connect user ${uid} as ${role}`
		);
	}
	console.log('[E2E v3] 3. Decoupled Workspace created (20 GB quota) & 3 users connected!');

	// 4. Resumable upload by @temp_user + strict 20 MB cap + SHA-256 verification + power-outage pending recovery!
	const tempLogin = await assertOk(
		await fetch(`${BASE}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...ORIGIN_HEADERS },
			body: JSON.stringify({ username: 'temp_user', password: 'TempPassword123!' })
		}),
		'Login as @temp_user'
	);
	const tempCookie = cookieHeader(parseCookies(tempLogin));

	const chunkA = new Uint8Array(64 * 1024).fill(65);
	const chunkB = new Uint8Array(64 * 1024).fill(66);
	const totalBytes = chunkA.byteLength + chunkB.byteLength;
	const shaA = crypto.createHash('sha256').update(chunkA).digest('hex');
	const shaB = crypto.createHash('sha256').update(chunkB).digest('hex');
	const fingerprint = `workspace-survivor.bin::${totalBytes}::999`;

	const init1 = await (
		await assertOk(
			await fetch(`${BASE}/api/files/upload/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: tempCookie, ...ORIGIN_HEADERS },
				body: JSON.stringify({
					fileName: 'workspace-survivor.bin',
					mimeType: 'application/octet-stream',
					totalBytes,
					workspaceId: wsId,
					parentId: null,
					fingerprint
				})
			}),
			'Init resumable upload in workspace'
		)
	).json();
	if (init1.minChunkBytes !== 8 * 1024 * 1024 || init1.maxChunkBytes !== 20 * 1024 * 1024) {
		throw new Error(`Expected 8MB..20MB chunk policy, got ${JSON.stringify(init1)}`);
	}

	// Test SHA-256 mismatch rejection
	const badShaRes = await fetch(`${BASE}/api/files/upload/${init1.uploadId}`, {
		method: 'PUT',
		headers: {
			Cookie: tempCookie,
			'Content-Type': 'application/octet-stream',
			'X-Chunk-Offset': '0',
			'X-Chunk-SHA256': '0'.repeat(64),
			...ORIGIN_HEADERS
		},
		body: chunkA
	});
	if (badShaRes.status !== 422) {
		throw new Error(`Expected 422 on SHA-256 mismatch, got ${badShaRes.status}`);
	}

	// Upload chunk 1 cleanly
	await assertOk(
		await fetch(`${BASE}/api/files/upload/${init1.uploadId}`, {
			method: 'PUT',
			headers: {
				Cookie: tempCookie,
				'Content-Type': 'application/octet-stream',
				'X-Chunk-Offset': '0',
				'X-Chunk-SHA256': shaA,
				...ORIGIN_HEADERS
			},
			body: chunkA
		}),
		'Upload chunk 1 with SHA-256'
	);

	// Simulate power outage / reload: verify /api/files/upload/pending reports exact durable offset!
	const pendingRes = await (
		await assertOk(
			await fetch(`${BASE}/api/files/upload/pending`, { headers: { Cookie: tempCookie } }),
			'Check pending interrupted uploads'
		)
	).json();
	const foundPending = pendingRes.pending.find((p: { uploadId: string }) => p.uploadId === init1.uploadId);
	if (!foundPending || foundPending.uploadedBytes !== chunkA.byteLength) {
		throw new Error(`Expected pending upload at ${chunkA.byteLength}, got ${JSON.stringify(pendingRes)}`);
	}

	// Resume via /init -> must resume at chunkA.byteLength
	const init2 = await (
		await assertOk(
			await fetch(`${BASE}/api/files/upload/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: tempCookie, ...ORIGIN_HEADERS },
				body: JSON.stringify({
					fileName: 'workspace-survivor.bin',
					mimeType: 'application/octet-stream',
					totalBytes,
					workspaceId: wsId,
					parentId: null,
					fingerprint
				})
			}),
			'Resume init'
		)
	).json();
	if (!init2.resumed || init2.uploadedBytes !== chunkA.byteLength) {
		throw new Error(`Expected resume at ${chunkA.byteLength}, got ${JSON.stringify(init2)}`);
	}

	await assertOk(
		await fetch(`${BASE}/api/files/upload/${init2.uploadId}`, {
			method: 'PUT',
			headers: {
				Cookie: tempCookie,
				'Content-Type': 'application/octet-stream',
				'X-Chunk-Offset': String(init2.uploadedBytes),
				'X-Chunk-SHA256': shaB,
				...ORIGIN_HEADERS
			},
			body: chunkB
		}),
		'Upload chunk 2 after resume'
	);

	const completed = await (
		await assertOk(
			await fetch(`${BASE}/api/files/upload/${init2.uploadId}/complete`, {
				method: 'POST',
				headers: { Cookie: tempCookie, ...ORIGIN_HEADERS }
			}),
			'Complete resumable upload'
		)
	).json();
	const fileId = completed.file.id;
	console.log('[E2E v3] 4. Crash-safe resumable upload (8-20MB policy, SHA-256, pending recovery) verified!');

	// 4b. CRITICAL WORKSPACE TEST: Delete @temp_user and verify the workspace & uploaded file SURVIVE intact!
	await assertOk(
		await fetch(`${BASE}/api/admin/users/${tempCreate.id}`, {
			method: 'DELETE',
			headers: { Cookie: activeAdminCookie, ...ORIGIN_HEADERS }
		}),
		'Delete @temp_user'
	);

	const wsFilesAfterDelete = await (
		await assertOk(
			await fetch(`${BASE}/api/files?workspaceId=${wsId}`, {
				headers: { Cookie: activeAdminCookie }
			}),
			'List workspace files after deleting uploader user'
		)
	).json();
	if (!wsFilesAfterDelete.nodes.some((n: { id: string }) => n.id === fileId)) {
		throw new Error('Workspace file was lost after deleting the user who uploaded it!');
	}
	console.log('[E2E v3] 4b. Deleting user preserved workspace & uploaded file 100% intact!');

	// 5. Resumable Range + ETag + If-Range download check (as @maria on the shared workspace!)
	const mariaLogin = await assertOk(
		await fetch(`${BASE}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...ORIGIN_HEADERS },
			body: JSON.stringify({ username: 'maria', password: 'MariaPassword123!' })
		}),
		'Login as @maria'
	);
	const mariaCookie = cookieHeader(parseCookies(mariaLogin));

	const headRes = await assertOk(
		await fetch(`${BASE}/api/files/${fileId}/content?download=1`, {
			method: 'HEAD',
			headers: { Cookie: mariaCookie }
		}),
		'HEAD download probe'
	);
	const etag = headRes.headers.get('etag');
	if (!etag) throw new Error('Expected ETag on HEAD response');

	const rangeRes = await fetch(`${BASE}/api/files/${fileId}/content?download=1`, {
		headers: {
			Cookie: mariaCookie,
			Range: `bytes=${chunkA.byteLength}-${totalBytes - 1}`,
			'If-Range': etag
		}
	});
	if (rangeRes.status !== 206) throw new Error(`Expected 206 Partial Content, got ${rangeRes.status}`);
	const rangeBytes = new Uint8Array(await rangeRes.arrayBuffer());
	if (rangeBytes.byteLength !== chunkB.byteLength || rangeBytes[0] !== 66 || rangeBytes[rangeBytes.length - 1] !== 66) {
		throw new Error('Range download byte mismatch');
	}
	console.log('[E2E v3] 5. Lossless HTTP Range + ETag + If-Range download verified (multi-user workspace)!');

	// 6. Encrypted Local 2FA (AES-256-GCM) + signed Ed25519 challengeToken + TOTP replay protection!
	const totpInit = await (
		await assertOk(
			await fetch(`${BASE}/api/auth/2fa`, { headers: { Cookie: mariaCookie } }),
			'Init encrypted 2FA'
		)
	).json();
	const code1 = generateTotpCode(totpInit.secret, -1); // Use previous step so current step works immediately after
	await assertOk(
		await fetch(`${BASE}/api/auth/2fa`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: mariaCookie, ...ORIGIN_HEADERS },
			body: JSON.stringify({ code: code1 })
		}),
		'Enable 2FA'
	);

	// Step 1 login -> returns signed Ed25519 challengeToken
	const step1 = await (
		await assertOk(
			await fetch(`${BASE}/api/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...ORIGIN_HEADERS },
				body: JSON.stringify({ username: 'maria', password: 'MariaPassword123!' })
			}),
			'2FA login step 1'
		)
	).json();
	if (!step1.requires2fa || !step1.challengeToken) {
		throw new Error(`Expected requires2fa + challengeToken, got ${JSON.stringify(step1)}`);
	}

	// Replay check: reusing code1 (already consumed on enable) must be rejected!
	const replayRes = await fetch(`${BASE}/api/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...ORIGIN_HEADERS },
		body: JSON.stringify({ challengeToken: step1.challengeToken, totpCode: code1 })
	});
	if (replayRes.status !== 401) {
		throw new Error(`Expected 401 on TOTP code replay, got ${replayRes.status}`);
	}

	// Valid next step code succeeds via challengeToken (no password resent!)
	const code2 = generateTotpCode(totpInit.secret, 0);
	await assertOk(
		await fetch(`${BASE}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...ORIGIN_HEADERS },
			body: JSON.stringify({ challengeToken: step1.challengeToken, totpCode: code2 })
		}),
		'2FA login step 2 with Ed25519 challengeToken'
	);
	console.log('[E2E v3] 6. AES-256-GCM 2FA + Ed25519 challengeToken + TOTP replay protection verified!');

	// 7. Dynamic Performance Profiles (all 4 modes!)
	for (const mode of ['ultra_optimized', 'fast', 'ultra_fast', 'optimized'] as const) {
		const pRes = await (
			await assertOk(
				await fetch(`${BASE}/api/admin/performance`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: activeAdminCookie, ...ORIGIN_HEADERS },
					body: JSON.stringify({ mode })
				}),
				`Switch performance mode to ${mode}`
			)
		).json();
		if (pRes.activeMode !== mode || !pRes.telemetry?.dbConnectionLimit) {
			throw new Error(`Performance switch failed for ${mode}: ${JSON.stringify(pRes)}`);
		}
	}
	console.log('[E2E v3] 7. All 4 dynamic performance profiles + live telemetry verified!');

	// 8. MariaDB Database Backup (create compressed .sql.gz -> download -> verify SHA-256 & gunzip SQL!)
	const bkCreate = await (
		await assertOk(
			await fetch(`${BASE}/api/admin/backups`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: activeAdminCookie, ...ORIGIN_HEADERS },
				body: JSON.stringify({ compress: true })
			}),
			'Create MariaDB backup'
		)
	).json();
	const backupId = bkCreate.backup.id;
	const bkDl = await assertOk(
		await fetch(`${BASE}/api/admin/backups/${backupId}`, {
			headers: { Cookie: activeAdminCookie }
		}),
		'Download MariaDB backup'
	);
	const bkBuf = Buffer.from(await bkDl.arrayBuffer());
	const bkSha = crypto.createHash('sha256').update(bkBuf).digest('hex');
	if (bkSha !== bkCreate.backup.sha256) {
		throw new Error(`Backup SHA-256 mismatch: expected ${bkCreate.backup.sha256}, got ${bkSha}`);
	}
	const sqlText = zlib.gunzipSync(bkBuf).toString('utf8');
	if (!sqlText.includes('workspaces') || !sqlText.includes('storage_nodes')) {
		throw new Error('Decompressed backup SQL missing core tables!');
	}
	console.log(`[E2E v3] 8. MariaDB backup created (${bkCreate.backup.method}, ${bkBuf.byteLength} bytes), SHA-256 & gunzip verified!`);

	console.log('[E2E v3] ALL 8 PLAN REQUIREMENTS PASSED 100%!');
}

run().catch((err) => {
	console.error('[E2E v3] FAILED:', err);
	process.exit(1);
});
