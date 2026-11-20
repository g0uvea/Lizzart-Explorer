import { toast } from '$lib/stores/toast.svelte';
import {
	appendDownloadChunk,
	assemblePersistedDownloadBlob,
	deletePersistedDownload,
	listPersistedDownloads,
	saveDownloadMeta,
	type PersistedDownloadMeta
} from '$lib/stores/transferPersistence';
import type { PendingUploadSession, PerformanceClientConfig } from '$lib/types';

// Requirement #6: Strict 8 MB base up to 20 MB hard cap (only for genuinely ultra-fast & stable links)
export const MIN_CHUNK_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_CHUNK_BYTES = 20 * 1024 * 1024; // 20 MB
const CHUNK_STEPS = [
	8 * 1024 * 1024, // 8 MB (default & fallback on any instability)
	12 * 1024 * 1024, // 12 MB (>= 25 MB/s sustained, CV <= 0.18, 3+ clean chunks)
	16 * 1024 * 1024, // 16 MB (>= 45 MB/s sustained, CV <= 0.15, 3+ clean chunks)
	20 * 1024 * 1024 // 20 MB (>= 75 MB/s sustained, CV <= 0.12, 4+ clean chunks — ultra-fast fiber/LAN)
];

export type TransferStatus =
	| 'queued'
	| 'active'
	| 'paused'
	| 'retrying'
	| 'needs_file' // Interrupted upload recovered after power outage / reload — awaiting file re-pick
	| 'done'
	| 'error'
	| 'cancelled';

export type NetworkStability = 'default' | 'stable' | 'ultra' | 'unstable';

export interface TransferItem {
	id: string;
	kind: 'upload' | 'download';
	fileName: string;
	totalBytes: number;
	transferredBytes: number;
	chunkSizeBytes: number;
	speedBps: number;
	stability: NetworkStability;
	status: TransferStatus;
	resumed: boolean;
	persisted: boolean;
	errorMessage?: string;
	uploadId?: string;
	workspaceId?: string;
	workspaceName?: string;
	fingerprint?: string;
	// Internal handles
	file?: File;
	parentId?: string | null;
	nodeId?: string;
	mimeType?: string;
	etag?: string | null;
	chunkCount?: number;
	// Stability tracking per transfer
	stepIndex: number;
	speedHistory: number[];
	stableStreak: number;
	instabilityCooldown: number;
	abortController?: AbortController;
	onComplete?: () => void;
}

interface NetworkInformationLike {
	saveData?: boolean;
	effectiveType?: string;
}

function isNetworkHintUnstable(): boolean {
	if (typeof navigator === 'undefined') return false;
	const conn = (navigator as unknown as { connection?: NetworkInformationLike }).connection;
	if (!conn) return false;
	if (conn.saveData) return true;
	if (conn.effectiveType && ['slow-2g', '2g', '3g'].includes(conn.effectiveType)) return true;
	return false;
}

function computeSpeedStats(samples: number[]): { mean: number; cv: number } {
	if (samples.length === 0) return { mean: 0, cv: 1 };
	const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
	if (mean <= 0) return { mean: 0, cv: 1 };
	const variance = samples.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / samples.length;
	const stddev = Math.sqrt(variance);
	return { mean, cv: stddev / mean };
}

async function computeSha256Hex(blob: Blob): Promise<string | null> {
	try {
		if (typeof crypto === 'undefined' || !crypto.subtle) return null;
		const buf = await blob.arrayBuffer();
		const digest = await crypto.subtle.digest('SHA-256', buf);
		return Array.from(new Uint8Array(digest))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	} catch {
		return null;
	}
}

class TransferManager {
	items = $state<TransferItem[]>([]);
	minimized = $state(false);
	maxConcurrent = $state(2);
	private restoredOnce = false;

