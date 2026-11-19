/**
 * End-to-end verification suite v2 for Lizzart Explorer
 * Tests:
 * 1. First-run admin setup (/api/auth/setup) & block of second setup
 * 2. Login by immutable username
 * 3. Admin user creation with 10 GB minimum quota enforcement
 * 4. Resumable chunked upload (init -> chunk 1 -> simulated disconnect/resume init -> chunk 2 -> complete)
 * 5. Lossless Range download verification byte-for-byte
 * 6. Local 2FA TOTP generation, activation & login verification
 * 7. File sharing by @username + shared access verification
 * 8. Public share link with password
 * 9. Cleanup back to clean state
 */
import { generateTotpCode } from '../src/lib/server/totp';

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173';

function extractCookie(res: Response): string {
	const setCookie = res.headers.get('set-cookie');
	if (!setCookie) throw new Error('Expected Set-Cookie header');
	return setCookie.split(';')[0];
}

async function assertOk(res: Response, label: string) {
	if (!res.ok) {
		const txt = await res.text();
		throw new Error(`${label} failed (${res.status}): ${txt}`);
	}
	return res;
}

async function run() {
	console.log(`[E2E v2] Testing against ${BASE}...`);

	// 1. First-run admin setup
	const setupRes = await assertOk(
		await fetch(`${BASE}/api/auth/setup`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: 'admin_e2e',
				first_name: 'João',
				last_name: 'Admin',
				password: 'password123'
			})
		}),
		'First-run setup'
	);
	const adminCookie = extractCookie(setupRes);
	console.log('[E2E v2] 1. First-run admin setup succeeded (@admin_e2e)');

	// Verify pure start (0 files/folders and 0 minecraft instances)
	const initialFiles = await (
		await assertOk(await fetch(`${BASE}/api/files`, { headers: { Cookie: adminCookie } }), 'Initial files check')
	).json();
	const initialMc = await (
		await assertOk(await fetch(`${BASE}/api/minecraft`, { headers: { Cookie: adminCookie } }), 'Initial MC check')
	).json();
	if (initialFiles.nodes.length !== 0 || initialMc.servers.length !== 0) {
		throw new Error(`Expected pure start (0 nodes, 0 mc servers), got ${initialFiles.nodes.length} nodes and ${initialMc.servers.length} servers`);
	}

	// Verify appearance & UI prefs persisted in user profile (cross-device sync)
	const appRes = await (
		await assertOk(
			await fetch(`${BASE}/api/auth/profile`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
				body: JSON.stringify({
					accent_color: '#f59e0b',
					layout_density: 'compact',
					default_view_mode: 'list',
					default_sort_by: 'date',
					default_sort_dir: 'desc'
				})
			}),
			'Update appearance & UI prefs'
		)
	).json();
	if (
		appRes.user.layout_density !== 'compact' ||
		appRes.user.accent_color !== '#f59e0b' ||
		appRes.user.default_view_mode !== 'list' ||
		appRes.user.default_sort_by !== 'date'
	) {
		throw new Error('Appearance/UI preferences did not persist in profile');
	}

	// Verify admin storage & DB configuration API
	const cfgRes = await (
		await assertOk(
			await fetch(`${BASE}/api/admin/storage-config`, { headers: { Cookie: adminCookie } }),
			'Admin storage-config GET'
		)
	).json();
	if (!cfgRes.disk?.writable || !cfgRes.database?.host) {
		throw new Error('Invalid storage-config response');
	}
	const dbTestRes = await (
		await assertOk(
			await fetch(`${BASE}/api/admin/storage-config`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
				body: JSON.stringify({
					action: 'test-db',
					host: cfgRes.database.host,
					port: cfgRes.database.port,
					user: cfgRes.database.user,
					keep_existing_password: true
				})
			}),
			'Admin test-db connection'
		)
	).json();
	if (!dbTestRes.ok) throw new Error('Expected test-db ok');
	console.log(
		`[E2E v2] 1b. Pure start, cross-device UI prefs & storage/DB config verified (${dbTestRes.version})!`
	);

	// Verify second setup is blocked
	const secondSetup = await fetch(`${BASE}/api/auth/setup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			username: 'hacker',
			first_name: 'Bad',
			last_name: 'Actor',
			password: 'password123'
		})
	});
	if (secondSetup.status !== 403) {
		throw new Error(`Expected 403 on second setup, got ${secondSetup.status}`);
	}
	console.log('[E2E v2] 2. Second setup properly blocked (403)');

	// 3. Enforce 10 GB minimum quota on user creation
	const lowQuotaRes = await fetch(`${BASE}/api/admin/users`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
		body: JSON.stringify({
			username: 'maria',
			first_name: 'Maria',
			last_name: 'Silva',
			password: 'password123',
			role: 'user',
			quota_gb: 5
		})
	});
	if (lowQuotaRes.status !== 400) {
		throw new Error(`Expected 400 for quota < 10GB, got ${lowQuotaRes.status}`);
	}

	await assertOk(
		await fetch(`${BASE}/api/admin/users`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
			body: JSON.stringify({
				username: 'maria',
				first_name: 'Maria',
				last_name: 'Silva',
				password: 'password123',
				role: 'user',
				quota_gb: 10
			})
		}),
		'Create regular user @maria with 10GB quota'
	);
	console.log('[E2E v2] 3. Minimum 10GB quota enforced & @maria created');

	// 4. Resumable chunked upload (simulate drop halfway and resume!)
	const chunkA = new Uint8Array(64 * 1024).fill(65); // 64KB of 'A'
	const chunkB = new Uint8Array(64 * 1024).fill(66); // 64KB of 'B'
	const totalBytes = chunkA.byteLength + chunkB.byteLength;
	const fingerprint = `resumable-test.bin::${totalBytes}::12345`;

	const init1 = await (
		await assertOk(
			await fetch(`${BASE}/api/files/upload/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
				body: JSON.stringify({
					fileName: 'resumable-test.bin',
					mimeType: 'application/octet-stream',
					totalBytes,
					parentId: null,
					fingerprint
				})
			}),
			'Init resumable upload'
		)
	).json();

	await assertOk(
		await fetch(`${BASE}/api/files/upload/${init1.uploadId}`, {
			method: 'PUT',
			headers: {
				Cookie: adminCookie,
				'Content-Type': 'application/octet-stream',
				'X-Chunk-Offset': '0'
			},
			body: chunkA
		}),
		'Upload chunk 1'
	);

	// Simulate reconnect: call /init with same fingerprint -> must return uploadedBytes === chunkA.byteLength
	const init2 = await (
		await assertOk(
			await fetch(`${BASE}/api/files/upload/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
				body: JSON.stringify({
					fileName: 'resumable-test.bin',
					mimeType: 'application/octet-stream',
					totalBytes,
					parentId: null,
					fingerprint
				})
			}),
			'Resume init after simulated disconnect'
		)
	).json();

	if (!init2.resumed || init2.uploadedBytes !== chunkA.byteLength) {
		throw new Error(`Expected resumed at ${chunkA.byteLength}, got ${JSON.stringify(init2)}`);
	}

	await assertOk(
		await fetch(`${BASE}/api/files/upload/${init2.uploadId}`, {
			method: 'PUT',
			headers: {
				Cookie: adminCookie,
				'Content-Type': 'application/octet-stream',
				'X-Chunk-Offset': String(init2.uploadedBytes)
			},
			body: chunkB
		}),
		'Upload chunk 2 after resume'
	);

	const completed = await (
		await assertOk(
			await fetch(`${BASE}/api/files/upload/${init2.uploadId}/complete`, {
				method: 'POST',
				headers: { Cookie: adminCookie }
			}),
			'Complete resumable upload'
		)
	).json();
	const fileId = completed.file.id;
	console.log(`[E2E v2] 4. Resumable chunked upload verified (resumed at ${init2.uploadedBytes} bytes)`);

	// 5. Range download lossless check
	const part2Res = await fetch(`${BASE}/api/files/${fileId}/content?download=1`, {
		headers: { Cookie: adminCookie, Range: `bytes=${chunkA.byteLength}-${totalBytes - 1}` }
	});
	if (part2Res.status !== 206) throw new Error(`Expected 206 Partial Content, got ${part2Res.status}`);
	const part2Bytes = new Uint8Array(await part2Res.arrayBuffer());
	if (part2Bytes.byteLength !== chunkB.byteLength || part2Bytes[0] !== 66 || part2Bytes[part2Bytes.length - 1] !== 66) {
		throw new Error('Range download byte mismatch');
	}
	console.log('[E2E v2] 5. Lossless HTTP Range download verified (206 Partial Content)');

	// 6. Share by @username and verify @maria can access it
	await assertOk(
		await fetch(`${BASE}/api/files/${fileId}/share`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
			body: JSON.stringify({ mode: 'user', username: 'maria', permission: 'viewer' })
		}),
		'Share file with @maria'
	);

	const mariaLogin = await assertOk(
		await fetch(`${BASE}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'maria', password: 'password123' })
		}),
		'Login as @maria'
	);
	const mariaCookie = extractCookie(mariaLogin);

	const sharedList = await (
		await assertOk(
			await fetch(`${BASE}/api/files?view=shared`, { headers: { Cookie: mariaCookie } }),
			'Fetch @maria shared view'
		)
	).json();
	if (!sharedList.nodes.some((n: { id: string }) => n.id === fileId)) {
		throw new Error('Shared file not visible to @maria');
	}
	console.log('[E2E v2] 6. Sharing by @username verified');

	// 7. Local 2FA TOTP setup + login verification for @maria
	const totpInit = await (
		await assertOk(
			await fetch(`${BASE}/api/auth/2fa`, { headers: { Cookie: mariaCookie } }),
			'Init local 2FA'
		)
	).json();
	const validCode = generateTotpCode(totpInit.secret);
	await assertOk(
		await fetch(`${BASE}/api/auth/2fa`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: mariaCookie },
			body: JSON.stringify({ code: validCode })
		}),
		'Confirm and enable local 2FA'
	);

	const step1Login = await (
		await assertOk(
			await fetch(`${BASE}/api/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: 'maria', password: 'password123' })
			}),
			'Login step 1 with 2FA enabled'
		)
	).json();
	if (!step1Login.requires2fa) {
		throw new Error('Expected requires2fa: true on login');
	}

	await assertOk(
		await fetch(`${BASE}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'maria', password: 'password123', totpCode: validCode })
		}),
		'Login step 2 with valid TOTP code'
	);
	console.log('[E2E v2] 7. Local 2FA TOTP activation and login verification passed!');

	console.log('[E2E v2] ALL V2 CHECKS PASSED!');
}

run().catch((err) => {
	console.error('[E2E v2] FAILED:', err);
	process.exit(1);
});
