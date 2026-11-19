<script lang="ts">
	import { transferManager } from '$lib/stores/transfers.svelte';
	import { formatBytes } from '$lib/utils';
	import {
		Upload,
		Download,
		Pause,
		Play,
		X,
		CheckCircle2,
		AlertCircle,
		ChevronDown,
		ChevronUp,
		RefreshCw
	} from 'lucide-svelte';

	let activeCount = $derived(
		transferManager.items.filter((i) => i.status === 'active' || i.status === 'retrying' || i.status === 'queued').length
	);
</script>

{#if transferManager.items.length > 0}
	<div class="fixed right-4 bottom-4 z-50 w-full max-w-sm overflow-hidden rounded-2xl border border-[#233047] bg-[#111929]/95 shadow-2xl backdrop-blur-xl">
		<!-- Header -->
		<div class="flex items-center justify-between border-b border-[#1f2d45] bg-[#0e1525] px-4 py-2.5">
			<div class="flex items-center gap-2 text-xs font-semibold text-white">
				{#if activeCount > 0}
					<span class="h-2 w-2 animate-pulse rounded-full bg-accent-400"></span>
					<span>Transferindo ({activeCount})</span>
				{:else}
					<CheckCircle2 class="h-4 w-4 text-accent-400" />
					<span>Transferências ({transferManager.items.length})</span>
				{/if}
			</div>
			<div class="flex items-center gap-1">
				<button
					type="button"
					onclick={() => transferManager.clearFinished()}
					class="rounded px-2 py-0.5 text-[11px] text-slate-400 hover:bg-[#1a263e] hover:text-white"
				>
					Limpar
				</button>
				<button
					type="button"
					onclick={() => (transferManager.minimized = !transferManager.minimized)}
					class="rounded p-1 text-slate-400 hover:bg-[#1a263e] hover:text-white"
					aria-label="Minimizar"
				>
					{#if transferManager.minimized}
						<ChevronUp class="h-4 w-4" />
					{:else}
						<ChevronDown class="h-4 w-4" />
					{/if}
				</button>
			</div>
		</div>

		{#if !transferManager.minimized}
			<div class="max-h-72 divide-y divide-[#1a253a] overflow-y-auto">
				{#each transferManager.items as item (item.id)}
					{@const pct = item.totalBytes > 0 ? Math.min(100, Math.round((item.transferredBytes / item.totalBytes) * 100)) : item.status === 'done' ? 100 : 0}
					<div class="p-3.5">
						<div class="flex items-start justify-between gap-2">
							<div class="flex min-w-0 items-center gap-2">
								{#if item.kind === 'upload'}
									<Upload class="h-3.5 w-3.5 shrink-0 text-accent-400" />
								{:else}
									<Download class="h-3.5 w-3.5 shrink-0 text-sky-400" />
								{/if}
								<p class="truncate text-xs font-medium text-white" title={item.fileName}>
									{item.fileName}
								</p>
							</div>
							<div class="flex shrink-0 items-center gap-1">
								{#if item.status === 'active' || item.status === 'retrying'}
									<button
										type="button"
										onclick={() => transferManager.pause(item.id)}
										class="rounded p-1 text-slate-400 hover:bg-[#1e2c44] hover:text-white"
										title="Pausar"
									>
										<Pause class="h-3.5 w-3.5" />
									</button>
								{:else if item.status === 'paused' || item.status === 'error'}
									<button
										type="button"
										onclick={() => transferManager.resume(item.id)}
										class="rounded p-1 text-accent-400 hover:bg-accent-500/20"
										title="Retomar"
									>
										<Play class="h-3.5 w-3.5" />
									</button>
								{/if}
								<button
									type="button"
									onclick={() => transferManager.cancel(item.id)}
									class="rounded p-1 text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
									title="Remover"
								>
									<X class="h-3.5 w-3.5" />
								</button>
							</div>
						</div>

						<!-- Progress bar -->
						<div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#0b101b]">
							<div
								class="h-full rounded-full transition-all duration-200 {item.status === 'error'
									? 'bg-rose-500'
									: item.status === 'paused'
										? 'bg-amber-500'
										: 'bg-accent-500'}"
								style="width: {pct}%"
							></div>
						</div>

						<!-- Meta line -->
						<div class="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-400">
							<span>
								{formatBytes(item.transferredBytes)} / {formatBytes(item.totalBytes)} ({pct}%)
							</span>
							<span class="flex items-center gap-1.5 font-mono">
								{#if item.status === 'active'}
									<span class="text-accent-300">{formatBytes(item.speedBps)}/s</span>
									<span class="rounded bg-[#1a263e] px-1 text-slate-300" title="Tamanho dinâmico do chunk">
										{Math.round(item.chunkSizeBytes / (1024 * 1024))}MB
									</span>
								{:else if item.status === 'retrying'}
									<span class="inline-flex items-center gap-1 text-amber-300">
										<RefreshCw class="h-2.5 w-2.5 animate-spin" /> Reconectando...
									</span>
								{:else if item.status === 'paused'}
									<span class="text-amber-300">Pausado</span>
								{:else if item.status === 'done'}
									<span class="text-accent-400">Concluído</span>
								{:else if item.status === 'error'}
									<span class="inline-flex items-center gap-1 text-rose-400">
										<AlertCircle class="h-2.5 w-2.5" /> Erro
									</span>
								{/if}
							</span>
						</div>

						{#if item.errorMessage}
							<p class="mt-1 text-[10px] text-rose-300">{item.errorMessage}</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
