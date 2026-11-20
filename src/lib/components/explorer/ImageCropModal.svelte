<script lang="ts">
	import type { StorageNode } from '$lib/types';
	import { toast } from '$lib/stores/toast.svelte';
	import { X, Crop, Sparkles, Save, CopyPlus, RotateCcw } from 'lucide-svelte';

	interface Props {
		node: StorageNode;
		onClose: () => void;
		onSaved: () => void;
	}

	let { node, onClose, onSaved }: Props = $props();

	let imgEl = $state<HTMLImageElement | null>(null);
	let containerEl = $state<HTMLDivElement | null>(null);

	let naturalW = $state(0);
	let naturalH = $state(0);
	let loaded = $state(false);
	let saving = $state(false);

	// Crop coordinates in natural image pixels
	let cropX = $state(0);
	let cropY = $state(0);
	let cropW = $state(0);
	let cropH = $state(0);

	// Drag state
	type DragMode = null | 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
	let dragMode = $state<DragMode>(null);
	let startClientX = 0;
	let startClientY = 0;
	let startCrop = { x: 0, y: 0, w: 0, h: 0 };

	// Threshold for auto black-border detection (0-255 luminance)
	let borderThreshold = $state(22);

	let imageUrl = $derived(`/api/files/${node.id}/content?t=${encodeURIComponent(node.updated_at)}`);

	function onImageLoad() {
		if (!imgEl) return;
		naturalW = imgEl.naturalWidth;
		naturalH = imgEl.naturalHeight;
		resetCrop();
		loaded = true;
	}

	function resetCrop() {
		cropX = 0;
		cropY = 0;
		cropW = naturalW;
		cropH = naturalH;
	}

	function applyAspect(ratio: number | null) {
		if (!naturalW || !naturalH) return;
		if (ratio === null) {
			resetCrop();
			return;
		}
		let w = naturalW;
		let h = Math.round(w / ratio);
		if (h > naturalH) {
			h = naturalH;
			w = Math.round(h * ratio);
		}
		cropW = Math.max(16, w);
		cropH = Math.max(16, h);
		cropX = Math.floor((naturalW - cropW) / 2);
		cropY = Math.floor((naturalH - cropH) / 2);
	}

	/** Automatically detects and trims black letterbox/pillarbox borders */
	function autoTrimBlackBorders() {
		if (!imgEl || !naturalW || !naturalH) return;
		const canvas = document.createElement('canvas');
		canvas.width = naturalW;
		canvas.height = naturalH;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		ctx.drawImage(imgEl, 0, 0);
		const { data } = ctx.getImageData(0, 0, naturalW, naturalH);

		const isDarkPixel = (x: number, y: number) => {
			const idx = (y * naturalW + x) * 4;
			const a = data[idx + 3];
			if (a < 15) return true; // transparent border
			const r = data[idx];
			const g = data[idx + 1];
			const b = data[idx + 2];
			return r <= borderThreshold && g <= borderThreshold && b <= borderThreshold;
		};

		// A row/col is considered border if >= 97% of sampled pixels are dark
		const rowIsBorder = (y: number) => {
			const step = Math.max(1, Math.floor(naturalW / 180));
			let total = 0;
			let dark = 0;
			for (let x = 0; x < naturalW; x += step) {
				total++;
				if (isDarkPixel(x, y)) dark++;
			}
			return dark / total >= 0.97;
		};

		const colIsBorder = (x: number) => {
			const step = Math.max(1, Math.floor(naturalH / 180));
			let total = 0;
			let dark = 0;
			for (let y = 0; y < naturalH; y += step) {
				total++;
				if (isDarkPixel(x, y)) dark++;
			}
			return dark / total >= 0.97;
		};

		let top = 0;
		while (top < naturalH - 16 && rowIsBorder(top)) top++;

		let bottom = naturalH - 1;
		while (bottom > top + 16 && rowIsBorder(bottom)) bottom--;

		let left = 0;
		while (left < naturalW - 16 && colIsBorder(left)) left++;

		let right = naturalW - 1;
		while (right > left + 16 && colIsBorder(right)) right--;

		cropX = left;
		cropY = top;
		cropW = Math.max(16, right - left + 1);
		cropH = Math.max(16, bottom - top + 1);

		if (cropX === 0 && cropY === 0 && cropW === naturalW && cropH === naturalH) {
			toast.info('Nenhuma borda preta detectada automaticamente.');
		} else {
			toast.success(`Bordas detectadas! Nova área: ${cropW} × ${cropH}px`);
		}
	}

	function startDrag(mode: DragMode, e: PointerEvent) {
		e.preventDefault();
		e.stopPropagation();
		dragMode = mode;
		startClientX = e.clientX;
		startClientY = e.clientY;
		startCrop = { x: cropX, y: cropY, w: cropW, h: cropH };
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragMode || !imgEl) return;
		const rect = imgEl.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;

		const scaleX = naturalW / rect.width;
		const scaleY = naturalH / rect.height;
		const dx = Math.round((e.clientX - startClientX) * scaleX);
		const dy = Math.round((e.clientY - startClientY) * scaleY);

		const minSize = 16;
		let { x, y, w, h } = startCrop;

		if (dragMode === 'move') {
			x = Math.max(0, Math.min(naturalW - w, x + dx));
			y = Math.max(0, Math.min(naturalH - h, y + dy));
		} else {
			if (dragMode.includes('w')) {
				const maxLeft = startCrop.x + startCrop.w - minSize;
				const nextX = Math.max(0, Math.min(maxLeft, startCrop.x + dx));
				w = startCrop.w + (startCrop.x - nextX);
				x = nextX;
			}
			if (dragMode.includes('e')) {
				w = Math.max(minSize, Math.min(naturalW - x, startCrop.w + dx));
			}
			if (dragMode.includes('n')) {
				const maxTop = startCrop.y + startCrop.h - minSize;
				const nextY = Math.max(0, Math.min(maxTop, startCrop.y + dy));
				h = startCrop.h + (startCrop.y - nextY);
				y = nextY;
			}
			if (dragMode.includes('s')) {
				h = Math.max(minSize, Math.min(naturalH - y, startCrop.h + dy));
			}
		}

		cropX = Math.round(x);
		cropY = Math.round(y);
		cropW = Math.round(w);
		cropH = Math.round(h);
	}

	function onPointerUp() {
		dragMode = null;
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', onPointerUp);
	}

	async function saveCropped(mode: 'copy' | 'replace') {
		if (!imgEl || !cropW || !cropH) return;
		saving = true;
		try {
			// Render at exact full native resolution without downscaling or lossy compression (PNG lossless)
			const canvas = document.createElement('canvas');
			canvas.width = cropW;
			canvas.height = cropH;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('Canvas indisponível');

			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(imgEl, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

			// Always use lossless PNG to guarantee zero quality loss on cropped output
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob((b) => resolve(b), 'image/png')
			);
			if (!blob) throw new Error('Falha ao gerar imagem PNG sem perda.');

			const form = new FormData();
			form.append('mode', mode);
			form.append('image', new File([blob], 'cropped.png', { type: 'image/png' }));

			const res = await fetch(`/api/files/${node.id}/image-edit`, {
				method: 'POST',
				body: form
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error || 'Erro ao salvar recorte.');
				return;
			}

			toast.success(
				mode === 'replace'
					? `Imagem atualizada sem perdas (${cropW}×${cropH}px)!`
					: `Cópia recortada salva: "${data.name}" (${cropW}×${cropH}px)!`
			);
			onSaved();
			onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Erro ao processar recorte.');
		} finally {
			saving = false;
		}
	}

	let pctLeft = $derived(naturalW ? (cropX / naturalW) * 100 : 0);
	let pctTop = $derived(naturalH ? (cropY / naturalH) * 100 : 0);
	let pctWidth = $derived(naturalW ? (cropW / naturalW) * 100 : 100);
	let pctHeight = $derived(naturalH ? (cropH / naturalH) * 100 : 100);
