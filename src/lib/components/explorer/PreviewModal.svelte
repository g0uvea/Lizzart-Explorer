<script lang="ts">
	import type { StorageNode } from '$lib/types';
	import { formatBytes, formatDate, getFileCategory } from '$lib/utils';
	import { toast } from '$lib/stores/toast.svelte';
	import { transferManager } from '$lib/stores/transfers.svelte';
	import {
		X,
		Download,
		Copy,
		ExternalLink,
		FileCode2,
		Crop,
		Play,
		Pause,
		Volume2,
		VolumeX,
		Maximize,
		ZoomIn,
		ZoomOut,
		Music
	} from 'lucide-svelte';

	interface Props {
		node: StorageNode;
		onClose: () => void;
		onRequestCrop?: (node: StorageNode) => void;
	}

	let { node, onClose, onRequestCrop }: Props = $props();

	let category = $derived(getFileCategory(node.type, node.mime_type, node.name));
	let isGif = $derived(
		(node.mime_type || '').toLowerCase() === 'image/gif' ||
			node.name.toLowerCase().endsWith('.gif')
	);
	let canCrop = $derived(category === 'image' && !isGif);
	let contentUrl = $derived(`/api/files/${node.id}/content?v=${encodeURIComponent(node.updated_at)}`);

	// Text viewer state
	let textContent = $state<string | null>(null);
	let loadingText = $state(false);

	// Image zoom
	let zoom = $state(1);

	// Custom Video / Audio player state
	let mediaEl = $state<HTMLVideoElement | HTMLAudioElement | null>(null);
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let volume = $state(1);
	let muted = $state(false);
	let playbackRate = $state(1);

	$effect(() => {
		zoom = 1;
		if (category === 'code') {
			loadingText = true;
			textContent = null;
			fetch(contentUrl)
				.then((r) => r.text())
				.then((txt) => {
					textContent =
						txt.length > 250_000
							? txt.slice(0, 250_000) + '\n\n... [truncado para pré-visualização]'
							: txt;
				})
				.catch(() => {
					textContent = 'Não foi possível carregar o conteúdo do texto.';
				})
				.finally(() => {
					loadingText = false;
				});
		}
	});

	function formatTime(sec: number): string {
		if (!Number.isFinite(sec) || sec < 0) return '00:00';
		const m = Math.floor(sec / 60);
		const s = Math.floor(sec % 60);
		return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}

	function togglePlay() {
		if (!mediaEl) return;
		if (mediaEl.paused) {
			mediaEl.play().catch(() => {});
		} else {
			mediaEl.pause();
		}
	}

	function seek(val: number) {
		if (!mediaEl) return;
		mediaEl.currentTime = val;
		currentTime = val;
	}

	function updateVolume(val: number) {
		volume = val;
		muted = val === 0;
		if (mediaEl) {
			mediaEl.volume = val;
			mediaEl.muted = muted;
		}
	}

	function toggleMute() {
		muted = !muted;
		if (mediaEl) mediaEl.muted = muted;
	}

	function setRate(r: number) {
		playbackRate = r;
		if (mediaEl) mediaEl.playbackRate = r;
	}

	function toggleFullscreen() {
		if (mediaEl && 'requestFullscreen' in mediaEl) {
			mediaEl.requestFullscreen().catch(() => {});
		}
	}

	function startDownload() {
		transferManager.enqueueDownload(node.id, node.name, node.size_bytes, node.mime_type);
	}

	async function copyText() {
		if (!textContent) return;
		await navigator.clipboard.writeText(textContent);
		toast.success('Conteúdo copiado para a área de transferência!');
	}
</script>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
	role="dialog"
	aria-modal="true"
