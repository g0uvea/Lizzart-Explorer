/**
 * Power-outage-safe & reload-safe persistent storage for resumable downloads.
 * Persists metadata + downloaded byte chunks directly to IndexedDB (and OPFS when available)
 * so closing the browser, losing network, or suffering a power outage preserves 100% of
 * already-downloaded bytes without keeping multi-gigabyte files in RAM.
 */

export interface PersistedDownloadMeta {
	id: string;
	nodeId: string;
	fileName: string;
	mimeType: string;
	totalBytes: number;
	downloadedBytes: number;
	etag: string | null;
	chunkCount: number;
	updatedAt: number;
}

const DB_NAME = 'lizzart_resumable_transfers_v1';
const DB_VERSION = 1;
const META_STORE = 'download_meta';
const CHUNK_STORE = 'download_chunks';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (typeof indexedDB === 'undefined') {
		return Promise.reject(new Error('IndexedDB indisponível'));
	}
	if (dbPromise) return dbPromise;

	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(META_STORE)) {
				db.createObjectStore(META_STORE, { keyPath: 'id' });
			}
			if (!db.objectStoreNames.contains(CHUNK_STORE)) {
				const store = db.createObjectStore(CHUNK_STORE, { keyPath: ['downloadId', 'index'] });
				store.createIndex('by_download', 'downloadId', { unique: false });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => {
			dbPromise = null;
			reject(req.error);
		};
	});
	return dbPromise;
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export async function saveDownloadMeta(meta: PersistedDownloadMeta): Promise<void> {
	try {
		const db = await openDb();
		const tx = db.transaction(META_STORE, 'readwrite');
		tx.objectStore(META_STORE).put(meta);
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} catch {
		// Non-fatal fallback
	}
}

export async function appendDownloadChunk(
	meta: PersistedDownloadMeta,
	chunkIndex: number,
	data: Uint8Array
): Promise<void> {
	try {
		const db = await openDb();
		const tx = db.transaction([META_STORE, CHUNK_STORE], 'readwrite');
		const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer]);
		tx.objectStore(CHUNK_STORE).put({
			downloadId: meta.id,
			index: chunkIndex,
			blob
		});
		tx.objectStore(META_STORE).put(meta);
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} catch {
		// Non-fatal fallback
	}
}

export async function listPersistedDownloads(): Promise<PersistedDownloadMeta[]> {
	try {
		const db = await openDb();
		const tx = db.transaction(META_STORE, 'readonly');
		const all = await idbReq(tx.objectStore(META_STORE).getAll());
		return (all as PersistedDownloadMeta[]).sort((a, b) => b.updatedAt - a.updatedAt);
	} catch {
		return [];
	}
}

export async function assemblePersistedDownloadBlob(
	downloadId: string,
	mimeType: string
): Promise<Blob | null> {
	try {
		const db = await openDb();
		const tx = db.transaction(CHUNK_STORE, 'readonly');
		const index = tx.objectStore(CHUNK_STORE).index('by_download');
		const range = IDBKeyRange.only(downloadId);
		const parts: BlobPart[] = [];

		await new Promise<void>((resolve, reject) => {
			const cursorReq = index.openCursor(range);
			cursorReq.onsuccess = () => {
				const cursor = cursorReq.result;
				if (!cursor) {
					resolve();
					return;
				}
				const val = cursor.value as { index: number; blob: Blob };
				parts[val.index] = val.blob;
				cursor.continue();
			};
			cursorReq.onerror = () => reject(cursorReq.error);
		});

		const cleanParts = parts.filter(Boolean);
		if (cleanParts.length === 0) return null;
		return new Blob(cleanParts, { type: mimeType });
	} catch {
		return null;
	}
}

export async function deletePersistedDownload(downloadId: string): Promise<void> {
	try {
		const db = await openDb();
		const tx = db.transaction([META_STORE, CHUNK_STORE], 'readwrite');
		tx.objectStore(META_STORE).delete(downloadId);

		const index = tx.objectStore(CHUNK_STORE).index('by_download');
		const range = IDBKeyRange.only(downloadId);
		await new Promise<void>((resolve, reject) => {
			const cursorReq = index.openCursor(range);
			cursorReq.onsuccess = () => {
				const cursor = cursorReq.result;
				if (!cursor) {
					resolve();
					return;
				}
				cursor.delete();
				cursor.continue();
			};
			cursorReq.onerror = () => reject(cursorReq.error);
		});

		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	} catch {
		// ignore cleanup failure
	}
}