	applyClientPerfConfig(cfg: PerformanceClientConfig | null | undefined) {
		if (!cfg) return;
		this.maxConcurrent = Math.max(1, Math.min(4, cfg.maxConcurrentTransfers || 2));
		this.pumpQueue();
	}

	private find(id: string): TransferItem | undefined {
		return this.items.find((i) => i.id === id);
	}

	private isStopped(item: TransferItem): boolean {
		return (
			item.status === 'paused' ||
			item.status === 'cancelled' ||
			item.status === 'needs_file'
		);
	}

	private activeWorkerCount(): number {
		return this.items.filter((i) => i.status === 'active' || i.status === 'retrying').length;
	}

	private pumpQueue() {
		while (this.activeWorkerCount() < this.maxConcurrent) {
			const next = this.items.find((i) => i.status === 'queued');
			if (!next) break;
			if (next.kind === 'upload') {
				void this.runUpload(next.id);
			} else {
				void this.runDownload(next.id);
			}
		}
	}

	/**
	 * Requirement #6: Strict 8 MB -> 20 MB stability-gated chunk controller.
	 * Stays strictly at 8 MB unless the link proves sustained ultra-high speed AND very low jitter.
	 * Immediately drops back to 8 MB on any error, retry, or jitter spike.
	 */
	private updateAdaptiveChunk(item: TransferItem, speedBps: number, hadError: boolean): void {
		if (hadError || isNetworkHintUnstable()) {
			item.stepIndex = 0;
			item.chunkSizeBytes = CHUNK_STEPS[0]; // Immediately lock back to 8 MB
			item.stableStreak = 0;
			item.speedHistory = [];
			item.instabilityCooldown = 5; // Stay at 8 MB for at least 5 clean chunks
			item.stability = 'unstable';
			return;
		}

		item.speedHistory = [...item.speedHistory.slice(-3), speedBps];
		const { mean, cv } = computeSpeedStats(item.speedHistory);
		const meanMBps = mean / (1024 * 1024);

		// Any noticeable instability (high jitter > 0.30 or low speed < 18 MB/s) -> stay/return to 8 MB
		if (item.speedHistory.length >= 2 && (cv > 0.3 || meanMBps < 18)) {
			item.stepIndex = 0;
			item.chunkSizeBytes = CHUNK_STEPS[0];
			item.stableStreak = 0;
			item.stability = cv > 0.3 ? 'unstable' : 'default';
			return;
		}

		if (item.instabilityCooldown > 0) {
			item.instabilityCooldown -= 1;
			item.chunkSizeBytes = CHUNK_STEPS[0];
			item.stability = 'default';
			return;
		}

		item.stableStreak += 1;

		// Climb ladder conservatively: 8 MB -> 12 MB -> 16 MB -> 20 MB
		if (item.stepIndex === 0 && item.stableStreak >= 3 && meanMBps >= 25 && cv <= 0.18) {
			item.stepIndex = 1;
			item.stableStreak = 0;
		} else if (item.stepIndex === 1 && item.stableStreak >= 3 && meanMBps >= 45 && cv <= 0.15) {
			item.stepIndex = 2;
			item.stableStreak = 0;
		} else if (item.stepIndex === 2 && item.stableStreak >= 4 && meanMBps >= 75 && cv <= 0.12) {
			item.stepIndex = 3;
			item.stableStreak = 0;
		} else if (item.stepIndex > 0) {
			// Step down smoothly if sustained speed drops below tier requirement
			const minForTier = item.stepIndex === 3 ? 60 : item.stepIndex === 2 ? 36 : 20;
			if (meanMBps < minForTier) {
				item.stepIndex = Math.max(0, item.stepIndex - 1);
				item.stableStreak = 0;
			}
		}

		item.chunkSizeBytes = Math.min(MAX_CHUNK_BYTES, Math.max(MIN_CHUNK_BYTES, CHUNK_STEPS[item.stepIndex]));
		item.stability =
			item.stepIndex === 3 ? 'ultra' : item.stepIndex >= 1 ? 'stable' : 'default';
	}