>
	<div class="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#233047] bg-[#111929] shadow-2xl">
		<!-- Header -->
		<div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#1f2d45] px-5 py-3.5">
			<div class="min-w-0">
				<div class="flex items-center gap-2">
					<h3 class="truncate text-sm font-semibold text-white">{node.name}</h3>
					<span class="rounded bg-accent-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-300">
						Original
					</span>
				</div>
				<p class="text-xs text-slate-400">
					{formatBytes(node.size_bytes)} • {node.mime_type || 'Arquivo'} • {formatDate(node.updated_at)}
				</p>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				{#if category === 'image'}
					<div class="flex items-center rounded-lg border border-[#233047] bg-[#0b101b] p-0.5">
						<button
							type="button"
							onclick={() => (zoom = Math.max(0.5, Number((zoom - 0.25).toFixed(2))))}
							class="rounded p-1 text-slate-400 hover:text-white"
							title="Diminuir zoom"
						>
							<ZoomOut class="h-3.5 w-3.5" />
						</button>
						<span class="px-1.5 font-mono text-[11px] text-slate-300">{Math.round(zoom * 100)}%</span>
						<button
							type="button"
							onclick={() => (zoom = Math.min(3, Number((zoom + 0.25).toFixed(2))))}
							class="rounded p-1 text-slate-400 hover:text-white"
							title="Aumentar zoom"
						>
							<ZoomIn class="h-3.5 w-3.5" />
						</button>
					</div>
				{/if}

				{#if canCrop && onRequestCrop}
					<button
						type="button"
						onclick={() => onRequestCrop(node)}
						class="inline-flex items-center gap-1.5 rounded-lg border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-semibold text-accent-300 hover:bg-accent-500/25"
					>
						<Crop class="h-3.5 w-3.5" />
						Recortar Bordas
					</button>
				{/if}

				{#if category === 'code' && textContent !== null}
					<button
						type="button"
						onclick={copyText}
						class="inline-flex items-center gap-1.5 rounded-lg border border-[#233047] bg-[#182338] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#21304b]"
					>
						<Copy class="h-3.5 w-3.5" />
						Copiar
					</button>
				{/if}

				<a
					href={contentUrl}
					target="_blank"
					class="inline-flex items-center gap-1.5 rounded-lg border border-[#233047] bg-[#182338] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-[#21304b]"
				>
					<ExternalLink class="h-3.5 w-3.5" />
					Nova Aba
				</a>
				<button
					type="button"
					onclick={startDownload}
					class="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-500"
				>
					<Download class="h-3.5 w-3.5" />
					Baixar
				</button>
				<button
					type="button"
					onclick={onClose}
					class="rounded-lg p-1.5 text-slate-400 hover:bg-[#1b273d] hover:text-white"
					aria-label="Fechar"
				>
					<X class="h-4 w-4" />
				</button>
			</div>
		</div>

		<!-- Content -->
		<div class="flex-1 overflow-auto bg-[#080c14] p-4">
			{#if category === 'image'}
				<div class="flex min-h-[340px] items-center justify-center overflow-auto">
					<img
						src={contentUrl}
						alt={node.name}
						style="transform: scale({zoom}); transform-origin: center;"
						class="max-h-[68vh] rounded-lg object-contain shadow-2xl transition-transform duration-150"
					/>
				</div>
			{:else if category === 'video'}
				<div class="mx-auto flex max-w-4xl flex-col overflow-hidden rounded-xl border border-[#1f2d45] bg-black">
					<video
						bind:this={mediaEl}
						src={contentUrl}
						preload="metadata"
						onclick={togglePlay}
						onplay={() => (isPlaying = true)}
						onpause={() => (isPlaying = false)}
						ontimeupdate={() => (currentTime = mediaEl?.currentTime || 0)}
						onloadedmetadata={() => (duration = mediaEl?.duration || 0)}
						class="max-h-[62vh] w-full cursor-pointer bg-black"
					>
						<track kind="captions" />
					</video>

					<!-- Custom Lossless Video Controls -->
					<div class="space-y-2 border-t border-[#1f2d45] bg-[#0e1525] px-4 py-3">
						<input
							type="range"
							min="0"
							max={duration || 1}
							step="0.05"
							value={currentTime}
							oninput={(e) => seek(Number(e.currentTarget.value))}
							class="h-1.5 w-full cursor-pointer accent-accent-500"
						/>
						<div class="flex flex-wrap items-center justify-between gap-3 text-xs">
							<div class="flex items-center gap-3">
								<button
									type="button"
									onclick={togglePlay}
									class="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-600 text-white hover:bg-accent-500"
								>
									{#if isPlaying}
										<Pause class="h-4 w-4" />
									{:else}
										<Play class="h-4 w-4" />
									{/if}
								</button>
								<span class="font-mono text-slate-300">
									{formatTime(currentTime)} / {formatTime(duration)}
								</span>
							</div>

							<div class="flex items-center gap-3">
								<div class="flex items-center gap-1.5">
									<button type="button" onclick={toggleMute} class="text-slate-300 hover:text-white">
										{#if muted || volume === 0}
											<VolumeX class="h-4 w-4" />
										{:else}
											<Volume2 class="h-4 w-4" />
										{/if}
									</button>
									<input
										type="range"
										min="0"
										max="1"
										step="0.05"
										value={muted ? 0 : volume}
										oninput={(e) => updateVolume(Number(e.currentTarget.value))}
										class="w-20 accent-accent-500"
									/>
								</div>

								<select
									value={playbackRate}
									onchange={(e) => setRate(Number(e.currentTarget.value))}
									class="rounded-lg border border-[#233047] bg-[#0b101b] px-2 py-1 font-mono text-[11px] text-slate-200"
								>
									<option value={0.5}>0.5x</option>
									<option value={1}>1.0x</option>
									<option value={1.25}>1.25x</option>
									<option value={1.5}>1.5x</option>
									<option value={2}>2.0x</option>
								</select>

								<button
									type="button"
									onclick={toggleFullscreen}
									class="rounded-lg p-1.5 text-slate-300 hover:bg-[#19253c] hover:text-white"
									title="Tela cheia"
								>
									<Maximize class="h-4 w-4" />
								</button>
							</div>
						</div>
					</div>
				</div>
			{:else if category === 'audio'}
				<div class="mx-auto my-8 max-w-xl rounded-2xl border border-[#1f2d45] bg-[#111929] p-8 shadow-xl">
					<div class="mb-6 flex flex-col items-center text-center">
						<div
							class="mb-4 flex h-24 w-24 items-center justify-center rounded-3xl border border-accent-500/30 bg-accent-500/15 text-accent-400 shadow-lg {isPlaying
								? 'animate-pulse'
								: ''}"
						>
							<Music class="h-11 w-11" />
						</div>
						<p class="text-base font-semibold text-white break-all">{node.name}</p>
						<p class="mt-1 text-xs text-slate-400">Reprodução direta sem perda de qualidade ({node.mime_type})</p>
					</div>

					<audio
						bind:this={mediaEl}
						src={contentUrl}
						preload="metadata"
						onplay={() => (isPlaying = true)}
						onpause={() => (isPlaying = false)}
						ontimeupdate={() => (currentTime = mediaEl?.currentTime || 0)}
						onloadedmetadata={() => (duration = mediaEl?.duration || 0)}
						class="hidden"
					></audio>

					<input
						type="range"
						min="0"
						max={duration || 1}
						step="0.05"
						value={currentTime}
						oninput={(e) => seek(Number(e.currentTarget.value))}
						class="h-2 w-full cursor-pointer accent-accent-500"
					/>

					<div class="mt-3 flex items-center justify-between text-xs">
						<span class="font-mono text-slate-400">{formatTime(currentTime)}</span>
						<div class="flex items-center gap-3">
							<button
								type="button"
								onclick={togglePlay}
								class="flex h-11 w-11 items-center justify-center rounded-full bg-accent-600 text-white shadow-lg hover:bg-accent-500"
							>
								{#if isPlaying}
									<Pause class="h-5 w-5" />
								{:else}
									<Play class="h-5 w-5" />
								{/if}
							</button>
						</div>
						<span class="font-mono text-slate-400">{formatTime(duration)}</span>
					</div>

					<div class="mt-5 flex items-center justify-between border-t border-[#1f2d45] pt-4 text-xs">
						<div class="flex items-center gap-2">
							<button type="button" onclick={toggleMute} class="text-slate-300 hover:text-white">
								{#if muted || volume === 0}
									<VolumeX class="h-4 w-4" />
								{:else}
									<Volume2 class="h-4 w-4" />
								{/if}
							</button>
							<input
								type="range"
								min="0"
								max="1"
								step="0.05"
								value={muted ? 0 : volume}
								oninput={(e) => updateVolume(Number(e.currentTarget.value))}
								class="w-24 accent-accent-500"
							/>
						</div>
						<select
							value={playbackRate}
							onchange={(e) => setRate(Number(e.currentTarget.value))}
							class="rounded-lg border border-[#233047] bg-[#0b101b] px-2.5 py-1 font-mono text-xs text-slate-200"
						>
							<option value={0.75}>0.75x</option>
							<option value={1}>1.0x</option>
							<option value={1.25}>1.25x</option>
							<option value={1.5}>1.5x</option>
							<option value={2}>2.0x</option>
						</select>
					</div>
				</div>
			{:else if category === 'pdf'}
				<iframe src={contentUrl} title={node.name} class="h-[72vh] w-full rounded-lg border border-[#1f2d45]"></iframe>
			{:else if category === 'code'}
				{#if loadingText}
					<div class="flex items-center justify-center py-20 text-sm text-slate-400">
						Carregando arquivo de texto...
					</div>
				{:else}
					<pre class="overflow-x-auto rounded-xl border border-[#1f2d45] bg-[#0e1525] p-4 font-mono text-xs leading-relaxed text-slate-200">{textContent}</pre>
				{/if}
			{:else}
				<div class="flex flex-col items-center justify-center py-20 text-center">
					<FileCode2 class="mb-3 h-12 w-12 text-slate-500" />
					<p class="text-sm font-medium text-slate-200">Pré-visualização não suportada para este tipo de arquivo.</p>
					<p class="mt-1 text-xs text-slate-400">Baixe com chunks retomáveis preservando a qualidade original.</p>
					<button
						type="button"
						onclick={startDownload}
						class="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500"
					>
						<Download class="h-4 w-4" />
						Baixar {node.name}
					</button>
				</div>
			{/if}
		</div>

		{#if node.sha256}
			<div class="border-t border-[#1f2d45] bg-[#0e1525] px-5 py-2 text-[11px] font-mono text-slate-500">
				SHA-256: {node.sha256}
			</div>
		{/if}
	</div>
</div>