</script>

<div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm sm:p-4">
	<div class="flex max-h-[95dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#233047] bg-[#111929] shadow-2xl">
		<!-- Header -->
		<div class="flex items-center justify-between gap-2 border-b border-[#1f2d45] px-3.5 py-3 sm:px-5 sm:py-3.5">
			<div class="flex min-w-0 items-center gap-2.5">
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-500/15 text-accent-400">
					<Crop class="h-4 w-4" />
				</div>
				<div class="min-w-0">
					<h3 class="truncate text-sm font-semibold text-white">Recortar Bordas — {node.name}</h3>
					<p class="truncate text-[11px] text-slate-400">
						Exportação em PNG lossless (resolução nativa preservada)
					</p>
				</div>
			</div>
			<button
				type="button"
				onclick={onClose}
				class="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-[#1b273d] hover:text-white"
				aria-label="Fechar"
			>
				<X class="h-4 w-4" />
			</button>
		</div>

		<!-- Tools bar -->
		<div class="flex flex-wrap items-center justify-between gap-2 border-b border-[#1f2d45] bg-[#0e1525] px-3.5 py-2 text-xs sm:px-5 sm:py-2.5">
			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onclick={autoTrimBlackBorders}
					class="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 font-semibold text-white shadow hover:bg-accent-500"
				>
					<Sparkles class="h-3.5 w-3.5" />
					Remover Bordas Pretas
				</button>
				<label class="flex items-center gap-1.5 rounded-lg border border-[#233047] bg-[#0b101b] px-2.5 py-1 text-[11px] text-slate-300">
					Sensibilidade
					<input type="range" min="5" max="60" bind:value={borderThreshold} class="w-16 accent-accent-500" />
				</label>
				<button
					type="button"
					onclick={resetCrop}
					class="inline-flex items-center gap-1 rounded-lg border border-[#233047] px-2.5 py-1.5 text-slate-300 hover:bg-[#19253c]"
				>
					<RotateCcw class="h-3.5 w-3.5" /> Resetar
				</button>
			</div>

			<div class="flex flex-wrap items-center gap-1.5">
				<button type="button" onclick={() => applyAspect(null)} class="rounded-lg border border-[#233047] px-2 py-1 text-[11px] text-slate-300 hover:bg-[#19253c]">Livre</button>
				<button type="button" onclick={() => applyAspect(16 / 9)} class="rounded-lg border border-[#233047] px-2 py-1 text-[11px] text-slate-300 hover:bg-[#19253c]">16:9</button>
				<button type="button" onclick={() => applyAspect(4 / 3)} class="rounded-lg border border-[#233047] px-2 py-1 text-[11px] text-slate-300 hover:bg-[#19253c]">4:3</button>
				<button type="button" onclick={() => applyAspect(1)} class="rounded-lg border border-[#233047] px-2 py-1 text-[11px] text-slate-300 hover:bg-[#19253c]">1:1</button>
			</div>
		</div>

		<!-- Interactive Crop Stage -->
		<div
			bind:this={containerEl}
			class="relative flex flex-1 items-center justify-center overflow-hidden bg-[#080c14] p-6 select-none"
		>
			<div class="relative inline-block max-h-[56vh] max-w-full">
				<img
					bind:this={imgEl}
					src={imageUrl}
					alt={node.name}
					crossorigin="anonymous"
					onload={onImageLoad}
					draggable="false"
					class="block max-h-[56vh] max-w-full object-contain"
				/>

				{#if loaded}
					<!-- Dimmed exterior using 4 mask bars -->
					<div class="pointer-events-none absolute inset-x-0 top-0 bg-black/65" style="height: {pctTop}%"></div>
					<div class="pointer-events-none absolute inset-x-0 bottom-0 bg-black/65" style="height: {Math.max(0, 100 - pctTop - pctHeight)}%"></div>
					<div class="pointer-events-none absolute left-0 bg-black/65" style="top: {pctTop}%; height: {pctHeight}%; width: {pctLeft}%"></div>
					<div class="pointer-events-none absolute right-0 bg-black/65" style="top: {pctTop}%; height: {pctHeight}%; width: {Math.max(0, 100 - pctLeft - pctWidth)}%"></div>

					<!-- Crop Frame (touch-none ensures smooth touch dragging on mobile!) -->
					<div
						onpointerdown={(e) => startDrag('move', e)}
						role="presentation"
						class="absolute cursor-move touch-none border-2 border-accent-400 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
						style="left: {pctLeft}%; top: {pctTop}%; width: {pctWidth}%; height: {pctHeight}%"
					>
						<!-- Rule of thirds guides -->
						<div class="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/20"></div>
						<div class="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/20"></div>
						<div class="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/20"></div>
						<div class="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/20"></div>

						<!-- Edge & Corner Handles -->
						<div onpointerdown={(e) => startDrag('nw', e)} role="presentation" class="absolute -top-2 -left-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-accent-500"></div>
						<div onpointerdown={(e) => startDrag('ne', e)} role="presentation" class="absolute -top-2 -right-2 h-4 w-4 cursor-nesw-resize rounded-sm border-2 border-white bg-accent-500"></div>
						<div onpointerdown={(e) => startDrag('sw', e)} role="presentation" class="absolute -bottom-2 -left-2 h-4 w-4 cursor-nesw-resize rounded-sm border-2 border-white bg-accent-500"></div>
						<div onpointerdown={(e) => startDrag('se', e)} role="presentation" class="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-accent-500"></div>

						<div onpointerdown={(e) => startDrag('n', e)} role="presentation" class="absolute -top-1.5 left-1/2 h-3 w-8 -translate-x-1/2 cursor-ns-resize rounded-full bg-accent-400"></div>
						<div onpointerdown={(e) => startDrag('s', e)} role="presentation" class="absolute -bottom-1.5 left-1/2 h-3 w-8 -translate-x-1/2 cursor-ns-resize rounded-full bg-accent-400"></div>
						<div onpointerdown={(e) => startDrag('w', e)} role="presentation" class="absolute top-1/2 -left-1.5 h-8 w-3 -translate-y-1/2 cursor-ew-resize rounded-full bg-accent-400"></div>
						<div onpointerdown={(e) => startDrag('e', e)} role="presentation" class="absolute top-1/2 -right-1.5 h-8 w-3 -translate-y-1/2 cursor-ew-resize rounded-full bg-accent-400"></div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Footer -->
		<div class="flex flex-wrap items-center justify-between gap-3 border-t border-[#1f2d45] bg-[#0e1525] px-5 py-3.5">
			<div class="flex flex-wrap items-center gap-3 font-mono text-xs text-slate-400">
				<span>Original: <strong class="text-slate-200">{naturalW}×{naturalH}</strong></span>
				<span>Recorte: <strong class="text-accent-300">{cropW}×{cropH}px</strong></span>
				<span>Offset: ({cropX}, {cropY})</span>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onclick={onClose}
					class="rounded-xl border border-[#233047] px-3.5 py-2 text-xs text-slate-300 hover:bg-[#19253c]"
				>
					Cancelar
				</button>
				<button
					type="button"
					disabled={saving || !loaded}
					onclick={() => saveCropped('copy')}
					class="inline-flex items-center gap-1.5 rounded-xl border border-accent-500/40 bg-accent-500/15 px-4 py-2 text-xs font-semibold text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
				>
					<CopyPlus class="h-3.5 w-3.5" />
					Salvar como Cópia
				</button>
				{#if node.permission === 'owner' || node.permission === 'editor'}
					<button
						type="button"
						disabled={saving || !loaded}
						onclick={() => saveCropped('replace')}
						class="inline-flex items-center gap-1.5 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
					>
						<Save class="h-3.5 w-3.5" />
						{saving ? 'Salvando...' : 'Substituir Original'}
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>
