import os from 'node:os';
import type { PerformanceClientConfig, PerformanceMode, PerformanceProfileInfo, PerformanceTelemetry } from '$lib/types';

export interface PerformanceProfileRuntime {
	mode: PerformanceMode;
	label: string;
	tagline: string;
	description: string;
	dbConnectionLimit: number;
	dbQueueLimit: number;
	streamHighWaterMark: number;
	maxConcurrentIo: number;
	authCacheTtlMs: number;
	metadataCacheMaxEntries: number;
	maxListLimit: number;
	argon2MemoryKiB: number;
	argon2TimeCost: number;
	clientMaxConcurrentTransfers: number;
	clientSearchDebounceMs: number;
	clientReducedEffects: boolean;
}

export const PERFORMANCE_PROFILES: Record<PerformanceMode, PerformanceProfileRuntime> = {
	legacy_mobile: {
		mode: 'legacy_mobile',
		label: 'Ultra-Leve (Android / Termux / SBC)',
		tagline: 'Sobrevivência extrema para celulares antigos e TV Box',
		description:
			'Projetada especialmente para servidores improvisados em Android antigo (Termux/ARM), TV Box, Raspberry Pi Zero/3 ou máquinas com <512 MB de RAM livre. Minimiza conexões (2), reduz Argon2id para 12 MiB e usa chunks de 32 KB.',
		dbConnectionLimit: 2,
		dbQueueLimit: 20,
		streamHighWaterMark: 32 * 1024, // 32 KB
		maxConcurrentIo: 1,
		authCacheTtlMs: 10_000,
		metadataCacheMaxEntries: 60,
		maxListLimit: 80,
		argon2MemoryKiB: 12_288, // 12 MiB (prevents OOM killer on old Android kernels)
		argon2TimeCost: 2,
		clientMaxConcurrentTransfers: 1,
		clientSearchDebounceMs: 550,
		clientReducedEffects: true
	},
	ultra_optimized: {
		mode: 'ultra_optimized',
		label: 'Extremamente Otimizada',
		tagline: 'Mínimo consumo de RAM e CPU',
		description:
			'Projetada para Home-NAS humilde, Raspberry Pi 4, Mini PC ou VPS de 512 MB–1 GB. Reduz buffers de I/O, limita paralelismo e desativa efeitos visuais pesados.',
		dbConnectionLimit: 4,
		dbQueueLimit: 30,
		streamHighWaterMark: 64 * 1024, // 64 KB
		maxConcurrentIo: 2,
		authCacheTtlMs: 6_000,
		metadataCacheMaxEntries: 150,
		maxListLimit: 120,
		argon2MemoryKiB: 19_456, // 19 MiB (OWASP minimum)
		argon2TimeCost: 2,
		clientMaxConcurrentTransfers: 1,
		clientSearchDebounceMs: 420,
		clientReducedEffects: true
	},
	optimized: {
		mode: 'optimized',
		label: 'Otimizada',
		tagline: 'Equilíbrio inteligente (Recomendado)',
		description:
			'Consumo controlado de hardware com excelente fluidez no dia a dia. Ideal para pequenas e médias empresas ou Home-NAS com vários usuários simultâneos.',
		dbConnectionLimit: 10,
		dbQueueLimit: 80,
		streamHighWaterMark: 256 * 1024, // 256 KB
		maxConcurrentIo: 4,
		authCacheTtlMs: 15_000,
		metadataCacheMaxEntries: 500,
		maxListLimit: 300,
		argon2MemoryKiB: 32_768, // 32 MiB
		argon2TimeCost: 2,
		clientMaxConcurrentTransfers: 2,
		clientSearchDebounceMs: 280,
		clientReducedEffects: false
	},
	fast: {
		mode: 'fast',
		label: 'Rápida',
		tagline: 'Alta responsividade & cache amplo',
		description:
			'Prioriza baixa latência e transferências simultâneas com pool expandido no MariaDB, cache de sessão mais longo e buffers de streaming de 512 KB.',
		dbConnectionLimit: 22,
		dbQueueLimit: 200,
		streamHighWaterMark: 512 * 1024, // 512 KB
		maxConcurrentIo: 8,
		authCacheTtlMs: 30_000,
		metadataCacheMaxEntries: 2000,
		maxListLimit: 600,
		argon2MemoryKiB: 49_152, // 48 MiB
		argon2TimeCost: 3,
		clientMaxConcurrentTransfers: 3,
		clientSearchDebounceMs: 180,
		clientReducedEffects: false
	},
	ultra_fast: {
		mode: 'ultra_fast',
		label: 'Industrial / Extremamente Rápida',
		tagline: 'Throughput máximo para servidores dedicados & data centers',
		description:
			'Desempenho industrial em NVMe / redes 10GbE / grandes equipes. Pool amplo (40 conexões), buffers de 1 MB, até 16 fluxos I/O paralelos e cache quente.',
		dbConnectionLimit: 40,
		dbQueueLimit: 0,
		streamHighWaterMark: 1024 * 1024, // 1 MB
		maxConcurrentIo: 16,
		authCacheTtlMs: 45_000,
		metadataCacheMaxEntries: 5000,
		maxListLimit: 1200,
		argon2MemoryKiB: 65_536, // 64 MiB
		argon2TimeCost: 3,
		clientMaxConcurrentTransfers: 4,
		clientSearchDebounceMs: 100,
		clientReducedEffects: false
	}
};

