import { toast } from '$lib/stores/toast.svelte';

const MIN_CHUNK_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_CHUNK_BYTES = 64 * 1024 * 1024; // 64 MB

export type TransferStatus = 'queued' | 'active' | 'paused' | 'retrying' | 'done' | 'error' | 'cancelled';

export interface TransferItem {
	id: string;
	kind: 'upload' | 'download';
	fileName: string;
	totalBytes: number;
	transferredBytes: number;
	chunkSizeBytes: number;
	speedBps: number;
	status: TransferStatus;
	resumed: boolean;
	errorMessage?: string;
	uploadId?: string;
	// Internal handles
	file?: File;
	parentId?: string | null;
	nodeId?: string;
	mimeType?: string;
	downloadedChunks?: Uint8Array[];
	abortController?: AbortController;
	onComplete?: () => void;
}

class TransferManager {
	items = $state<TransferItem[]>([]);
	minimized = $state(false);

	private find(id: string): TransferItem | undefined {
		return this.items.find((i) => i.id === id);
	}

	private isStopped(item: TransferItem): boolean {
		return item.status === 'paused' || item.status === 'cancelled';
	}

	private nextAdaptiveChunk(current: number, speedBps: number, hadError: boolean): number {
		if (hadError) {
			return Math.max(MIN_CHUNK_BYTES, Math.floor(current / 2));
		}
		const mbps = speedBps / (1024 * 1024);
		if (mbps >= 12 && current < MAX_CHUNK_BYTES) {
			return Math.min(MAX_CHUNK_BYTES, current * 2);
		}
		if (mbps < 3 && current > MIN_CHUNK_BYTES) {
			return Math.max(MIN_CHUNK_BYTES, Math.floor(current / 2));
		}
		return current;
	}

	enqueueUploads(files: File[], parentId: string | null, onComplete?: () => void) {
		for (const file of files) {
			const id = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const item: TransferItem = {
				id,
				kind: 'upload',
				fileName: file.name,
				totalBytes: file.size,
				transferredBytes: 0,
				chunkSizeBytes: MIN_CHUNK_BYTES,
				speedBps: 0,
				status: 'queued',
				resumed: false,
				file,
				parentId,
				onComplete
			};
			this.items = [item, ...this.items];
			this.runUpload(id);
		}
	}

	enqueueDownload(nodeId: string, fileName: string, totalBytes: number, mimeType: string | null) {
		const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const item: TransferItem = {
			id,
			kind: 'download',
			fileName,
			totalBytes,
			transferredBytes: 0,
			chunkSizeBytes: MIN_CHUNK_BYTES,
			speedBps: 0,
			status: 'queued',
			resumed: false,
			nodeId,
			mimeType: mimeType || 'application/octet-stream',
			downloadedChunks: []
		};
		this.items = [item, ...this.items];
		this.runDownload(id);
	}

	pause(id: string) {
		const item = this.find(id);
		if (!item) return;
		item.status = 'paused';
		item.abortController?.abort();
	}

	resume(id: string) {
		const item = this.find(id);
		if (!item) return;
		item.errorMessage = undefined;
		if (item.kind === 'upload') {
			this.runUpload(id);
		} else {
			this.runDownload(id);
		}
	}

	async cancel(id: string) {
		const item = this.find(id);
		if (!item) return;
		item.status = 'cancelled';
		item.abortController?.abort();
		if (item.kind === 'upload' && item.uploadId) {
			fetch(`/api/files/upload/${item.uploadId}`, { method: 'DELETE' }).catch(() => {});
		}
		this.items = this.items.filter((i) => i.id !== id);
	}

	clearFinished() {
		this.items = this.items.filter((i) => i.status !== 'done' && i.status !== 'cancelled');
	}