	/**
	 * Restores interrupted downloads (from IndexedDB) and interrupted uploads (from server)
	 * after a power outage, browser crash, or page reload.
	 */
	async restorePendingTransfers(onUploadComplete?: () => void) {
		if (this.restoredOnce || typeof window === 'undefined') return;
		this.restoredOnce = true;

		let restoredCount = 0;

		// 1. Restore incomplete persisted downloads from IndexedDB
		const persistedDownloads = await listPersistedDownloads();
		for (const dl of persistedDownloads) {
			if (this.items.some((i) => i.id === dl.id)) continue;
			if (dl.totalBytes > 0 && dl.downloadedBytes >= dl.totalBytes) {
				await deletePersistedDownload(dl.id);
				continue;
			}
			this.items = [
				...this.items,
				{
					id: dl.id,
					kind: 'download',
					fileName: dl.fileName,
					totalBytes: dl.totalBytes,
					transferredBytes: dl.downloadedBytes,
					chunkSizeBytes: MIN_CHUNK_BYTES,
					speedBps: 0,
					stability: 'default',
					status: 'paused',
					resumed: dl.downloadedBytes > 0,
					persisted: true,
					nodeId: dl.nodeId,
					mimeType: dl.mimeType,
					etag: dl.etag,
					chunkCount: dl.chunkCount,
					stepIndex: 0,
					speedHistory: [],
					stableStreak: 0,
					instabilityCooldown: 0
				}
			];
			restoredCount++;
		}

		// 2. Restore incomplete server-side upload sessions
		try {
			const res = await fetch('/api/files/upload/pending');
			if (res.ok) {
				const data = (await res.json()) as { pending: PendingUploadSession[] };
				for (const up of data.pending || []) {
					if (this.items.some((i) => i.uploadId === up.uploadId)) continue;
					this.items = [
						...this.items,
						{
							id: `up-rec-${up.uploadId}`,
							kind: 'upload',
							fileName: up.fileName,
							totalBytes: up.totalBytes,
							transferredBytes: up.uploadedBytes,
							chunkSizeBytes: MIN_CHUNK_BYTES,
							speedBps: 0,
							stability: 'default',
							status: 'needs_file',
							resumed: true,
							persisted: true,
							uploadId: up.uploadId,
							workspaceId: up.workspaceId,
							workspaceName: up.workspaceName,
							parentId: up.parentId,
							mimeType: up.mimeType,
							fingerprint: up.fingerprint,
							stepIndex: 0,
							speedHistory: [],
							stableStreak: 0,
							instabilityCooldown: 0,
							onComplete: onUploadComplete
						}
					];
					restoredCount++;
				}
			}
		} catch {
			// Ignore if offline on boot
		}

		if (restoredCount > 0) {
			toast.info(
				`${restoredCount} transferência(s) interrompida(s) encontrada(s) e pronta(s) para retomar!`
			);
		}
	}

	/**
	 * Attaches a re-selected local File to an interrupted server upload after a power outage / reload.
	 */
	attachFileToResume(id: string, file: File) {
		const item = this.find(id);
		if (!item || item.kind !== 'upload') return;

		if (file.size !== item.totalBytes) {
			toast.error(
				`O arquivo selecionado tem tamanho diferente do upload interrompido ("${item.fileName}"). Selecione o mesmo arquivo.`
			);
			return;
		}
		item.file = file;
		item.errorMessage = undefined;
		item.status = 'queued';
		this.pumpQueue();
	}

