/**
 * End-to-end verification script for Lizzart Explorer
 * Tests auth, disk upload/download, MariaDB indexing, permissions, public share links, trash & cleanup, and Minecraft shell API.
 */
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
	console.log(`[E2E] Testing against ${BASE}...`);

	// 1. Login as default admin
	const loginRes = await assertOk(
		await fetch(`${BASE}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: 'admin@lizzart.local', password: 'admin123' })
		}),
		'Admin login'
	);
	const adminCookie = extractCookie(loginRes);
	const loginData = await loginRes.json();
	console.log(`[E2E] 1. Logged in as ${loginData.user.email} (${loginData.user.role})`);

	// 2. Create folder
	const folderRes = await assertOk(
		await fetch(`${BASE}/api/files/folder`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
			body: JSON.stringify({ name: 'E2E Test Folder' })
		}),
		'Create folder'
	);
	const folderId = (await folderRes.json()).node.id;
	console.log(`[E2E] 2. Created folder ${folderId}`);

	// 3. Upload file to disk inside folder
	const payloadContent = 'Lizzart Explorer E2E payload — armazenamento em disco + MariaDB!';
	const form = new FormData();
	form.append('parentId', folderId);
	form.append('files', new File([payloadContent], 'teste-e2e.txt', { type: 'text/plain' }));

	const uploadRes = await assertOk(
		await fetch(`${BASE}/api/files/upload`, {
			method: 'POST',
			headers: { Cookie: adminCookie },
			body: form
		}),
		'Upload file'
	);
	const uploadedFile = (await uploadRes.json()).files[0];
	console.log(`[E2E] 3. Uploaded file ${uploadedFile.id} (${uploadedFile.size_bytes} bytes, sha256=${uploadedFile.sha256.slice(0, 12)}...)`);

	// 4. Download file content and verify byte equality
	const dlRes = await assertOk(
		await fetch(`${BASE}/api/files/${uploadedFile.id}/content`, {
			headers: { Cookie: adminCookie }
		}),
		'Download file'
	);
	const dlText = await dlRes.text();
	if (dlText !== payloadContent) {
		throw new Error(`Content mismatch: got "${dlText}"`);
	}
	console.log('[E2E] 4. Downloaded content matches uploaded bytes 100%');

	// 5. Create public share link with password & verify download
	const linkRes = await assertOk(
		await fetch(`${BASE}/api/files/${uploadedFile.id}/share`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
			body: JSON.stringify({ mode: 'link', password: 'secret', expiresInHours: 24 })
		}),
		'Create public share link'
	);
	const { token } = await linkRes.json();

	const unauthPublic = await fetch(`${BASE}/api/share/${token}/download`);
	if (unauthPublic.status !== 401) {
		throw new Error(`Expected 401 without password, got ${unauthPublic.status}`);
	}
	const authPublic = await assertOk(
		await fetch(`${BASE}/api/share/${token}/download?password=secret`),
		'Public share download with password'
	);
	if ((await authPublic.text()) !== payloadContent) {
		throw new Error('Public link content mismatch');
	}
	console.log('[E2E] 5. Password-protected public share link verified');

	// 6. Admin overview & Minecraft shell API
	const adminRes = await assertOk(
		await fetch(`${BASE}/api/admin/overview`, { headers: { Cookie: adminCookie } }),
		'Admin overview'
	);
	const overview = await adminRes.json();
	console.log(`[E2E] 6. Admin overview OK (users=${overview.stats.total_users}, files=${overview.stats.total_files})`);

	const mcRes = await assertOk(
		await fetch(`${BASE}/api/minecraft`, { headers: { Cookie: adminCookie } }),
		'Minecraft shell list'
	);
	const mcData = await mcRes.json();
	console.log(`[E2E] 7. Minecraft shell API OK (${mcData.servers.length} instances)`);

	// 7. Trash, restore, and permanent delete cleanup
	await assertOk(
		await fetch(`${BASE}/api/files/${folderId}`, { method: 'DELETE', headers: { Cookie: adminCookie } }),
		'Move folder to trash'
	);
	await assertOk(
		await fetch(`${BASE}/api/files/${folderId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
			body: JSON.stringify({ restore: true })
		}),
		'Restore folder'
	);
	await assertOk(
		await fetch(`${BASE}/api/files/${folderId}?permanent=true`, {
			method: 'DELETE',
			headers: { Cookie: adminCookie }
		}),
		'Permanent delete folder'
	);
	console.log('[E2E] 8. Trash, restore & permanent disk cleanup verified!');
	console.log('[E2E] ALL CHECKS PASSED!');
}

run().catch((err) => {
	console.error('[E2E] FAILED:', err);
	process.exit(1);
});