export function isValidPerformanceMode(value: unknown): value is PerformanceMode {
	return (
		value === 'legacy_mobile' ||
		value === 'ultra_optimized' ||
		value === 'optimized' ||
		value === 'fast' ||
		value === 'ultra_fast'
	);
}

/**
 * Auto-detects the safest default performance profile based on host RAM & CPU
 * when PERFORMANCE_MODE is not explicitly set or set to "auto".
 */
export function detectHardwareDefaultMode(): PerformanceMode {
	const totalRamMb = Math.round(os.totalmem() / (1024 * 1024));
	const cores = os.cpus().length || 1;
	if (totalRamMb <= 1200 || (totalRamMb <= 2048 && cores <= 2)) {
		return 'legacy_mobile';
	}
	if (totalRamMb <= 2500) {
		return 'ultra_optimized';
	}
	if (totalRamMb >= 16000 && cores >= 8) {
		return 'fast';
	}
	return 'optimized';
}

let activeMode: PerformanceMode = isValidPerformanceMode(process.env.PERFORMANCE_MODE)
	? process.env.PERFORMANCE_MODE
	: detectHardwareDefaultMode();

export function getActivePerformanceMode(): PerformanceMode {
	return activeMode;
}

export function getPerformanceConfig(): PerformanceProfileRuntime {
	return PERFORMANCE_PROFILES[activeMode];
}

export function getClientPerformanceConfig(): PerformanceClientConfig {
	const cfg = getPerformanceConfig();
	return {
		mode: cfg.mode,
		label: cfg.label,
		maxConcurrentTransfers: cfg.clientMaxConcurrentTransfers,
		searchDebounceMs: cfg.clientSearchDebounceMs,
		reducedEffects: cfg.clientReducedEffects
	};
}

export function listPerformanceProfiles(): PerformanceProfileInfo[] {
	return (
		[
			'legacy_mobile',
			'ultra_optimized',
			'optimized',
			'fast',
			'ultra_fast'
		] as PerformanceMode[]
	).map((m) => {
		const p = PERFORMANCE_PROFILES[m];
		return {
			mode: p.mode,
			label: p.label,
			tagline: p.tagline,
			description: p.description,
			dbConnectionLimit: p.dbConnectionLimit,
			streamHighWaterMarkKb: Math.round(p.streamHighWaterMark / 1024),
			maxConcurrentIo: p.maxConcurrentIo,
			authCacheTtlSec: Math.round(p.authCacheTtlMs / 1000),
			metadataCacheMaxEntries: p.metadataCacheMaxEntries,
			maxListLimit: p.maxListLimit,
			argon2MemoryMb: Math.round(p.argon2MemoryKiB / 1024),
			clientMaxConcurrentTransfers: p.clientMaxConcurrentTransfers,
			clientSearchDebounceMs: p.clientSearchDebounceMs,
			clientReducedEffects: p.clientReducedEffects
		};
	});
}

// ============================================================================
// Bounded TTL / LRU Metadata & Auth Cache (strictly respects profile RAM cap)
// ============================================================================
interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

class BoundedTtlCache {
	private store = new Map<string, CacheEntry<unknown>>();
	private hits = 0;
	private misses = 0;