	private async waitForReconnect(ms: number): Promise<void> {
		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			await new Promise<void>((resolve) => {
				const onOnline = () => {
					window.removeEventListener('online', onOnline);
					resolve();
				};
				window.addEventListener('online', onOnline);
				setTimeout(() => {
					window.removeEventListener('online', onOnline);
					resolve();
				}, Math.max(ms, 8000));
			});
			return;
		}
		await new Promise((r) => setTimeout(r, ms));
	}

	private async runUpload(id: string) {
		const item = this.find(id);
		if (!item || !item.file) return;

		item.status = 'active';
		const file = item.file;
		const fingerprint = `${file.name}::${file.size}::${file.lastModified}`;

		try {
			// 1. Init or resume server-side upload session
			const initRes = await fetch('/api/files/upload/init', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					fileName: file.name,
					mimeType: file.type,
					totalBytes: file.size,
					parentId: item.parentId ?? null,
					fingerprint
				})
			});
			const initData = await initRes.json();
			if (!initRes.ok) {
				item.status = 'error';
				item.errorMessage = initData.error || 'Falha ao iniciar upload.';
				toast.error(item.errorMessage ?? 'Erro no upload');
				return;
			}

			item.uploadId = initData.uploadId;
			let offset = Number(initData.uploadedBytes || 0);
			item.transferredBytes = offset;
			item.resumed = Boolean(initData.resumed);

			if (item.resumed) {
				toast.info(`Retomando upload de "${file.name}" de onde parou!`);
			}

			// 2. Adaptive chunk upload loop (8 MB -> up to 64 MB)
			let retries = 0;
			while (offset < file.size) {
				if (item.status !== 'active') return;

				const chunkSize = Math.min(item.chunkSizeBytes, file.size - offset);
				const slice = file.slice(offset, offset + chunkSize);
				const controller = new AbortController();
				item.abortController = controller;

				const startedAt = performance.now();
				try {
					const putRes = await fetch(`/api/files/upload/${item.uploadId}`, {
						method: 'PUT',
						headers: {
							'Content-Type': 'application/octet-stream',
							'X-Chunk-Offset': String(offset)
						},
						body: slice,
						signal: controller.signal
					});

					if (!putRes.ok) {
						const errJson = await putRes.json().catch(() => ({}));
						throw new Error(errJson.error || `HTTP ${putRes.status}`);
					}

					const elapsedSec = Math.max(0.05, (performance.now() - startedAt) / 1000);
					const speed = chunkSize / elapsedSec;
					offset += chunkSize;
					item.transferredBytes = offset;
					item.speedBps = speed;
					item.chunkSizeBytes = this.nextAdaptiveChunk(item.chunkSizeBytes, speed, false);
					retries = 0;
				} catch (err) {
					if (this.isStopped(item)) return;

					retries++;
					item.chunkSizeBytes = this.nextAdaptiveChunk(item.chunkSizeBytes, 0, true);
					if (retries > 6) {
						item.status = 'error';
						item.errorMessage =
							err instanceof Error ? err.message : 'Conexão perdida. Clique em Retomar.';
						toast.warning(`Upload de "${file.name}" pausado por erro de rede. Você pode retomar.`);
						return;
					}
					item.status = 'retrying';
					await this.waitForReconnect(Math.min(10000, 1200 * retries));
					if (item.status === 'retrying') {
						item.status = 'active';
					}
				}
			}

			// 3. Finalize file on server
			const compRes = await fetch(`/api/files/upload/${item.uploadId}/complete`, {
				method: 'POST'
			});
			const compData = await compRes.json();
			if (!compRes.ok) {
				item.status = 'error';
				item.errorMessage = compData.error || 'Erro ao finalizar arquivo.';
				toast.error(item.errorMessage ?? 'Erro ao finalizar');
				return;
			}

			item.status = 'done';
			item.transferredBytes = file.size;
			toast.success(`"${file.name}" enviado com qualidade original!`);
			item.onComplete?.();
		} catch (err) {
			if (this.isStopped(item)) return;
			item.status = 'error';
			item.errorMessage = err instanceof Error ? err.message : 'Erro inesperado no upload.';
		}
	}

	private async runDownload(id: string) {
		const item = this.find(id);
		if (!item || !item.nodeId) return;

		item.status = 'active';
		const url = `/api/files/${item.nodeId}/content?download=1`;

		try {
			// Verify exact file size via HEAD
			if (item.totalBytes <= 0) {
				const headRes = await fetch(url, { method: 'HEAD' });
				if (headRes.ok) {
					item.totalBytes = Number(headRes.headers.get('content-length') || 0);
				}
			}

			let offset = item.transferredBytes;
			if (!item.downloadedChunks) item.downloadedChunks = [];

			// Small empty file edge case
			if (item.totalBytes === 0) {
				this.triggerBlobSave([], item.fileName, item.mimeType || 'application/octet-stream');
				item.status = 'done';
				return;
			}

			let retries = 0;
			while (offset < item.totalBytes) {
				if (item.status !== 'active') return;

				const end = Math.min(offset + item.chunkSizeBytes - 1, item.totalBytes - 1);
				const controller = new AbortController();
				item.abortController = controller;

				const startedAt = performance.now();
				try {
					const res = await fetch(url, {
						headers: { Range: `bytes=${offset}-${end}` },
						signal: controller.signal
					});

					if (!res.ok && res.status !== 206) {
						throw new Error(`HTTP ${res.status}`);
					}

					const buf = new Uint8Array(await res.arrayBuffer());
					const elapsedSec = Math.max(0.05, (performance.now() - startedAt) / 1000);
					const speed = buf.byteLength / elapsedSec;

					item.downloadedChunks.push(buf);
					offset += buf.byteLength;
					item.transferredBytes = offset;
					item.speedBps = speed;
					item.chunkSizeBytes = this.nextAdaptiveChunk(item.chunkSizeBytes, speed, false);
					retries = 0;

					// If server returned full file (200) instead of partial (206), stop loop
					if (res.status === 200) break;
				} catch (err) {
					if (this.isStopped(item)) return;
					retries++;
					item.chunkSizeBytes = this.nextAdaptiveChunk(item.chunkSizeBytes, 0, true);
					if (retries > 6) {
						item.status = 'error';
						item.errorMessage =
							err instanceof Error ? err.message : 'Download interrompido. Clique em Retomar.';
						toast.warning(`Download de "${item.fileName}" pausado. Você pode retomar.`);
						return;
					}
					item.status = 'retrying';
					await this.waitForReconnect(Math.min(10000, 1200 * retries));
					if (item.status === 'retrying') {
						item.status = 'active';
					}
				}
			}

			this.triggerBlobSave(
				item.downloadedChunks,
				item.fileName,
				item.mimeType || 'application/octet-stream'
			);
			item.downloadedChunks = [];
			item.status = 'done';
			toast.success(`Download de "${item.fileName}" concluído sem perdas!`);
		} catch (err) {
			if (this.isStopped(item)) return;
			item.status = 'error';
			item.errorMessage = err instanceof Error ? err.message : 'Falha no download.';
		}
	}

	private triggerBlobSave(chunks: Uint8Array[], fileName: string, mimeType: string) {
		const parts: BlobPart[] = chunks.map(
			(c) => c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) as ArrayBuffer
		);
		const blob = new Blob(parts, { type: mimeType });
		const blobUrl = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = blobUrl;
		a.download = fileName;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
	}
}

export const transferManager = new TransferManager();