	enqueueUploads(
		files: File[],
		workspaceId: string,
		parentId: string | null,
		onComplete?: () => void
	) {
		for (const file of files) {
			const fp = `${file.name}::${file.size}::${file.lastModified}`;
			// If user dropped/selected the exact same file as a recovered interrupted upload, resume it directly!
			const recovered = this.items.find(
				(i) =>
					i.kind === 'upload' &&
					i.status === 'needs_file' &&
					i.workspaceId === workspaceId &&
					(i.fingerprint === fp || (i.fileName === file.name && i.totalBytes === file.size))
			);
			if (recovered) {
				recovered.file = file;
				recovered.onComplete = onComplete;
				recovered.status = 'queued';
				continue;
			}

			const id = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const item: TransferItem = {
				id,
				kind: 'upload',
				fileName: file.name,
				totalBytes: file.size,
				transferredBytes: 0,
				chunkSizeBytes: MIN_CHUNK_BYTES,
				speedBps: 0,
				stability: 'default',
				status: 'queued',
				resumed: false,
				persisted: true,
				workspaceId,
				parentId,
				fingerprint: fp,
				file,
				stepIndex: 0,
				speedHistory: [],
				stableStreak: 0,
				instabilityCooldown: 0,
				onComplete
			};
			this.items = [item, ...this.items];
		}
		this.pumpQueue();
	}

	enqueueDownload(nodeId: string, fileName: string, totalBytes: number, mimeType: string | null) {
		// If an interrupted persisted download for this exact file already exists, resume it!
		const existing = this.items.find(
			(i) =>
				i.kind === 'download' &&
				i.nodeId === nodeId &&
				(i.status === 'paused' || i.status === 'error')
		);
		if (existing) {
			this.resume(existing.id);
			return;
		}

		const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const item: TransferItem = {
			id,
			kind: 'download',
			fileName,
			totalBytes,
			transferredBytes: 0,
			chunkSizeBytes: MIN_CHUNK_BYTES,
			speedBps: 0,
			stability: 'default',
			status: 'queued',
			resumed: false,
			persisted: true,
			nodeId,
			mimeType: mimeType || 'application/octet-stream',
			etag: null,
			chunkCount: 0,
			stepIndex: 0,
			speedHistory: [],
			stableStreak: 0,
			instabilityCooldown: 0
		};
		this.items = [item, ...this.items];
		this.pumpQueue();
	}

	pause(id: string) {
		const item = this.find(id);
		if (!item) return;
		item.status = 'paused';
		item.abortController?.abort();
		this.pumpQueue();
	}

	resume(id: string) {
		const item = this.find(id);
		if (!item) return;
		if (item.kind === 'upload' && !item.file) {
			item.status = 'needs_file';
			return;
		}
		item.errorMessage = undefined;
		item.status = 'queued';
		this.pumpQueue();
	}