	get<T>(key: string): T | undefined {
		const entry = this.store.get(key);
		if (!entry) {
			this.misses++;
			return undefined;
		}
		if (entry.expiresAt <= Date.now()) {
			this.store.delete(key);
			this.misses++;
			return undefined;
		}
		// LRU refresh
		this.store.delete(key);
		this.store.set(key, entry);
		this.hits++;
		return entry.value as T;
	}

	set<T>(key: string, value: T, ttlMs: number): void {
		const maxEntries = getPerformanceConfig().metadataCacheMaxEntries;
		if (this.store.has(key)) {
			this.store.delete(key);
		}
		while (this.store.size >= maxEntries) {
			const oldest = this.store.keys().next().value;
			if (oldest === undefined) break;
			this.store.delete(oldest);
		}
		this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
	}

	delete(key: string): void {
		this.store.delete(key);
	}

	deleteByPrefix(prefix: string): void {
		for (const key of this.store.keys()) {
			if (key.startsWith(prefix)) {
				this.store.delete(key);
			}
		}
	}

	trimToLimit(): void {
		const maxEntries = getPerformanceConfig().metadataCacheMaxEntries;
		const now = Date.now();
		for (const [k, v] of this.store.entries()) {
			if (v.expiresAt <= now) this.store.delete(k);
		}
		while (this.store.size > maxEntries) {
			const oldest = this.store.keys().next().value;
			if (oldest === undefined) break;
			this.store.delete(oldest);
		}
	}

	clear(): void {
		this.store.clear();
	}

	stats() {
		const total = this.hits + this.misses;
		return {
			entries: this.store.size,
			maxEntries: getPerformanceConfig().metadataCacheMaxEntries,
			hitRatePct: total > 0 ? Math.round((this.hits / total) * 100) : 0
		};
	}
}

export const runtimeCache = new BoundedTtlCache();

// Periodic eviction of expired entries to prevent idle memory retention
setInterval(() => {
	runtimeCache.trimToLimit();
}, 60_000).unref?.();

export function setActivePerformanceMode(mode: PerformanceMode): void {
	activeMode = mode;
	runtimeCache.trimToLimit();
}

// ============================================================================
// Concurrent Disk I/O Semaphore (prevents hardware saturation under load)
// ============================================================================
let activeIoSlots = 0;
const ioWaitQueue: Array<() => void> = [];

function drainIoQueue(): void {
	const limit = getPerformanceConfig().maxConcurrentIo;
	while (activeIoSlots < limit && ioWaitQueue.length > 0) {
		const next = ioWaitQueue.shift();
		if (next) {
			activeIoSlots++;
			next();
		}
	}
}

export async function acquireIoSlot(): Promise<() => void> {
	const limit = getPerformanceConfig().maxConcurrentIo;
	if (activeIoSlots < limit) {
		activeIoSlots++;
	} else {
		await new Promise<void>((resolve) => {
			ioWaitQueue.push(resolve);
		});
	}

	let released = false;
	return () => {
		if (released) return;
		released = true;
		activeIoSlots = Math.max(0, activeIoSlots - 1);
		drainIoQueue();
	};
}

export async function withIoSlot<T>(fn: () => Promise<T>): Promise<T> {
	const release = await acquireIoSlot();
	try {
		return await fn();
	} finally {
		release();
	}
}

export function getPerformanceTelemetry(): PerformanceTelemetry {
	const cfg = getPerformanceConfig();
	const mem = process.memoryUsage();
	const cache = runtimeCache.stats();
	const load = os.loadavg();

	return {
		mode: cfg.mode,
		rssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
		heapUsedMb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
		heapTotalMb: Math.round((mem.heapTotal / (1024 * 1024)) * 10) / 10,
		cpuCores: os.cpus().length || 1,
		loadAvg1m: Math.round((load[0] ?? 0) * 100) / 100,
		uptimeSeconds: Math.floor(process.uptime()),
		activeIoSlots,
		maxIoSlots: cfg.maxConcurrentIo,
		cacheEntries: cache.entries,
		cacheMaxEntries: cache.maxEntries,
		cacheHitRatePct: cache.hitRatePct,
		dbConnectionLimit: cfg.dbConnectionLimit
	};
}
