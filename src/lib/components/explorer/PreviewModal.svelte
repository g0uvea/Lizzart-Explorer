<script lang="ts">
	import type { StorageNode } from '$lib/types';
	import { formatBytes, formatDate, getFileCategory } from '$lib/utils';
	import { toast } from '$lib/stores/toast.svelte';
	import { X, Download, Copy, ExternalLink, FileCode2 } from 'lucide-svelte';

	interface Props {
		node: StorageNode;
		onClose: () => void;
	}

	let { node, onClose }: Props = $props();

	let category = $derived(getFileCategory(node.type, node.mime_type, node.name));
	let contentUrl = $derived(`/api/files/${node.id}/content`);
	let downloadUrl = $derived(`/api/files/${node.id}/content?download=1`);

	let textContent = $state<string | null>(null);
	let loadingText = $state(false);

	$effect(() => {
		if (category === 'code') {
			loadingText = true;
			textContent = null;
			fetch(contentUrl)
				.then((r) => r.text())
				.then((txt) => {
					textContent = txt.length > 250_000 ? txt.slice(0, 250_000) + '\n\n... [truncado para pré-visualização]' : txt;
				})
				.catch(() => {
					textContent = 'Não foi possível carregar o conteúdo do texto.';
				})
				.finally(() => {
					loadingText = false;
				});
		}
	});

	async function copyText() {
		if (!textContent) return;
		await navigator.clipboard.writeText(textContent);
		toast.success('Conteúdo copiado para a área de transferência!');
	}
</script>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
	role="dialog"
	aria-modal="true"
>
	<div class="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#233047] bg-[#111929] shadow-2xl">
		<!-- Header -->
		<div class="flex items-center justify-between gap-4 border-b border-[#1f2d45] px-5 py-3.5">
			<div class="min-w-0">
				<h3 class="truncate text-sm font-semibold text-white">{node.name}</h3>
				<p class="text-xs text-slate-400">
					{formatBytes(node.size_bytes)} • {node.mime_type || 'Arquivo'} • Atualizado em {formatDate(node.updated_at)}
				</p>
			</div>
			<div class="flex items-center gap-2">
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
					Abrir
				</a>
				<a
					href={downloadUrl}
					class="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
				>
					<Download class="h-3.5 w-3.5" />
					Baixar
				</a>
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
		<div class="flex-1 overflow-auto bg-[#0b101b] p-4">
			{#if category === 'image'}
				<div class="flex min-h-[300px] items-center justify-center">
					<img src={contentUrl} alt={node.name} class="max-h-[70vh] rounded-lg object-contain shadow-lg" />
				</div>
			{:else if category === 'video'}
				<video src={contentUrl} controls autoplay class="mx-auto max-h-[70vh] w-full rounded-lg bg-black">
					<track kind="captions" />
				</video>
			{:else if category === 'audio'}
				<div class="flex min-h-[200px] flex-col items-center justify-center gap-4 p-8">
					<p class="text-sm font-medium text-slate-200">{node.name}</p>
					<audio src={contentUrl} controls autoplay class="w-full max-w-lg"></audio>
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
					<p class="mt-1 text-xs text-slate-400">Baixe o arquivo para abri-lo no seu computador.</p>
					<a
						href={downloadUrl}
						class="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
					>
						<Download class="h-4 w-4" />
						Baixar {node.name}
					</a>
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