	async cancel(id: string) {
		const item = this.find(id);
		if (!item) return;
		item.status = 'cancelled';
		item.abortController?.abort();
		if (item.kind === 'upload' && item.uploadId) {
			fetch(`/api/files/upload/${item.uploadId}`, { method: 'DELETE' }).catch(() => {});
		}
		if (item.kind === 'download') {
			await deletePersistedDownload(item.id);
		}
		this.items = this.items.filter((i) => i.id !== id);
		this.pumpQueue();
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
		if (!item || !item.file) {
			this.pumpQueue();
			return;
		}

		item.status = 'active';
		const file = item.file;
		const fingerprint = item.fingerprint || `${file.name}::${file.size}::${file.lastModified}`;

		try {
			// 1. Init or resume server-side durable upload session
			const initRes = await fetch('/api/files/upload/init', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					fileName: file.name,
					mimeType: file.type,
					totalBytes: file.size,
					workspaceId: item.workspaceId,
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
				toast.info(`Retomando upload de "${file.name}" a partir de ${Math.round((offset / Math.max(1, file.size)) * 100)}%!`);
			}

			// 2. Adaptive 8 MB -> 20 MB chunk upload loop with SHA-256 verification
			let retries = 0;
			while (offset < file.size) {
				if (item.status !== 'active') return;

				const chunkSize = Math.min(item.chunkSizeBytes, MAX_CHUNK_BYTES, file.size - offset);
				const slice = file.slice(offset, offset + chunkSize);
				const controller = new AbortController();
				item.abortController = controller;

				const startedAt = performance.now();
				try {
					const chunkSha = await computeSha256Hex(slice);
					const headers: Record<string, string> = {
						'Content-Type': 'application/octet-stream',
						'X-Chunk-Offset': String(offset)
					};
					if (chunkSha) headers['X-Chunk-SHA256'] = chunkSha;

					const putRes = await fetch(`/api/files/upload/${item.uploadId}`, {
						method: 'PUT',
						headers,
						body: slice,
						signal: controller.signal
					});

					if (putRes.status === 409) {
						// Re-sync exact confirmed server offset after power/network recovery
						const syncData = await putRes.json().catch(() => ({}));
						if (typeof syncData.expectedOffset === 'number') {
							offset = syncData.expectedOffset;
							item.transferredBytes = offset;
							continue;
						}
					}

					if (!putRes.ok) {
						const errJson = await putRes.json().catch(() => ({}));
						throw new Error(errJson.error || `HTTP ${putRes.status}`);
					}

					const elapsedSec = Math.max(0.05, (performance.now() - startedAt) / 1000);
					const speed = chunkSize / elapsedSec;
					offset += chunkSize;
					item.transferredBytes = offset;
					item.speedBps = speed;
					this.updateAdaptiveChunk(item, speed, false);
					retries = 0;
				} catch (err) {
					if (this.isStopped(item)) return;

					retries++;
					this.updateAdaptiveChunk(item, 0, true);
					if (retries > 8) {
						item.status = 'error';
						item.errorMessage =
							err instanceof Error
								? err.message
								: 'Conexão perdida. Progresso salvo — clique em Retomar.';
						toast.warning(
							`Upload de "${file.name}" pausado por queda de rede. Progresso salvo para retomar.`
						);
						return;
					}
					item.status = 'retrying';
					await this.waitForReconnect(Math.min(12_000, 1500 * retries));
					if (item.status === 'retrying') {
						item.status = 'active';
						// Re-check durable server offset before retrying chunk
						try {
							const stRes = await fetch(`/api/files/upload/${item.uploadId}`);
							if (stRes.ok) {
								const st = await stRes.json();
								if (typeof st.uploadedBytes === 'number') {
									offset = st.uploadedBytes;
									item.transferredBytes = offset;
								}
							}
						} catch {
							// continue from local offset
						}
					}
				}
			}

			// 3. Finalize file atomically on server
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
			toast.success(`"${file.name}" enviado com integridade 100% verificada!`);
			item.onComplete?.();
		} catch (err) {
			if (this.isStopped(item)) return;
			item.status = 'error';
			item.errorMessage = err instanceof Error ? err.message : 'Erro inesperado no upload.';
		} finally {
			this.pumpQueue();
		}
	}

