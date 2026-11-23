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
		Music,
		Repeat,
		Info,
		Check
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

	// Additional file info popover (houses SHA-256 & technical metadata)
	let showExtraInfo = $state(false);
	let shaCopied = $state(false);

	// Text viewer state
	let textContent = $state<string | null>(null);
	let loadingText = $state(false);

	// Image zoom
	let zoom = $state(1);

	// Custom Video / Audio player state
	let mediaEl = $state<HTMLVideoElement | HTMLAudioElement | null>(null);
	let videoStageEl = $state<HTMLDivElement | null>(null);
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let volume = $state(1);
	let muted = $state(false);
	let playbackRate = $state(1);
	let isLooping = $state(false);

	$effect(() => {
		zoom = 1;
		showExtraInfo = false;
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
		const hrs = Math.floor(sec / 3600);
		const m = Math.floor((sec % 3600) / 60);
		const s = Math.floor(sec % 60);
		if (hrs > 0) {
			return `${hrs}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
		}
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

	function toggleLoop() {
		isLooping = !isLooping;
		if (mediaEl) mediaEl.loop = isLooping;
	}

	function toggleFullscreen() {
		if (document.fullscreenElement) {
			document.exitFullscreen().catch(() => {});
			return;
		}
		if (mediaEl && 'requestFullscreen' in mediaEl) {
			mediaEl.requestFullscreen().catch(() => {
				videoStageEl?.requestFullscreen?.().catch(() => {});
			});
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

	async function copySha256() {
		if (!node.sha256) return;
		await navigator.clipboard.writeText(node.sha256);
		shaCopied = true;
		toast.success('Hash SHA-256 copiado!');
		setTimeout(() => (shaCopied = false), 2000);
	}
</script>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-2 sm:p-4"
	role="dialog"
	aria-modal="true"
>
	<div class="relative flex max-h-[95dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#233047] bg-[#111929] shadow-2xl">
		<!-- HEADER: Title + File Info (with Additional Info dropdown containing SHA-256) + New Tab + Download + Close -->
		<div class="relative flex flex-col gap-2.5 border-b border-[#1f2d45] bg-[#111929] px-3.5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-5 sm:py-3.5">
			<div class="flex min-w-0 items-start justify-between gap-2 sm:flex-1">
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<h3 class="truncate text-sm font-semibold text-white sm:text-base">{node.name}</h3>
						<span class="shrink-0 rounded bg-accent-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-300">
							Original
						</span>
						<button
							type="button"
							onclick={() => (showExtraInfo = !showExtraInfo)}
							class="inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-medium transition {showExtraInfo
								? 'border-accent-500/50 bg-accent-500/15 text-accent-300'
								: 'border-[#233047] bg-[#0b101b] text-slate-400 hover:border-slate-600 hover:text-white'}"
							title="Informações adicionais do arquivo (SHA-256)"
						>
							<Info class="h-3 w-3" />
							<span class="hidden xs:inline">Informações adicionais</span>
						</button>
					</div>
					<p class="mt-0.5 truncate text-[11px] text-slate-400 sm:text-xs">
						{formatBytes(node.size_bytes)} • {node.mime_type || 'Arquivo'} • {formatDate(node.updated_at)}
					</p>
				</div>
				<button
					type="button"
					onclick={onClose}
					class="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-[#1b273d] hover:text-white sm:hidden"
					aria-label="Fechar"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="flex flex-wrap items-center gap-1.5 sm:gap-2">
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
					class="hidden rounded-lg p-1.5 text-slate-400 hover:bg-[#1b273d] hover:text-white sm:inline-flex"
					aria-label="Fechar"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Collapsible Additional Information Drawer (houses SHA-256 & metadata) -->
			{#if showExtraInfo}
				<div class="w-full rounded-xl border border-[#233047] bg-[#0b101b] p-3 text-xs text-slate-300">
					<div class="mb-2 flex items-center justify-between">
						<span class="font-semibold text-white">Informações Adicionais do Arquivo</span>
						<button
							type="button"
							onclick={() => (showExtraInfo = false)}
							class="text-[11px] text-slate-400 hover:text-white"
						>
							Ocultar
						</button>
					</div>
					<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
						<div>
							<span class="block text-[10px] uppercase tracking-wider text-slate-500">Tipo MIME</span>
							<span class="font-mono text-xs text-slate-200">{node.mime_type || 'application/octet-stream'}</span>
						</div>
						<div>
							<span class="block text-[10px] uppercase tracking-wider text-slate-500">Tamanho Exato</span>
							<span class="font-mono text-xs text-slate-200">{formatBytes(node.size_bytes)} ({node.size_bytes.toLocaleString()} bytes)</span>
						</div>
						<div>
							<span class="block text-[10px] uppercase tracking-wider text-slate-500">Modificado em</span>
							<span class="font-mono text-xs text-slate-200">{formatDate(node.updated_at)}</span>
						</div>
					</div>
					{#if node.sha256}
						<div class="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-[#1f2d45] pt-2">
							<div class="min-w-0 flex-1">
								<span class="block text-[10px] uppercase tracking-wider text-slate-500">Integridade SHA-256</span>
								<code class="select-text block break-all font-mono text-[11px] text-accent-300">{node.sha256}</code>
							</div>
							<button
								type="button"
								onclick={copySha256}
								class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#233047] bg-[#131c2e] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-[#19253c]"
							>
								{#if shaCopied}
									<Check class="h-3 w-3 text-accent-400" /> Copiado
								{:else}
									<Copy class="h-3 w-3" /> Copiar Hash
								{/if}
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- CENTER BODY & FOOTER -->
		{#if category === 'video'}
			<!-- Edge-to-edge 16:9 Video Center Stage (no inner padding/borders around the video) -->
			<div
				bind:this={videoStageEl}
				class="relative flex aspect-video max-h-[74dvh] w-full items-center justify-center overflow-hidden bg-black"
			>
				<video
					bind:this={mediaEl}
					src={contentUrl}
					preload="metadata"
					loop={isLooping}
					onclick={togglePlay}
					onplay={() => (isPlaying = true)}
					onpause={() => (isPlaying = false)}
					ontimeupdate={() => (currentTime = mediaEl?.currentTime || 0)}
					onloadedmetadata={() => (duration = mediaEl?.duration || 0)}
					class="h-full w-full cursor-pointer object-contain"
				>
					<track kind="captions" />
				</video>
			</div>

			<!-- MODAL FOOTER: Video Player Controls (Play/Pause, Time, Progress Bar, Volume, Speed, Loop, Fullscreen) -->
			<div class="border-t border-[#1f2d45] bg-[#0e1525] px-4 py-3 sm:px-5">
				<!-- Progress Scrub Bar -->
				<input
					type="range"
					min="0"
					max={duration || 1}
					step="0.05"
					value={currentTime}
					oninput={(e) => seek(Number(e.currentTarget.value))}
					class="mb-2.5 block h-1.5 w-full cursor-pointer accent-accent-500"
					aria-label="Progresso do vídeo"
				/>

				<div class="flex flex-wrap items-center justify-between gap-3 text-xs">
					<!-- Left: Play/Pause & Timestamp -->
					<div class="flex items-center gap-3">
						<button
							type="button"
							onclick={togglePlay}
							class="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-600 text-white shadow hover:bg-accent-500"
							title={isPlaying ? 'Pausar' : 'Reproduzir'}
							aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
						>
							{#if isPlaying}
								<Pause class="h-4 w-4" />
							{:else}
								<Play class="ml-0.5 h-4 w-4" />
							{/if}
						</button>
						<span class="font-mono text-xs text-slate-200">
							{formatTime(currentTime)} <span class="text-slate-500">/</span> {formatTime(duration)}
						</span>
					</div>

					<!-- Right: Volume, Speed, Loop Toggle & Fullscreen -->
					<div class="flex flex-wrap items-center gap-2.5 sm:gap-3.5">
						<!-- Volume -->
						<div class="flex items-center gap-2">
							<button
								type="button"
								onclick={toggleMute}
								class="rounded-lg p-1.5 text-slate-300 hover:bg-[#19253c] hover:text-white"
								title={muted || volume === 0 ? 'Ativar som' : 'Silenciar'}
							>
								{#if muted || volume === 0}
									<VolumeX class="h-4 w-4 text-rose-400" />
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
								class="w-20 cursor-pointer accent-accent-500 sm:w-24"
								aria-label="Volume"
							/>
						</div>

						<!-- Speed selector -->
						<select
							value={playbackRate}
							onchange={(e) => setRate(Number(e.currentTarget.value))}
							class="rounded-xl border border-[#233047] bg-[#0b101b] px-2.5 py-1.5 font-mono text-xs text-slate-200 outline-none focus:border-accent-500"
							title="Velocidade de reprodução"
						>
							<option value={0.5}>0.5x</option>
							<option value={0.75}>0.75x</option>
							<option value={1}>1.0x</option>
							<option value={1.25}>1.25x</option>
							<option value={1.5}>1.5x</option>
							<option value={2}>2.0x</option>
						</select>

						<!-- Loop toggle -->
						<button
							type="button"
							onclick={toggleLoop}
							class="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition {isLooping
								? 'border-accent-500/50 bg-accent-500/20 text-accent-300'
								: 'border-[#233047] bg-[#0b101b] text-slate-400 hover:bg-[#19253c] hover:text-white'}"
							title={isLooping ? 'Looping ativado' : 'Ativar looping no vídeo'}
							aria-pressed={isLooping}
						>
							<Repeat class="h-3.5 w-3.5" />
							<span class="hidden sm:inline">Loop</span>
						</button>

						<!-- Fullscreen -->
						<button
							type="button"
							onclick={toggleFullscreen}
							class="rounded-xl border border-[#233047] bg-[#0b101b] p-2 text-slate-300 hover:bg-[#19253c] hover:text-white"
							title="Tela cheia"
							aria-label="Tela cheia"
						>
							<Maximize class="h-4 w-4" />
						</button>
					</div>
				</div>
			</div>
		{:else}
			<!-- Non-video content preview area -->
			<div class="flex-1 overflow-auto bg-[#080c14] p-4">
				{#if category === 'image'}
					<div class="flex min-h-[340px] items-center justify-center overflow-auto">
						<img
							src={contentUrl}
							alt={node.name}
							style="transform: scale({zoom}); transform-origin: center;"
							class="max-h-[72vh] rounded-lg object-contain shadow-2xl transition-transform duration-150"
						/>
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
							loop={isLooping}
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

						<div class="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[#1f2d45] pt-4 text-xs">
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
							<div class="flex items-center gap-2">
								<button
									type="button"
									onclick={toggleLoop}
									class="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs {isLooping
										? 'border-accent-500/50 bg-accent-500/20 text-accent-300'
										: 'border-[#233047] bg-[#0b101b] text-slate-400'}"
								>
									<Repeat class="h-3.5 w-3.5" /> Loop
								</button>
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
					</div>
				{:else if category === 'pdf'}
					<iframe src={contentUrl} title={node.name} class="h-[74vh] w-full rounded-lg border border-[#1f2d45]"></iframe>
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
		{/if}
	</div>
</div>