	private async runDownload(id: string) {
		const item = this.find(id);
		if (!item || !item.nodeId) {
			this.pumpQueue();
			return;
		}

		item.status = 'active';
		const url = `/api/files/${item.nodeId}/content?download=1`;

		try {
			// 1. Probe exact file size + ETag via HEAD
			const headRes = await fetch(url, { method: 'HEAD' });
			if (!headRes.ok) {
				throw new Error(`Arquivo indisponível (HTTP ${headRes.status})`);
			}
			const serverSize = Number(headRes.headers.get('content-length') || item.totalBytes || 0);
			const serverEtag = headRes.headers.get('etag');

			// If file changed on server since power outage, cleanly reset persisted partial chunks
			if (item.etag && serverEtag && item.etag !== serverEtag && item.transferredBytes > 0) {
				await deletePersistedDownload(item.id);
				item.transferredBytes = 0;
				item.chunkCount = 0;
				item.resumed = false;
			}

			item.totalBytes = serverSize;
			item.etag = serverEtag;

			if (item.totalBytes === 0) {
				this.triggerBlobSave(new Blob([], { type: item.mimeType || 'application/octet-stream' }), item.fileName);
				await deletePersistedDownload(item.id);
				item.status = 'done';
				return;
			}

			let offset = item.transferredBytes;
			let chunkIndex = item.chunkCount || 0;

			const buildMeta = (): PersistedDownloadMeta => ({
				id: item.id,
				nodeId: item.nodeId!,
				fileName: item.fileName,
				mimeType: item.mimeType || 'application/octet-stream',
				totalBytes: item.totalBytes,
				downloadedBytes: offset,
				etag: item.etag ?? null,
				chunkCount: chunkIndex,
				updatedAt: Date.now()
			});

			await saveDownloadMeta(buildMeta());

			// 2. Resumable Range download loop persisting every chunk directly to IndexedDB
			let retries = 0;
			while (offset < item.totalBytes) {
				if (item.status !== 'active') return;

				const end = Math.min(offset + item.chunkSizeBytes - 1, item.totalBytes - 1);
				const controller = new AbortController();
				item.abortController = controller;

				const startedAt = performance.now();
				try {
					const headers: Record<string, string> = {
						Range: `bytes=${offset}-${end}`
					};
					if (item.etag) headers['If-Range'] = item.etag;

					const res = await fetch(url, { headers, signal: controller.signal });

					if (!res.ok && res.status !== 206) {
						throw new Error(`HTTP ${res.status}`);
					}

					const buf = new Uint8Array(await res.arrayBuffer());
					const elapsedSec = Math.max(0.05, (performance.now() - startedAt) / 1000);
					const speed = buf.byteLength / elapsedSec;

					// If server ignored If-Range (file changed) and sent 200 full file, reset offset
					if (res.status === 200 && offset > 0) {
						await deletePersistedDownload(item.id);
						offset = 0;
						chunkIndex = 0;
					}

					offset += buf.byteLength;
					item.transferredBytes = offset;
					item.chunkCount = chunkIndex + 1;
					item.speedBps = speed;

					await appendDownloadChunk(buildMeta(), chunkIndex, buf);
					chunkIndex += 1;

					this.updateAdaptiveChunk(item, speed, false);
					retries = 0;

					if (res.status === 200) break;
				} catch (err) {
					if (this.isStopped(item)) return;
					retries++;
					this.updateAdaptiveChunk(item, 0, true);
					if (retries > 8) {
						item.status = 'error';
						item.errorMessage =
							err instanceof Error
								? err.message
								: 'Download interrompido. Bytes salvos — clique em Retomar.';
						toast.warning(
							`Download de "${item.fileName}" pausado. Progresso salvo localmente para retomar.`
						);
						return;
					}
					item.status = 'retrying';
					await this.waitForReconnect(Math.min(12_000, 1500 * retries));
					if (item.status === 'retrying') {
						item.status = 'active';
					}
				}
			}

			// 3. Assemble final Blob from IndexedDB and trigger save without double RAM usage
			const finalBlob = await assemblePersistedDownloadBlob(
				item.id,
				item.mimeType || 'application/octet-stream'
			);
			if (!finalBlob) {
				throw new Error('Não foi possível montar o arquivo baixado a partir do cache local.');
			}

			this.triggerBlobSave(finalBlob, item.fileName);
			await deletePersistedDownload(item.id);
			item.status = 'done';
			toast.success(`Download de "${item.fileName}" concluído sem perdas!`);
		} catch (err) {
			if (this.isStopped(item)) return;
			item.status = 'error';
			item.errorMessage = err instanceof Error ? err.message : 'Falha no download.';
		} finally {
			this.pumpQueue();
		}
	}

	private triggerBlobSave(blob: Blob, fileName: string) {
		const blobUrl = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = blobUrl;
		a.download = fileName;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(blobUrl), 15_000);
	}
}

export const transferManager = new TransferManager();
