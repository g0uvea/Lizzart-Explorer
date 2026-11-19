<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import type { BreadcrumbItem, StorageNode } from '$lib/types';
	import { quotaStore } from '$lib/stores/quota.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatBytes, formatDate, getFileCategory, isPreviewable } from '$lib/utils';
	import FileIcon from '$lib/components/explorer/FileIcon.svelte';
	import PreviewModal from '$lib/components/explorer/PreviewModal.svelte';
	import ShareModal from '$lib/components/explorer/ShareModal.svelte';
	import MoveModal from '$lib/components/explorer/MoveModal.svelte';
	import {
		Upload,
		FolderPlus,
		Search,
		LayoutGrid,
		List,
		ChevronRight,
		Star,
		Download,
		Share2,
		Pencil,
		FolderInput,
		Copy,
		Trash2,
		RotateCcw,
		Eye,
		ArrowUpDown,
		Users,
		Link2,
		X,
		CloudUpload,
		FolderOpen
	} from 'lucide-svelte';

	let view = $derived($page.url.searchParams.get('view') || 'drive');
	let parentId = $derived($page.url.searchParams.get('folder') || null);

	let nodes = $state<StorageNode[]>([]);
	let breadcrumbs = $state<BreadcrumbItem[]>([]);
	let currentPermission = $state<'owner' | 'editor' | 'viewer'>('owner');
	let loading = $state(true);

	let searchQuery = $state('');
	let debouncedSearch = $state('');
	let displayMode = $state<'grid' | 'list'>('grid');
	let sortBy = $state<'name' | 'date' | 'size'>('name');
	let sortDir = $state<'asc' | 'desc'>('asc');

	// Upload state
	let fileInputEl = $state<HTMLInputElement | null>(null);
	let dragOver = $state(false);
	let uploading = $state(false);
	let uploadProgress = $state(0);
	let uploadLabel = $state('');

	// Modals state
	let previewNode = $state<StorageNode | null>(null);
	let shareNode = $state<StorageNode | null>(null);
	let moveNode = $state<StorageNode | null>(null);

	let showNewFolderModal = $state(false);
	let newFolderName = $state('');

	let renameNode = $state<StorageNode | null>(null);
	let renameValue = $state('');

	// Debounce search
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	function handleSearchInput(val: string) {
		searchQuery = val;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			debouncedSearch = val.trim();
		}, 260);
	}

	async function loadNodes() {
		loading = true;
		try {
			const params = new URLSearchParams();
			params.set('view', view);
			if (parentId) params.set('parentId', parentId);
			if (debouncedSearch) params.set('search', debouncedSearch);
			params.set('sort', sortBy);
			params.set('dir', sortDir);

			const res = await fetch(`/api/files?${params.toString()}`);
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error || 'Erro ao carregar arquivos.');
				return;
			}
			nodes = data.nodes;
			breadcrumbs = data.breadcrumbs;
			currentPermission = data.currentPermission || 'owner';
			if (data.quota) {
				quotaStore.sync(data.quota.used_bytes, data.quota.quota_bytes);
			}
		} catch {
			toast.error('Erro de conexão ao listar arquivos.');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		// Re-run whenever URL view/folder, search or sort changes
		void view;
		void parentId;
		void debouncedSearch;
		void sortBy;
		void sortDir;
		loadNodes();
	});

	let canWriteHere = $derived(
		!debouncedSearch &&
			(view === 'drive' || (view === 'shared' && Boolean(parentId))) &&
			(currentPermission === 'owner' || currentPermission === 'editor')
	);

	function openFolder(folderId: string | null) {
		searchQuery = '';
		debouncedSearch = '';
		const params = new URLSearchParams();
		if (view !== 'drive') params.set('view', view);
		if (folderId) params.set('folder', folderId);
		const qs = params.toString();
		goto(qs ? `/?${qs}` : '/');
	}

	function handleNodeDoubleClick(node: StorageNode) {
		if (node.is_trashed) return;
		if (node.type === 'folder') {
			openFolder(node.id);
		} else {
			previewNode = node;
		}
	}

	async function createFolder(e: SubmitEvent) {
		e.preventDefault();
		if (!newFolderName.trim()) return;
		const res = await fetch('/api/files/folder', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: newFolderName.trim(), parentId })
		});
		const data = await res.json();
		if (!res.ok) {
			toast.error(data.error || 'Erro ao criar pasta.');
			return;
		}
		toast.success(`Pasta "${data.node.name}" criada!`);
		newFolderName = '';
		showNewFolderModal = false;
		await loadNodes();
	}

	function uploadFiles(fileList: FileList | File[]) {
		const files = Array.from(fileList);
		if (files.length === 0) return;

		if (!canWriteHere) {
			toast.warning('Navegue para Meu Drive ou uma pasta com permissão de Editor para fazer upload.');
			return;
		}

		const formData = new FormData();
		if (parentId) formData.append('parentId', parentId);
		for (const f of files) {
			formData.append('files', f);
		}

		uploading = true;
		uploadProgress = 0;
		uploadLabel = files.length === 1 ? files[0].name : `${files.length} arquivos`;

		const xhr = new XMLHttpRequest();
		xhr.open('POST', '/api/files/upload');

		xhr.upload.onprogress = (ev) => {
			if (ev.lengthComputable) {
				uploadProgress = Math.round((ev.loaded / ev.total) * 100);
			}
		};

		xhr.onload = async () => {
			uploading = false;
			try {
				const resp = JSON.parse(xhr.responseText);
				if (xhr.status >= 200 && xhr.status < 300) {
					toast.success(
						files.length === 1
							? `"${files[0].name}" enviado com sucesso!`
							: `${files.length} arquivos enviados com sucesso!`
					);
					await loadNodes();
				} else {
					toast.error(resp.error || 'Falha no upload.');
				}
			} catch {
				toast.error('Erro inesperado ao processar resposta do upload.');
			}
		};

		xhr.onerror = () => {
			uploading = false;
			toast.error('Erro de rede durante o upload.');
		};

		xhr.send(formData);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (e.dataTransfer?.files?.length) {
			uploadFiles(e.dataTransfer.files);
		}
	}

	async function toggleStar(node: StorageNode) {
		const next = !node.is_starred;
		const res = await fetch(`/api/files/${node.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ is_starred: next })
		});
		if (res.ok) {
			node.is_starred = next;
			toast.info(next ? 'Adicionado aos favoritos.' : 'Removido dos favoritos.');
			if (view === 'starred') await loadNodes();
		}
	}

	async function submitRename(e: SubmitEvent) {
		e.preventDefault();
		if (!renameNode || !renameValue.trim()) return;
		const res = await fetch(`/api/files/${renameNode.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: renameValue.trim() })
		});
		const data = await res.json();
		if (!res.ok) {
			toast.error(data.error || 'Falha ao renomear.');
			return;
		}
		toast.success('Item renomeado!');
		renameNode = null;
		await loadNodes();
	}

	async function copyFile(node: StorageNode) {
		const res = await fetch(`/api/files/${node.id}/copy`, { method: 'POST' });
		const data = await res.json();
		if (!res.ok) {
			toast.error(data.error || 'Falha ao duplicar arquivo.');
			return;
		}
		toast.success(`Cópia criada: "${data.name}"`);
		await loadNodes();
	}

	async function trashNode(node: StorageNode) {
		const res = await fetch(`/api/files/${node.id}`, { method: 'DELETE' });
		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			toast.error(data.error || 'Não foi possível mover para a lixeira.');
			return;
		}
		toast.info(`"${node.name}" movido para a lixeira.`);
		await loadNodes();
	}

	async function restoreNode(node: StorageNode) {
		const res = await fetch(`/api/files/${node.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ restore: true })
		});
		if (res.ok) {
			toast.success(`"${node.name}" restaurado!`);
			await loadNodes();
		}
	}

	async function deletePermanent(node: StorageNode) {
		if (!confirm(`Excluir permanentemente "${node.name}"? Esta ação não pode ser desfeita.`)) {
			return;
		}
		const res = await fetch(`/api/files/${node.id}?permanent=true`, { method: 'DELETE' });
		if (res.ok) {
			toast.success(`"${node.name}" excluído permanentemente do disco.`);
			await loadNodes();
		}
	}

	async function emptyTrash() {
		if (!confirm('Esvaziar toda a lixeira e apagar os arquivos permanentemente do disco?')) {
			return;
		}
		const res = await fetch('/api/files/trash/empty', { method: 'POST' });
		if (res.ok) {
			toast.success('Lixeira esvaziada com sucesso!');
			await loadNodes();
		}
	}

	function toggleSort(col: 'name' | 'date' | 'size') {
		if (sortBy === col) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortBy = col;
			sortDir = col === 'name' ? 'asc' : 'desc';
		}
	}
</script>

<svelte:head>
	<title>Explorador — Lizzart Explorer</title>
</svelte:head>

<div
	class="relative flex min-h-full flex-col p-4 sm:p-6 lg:p-8"
	ondragover={(e) => {
		e.preventDefault();
		if (canWriteHere) dragOver = true;
	}}
	ondragleave={(e) => {
		if (e.currentTarget === e.target) dragOver = false;
	}}
	ondrop={onDrop}
	role="region"
	aria-label="Explorador de arquivos"
>
	<!-- Drag overlay -->
	{#if dragOver}
		<div
			class="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center bg-indigo-950/75 backdrop-blur-sm"
		>
			<div class="flex flex-col items-center rounded-3xl border-2 border-dashed border-indigo-400 bg-[#131c2e]/95 px-14 py-12 text-center shadow-2xl">
				<CloudUpload class="mb-4 h-16 w-16 text-indigo-400" />
				<h2 class="text-xl font-bold text-white">Solte seus arquivos aqui</h2>
				<p class="mt-1 text-sm text-slate-300">O upload começará automaticamente para a pasta atual</p>
			</div>
		</div>
	{/if}

	<!-- Hidden File Input -->
	<input
		bind:this={fileInputEl}
		type="file"
		multiple
		class="hidden"
		onchange={(e) => {
			const input = e.currentTarget;
			if (input.files) uploadFiles(input.files);
			input.value = '';
		}}
	/>

	<!-- Top Header & Actions -->
	<div class="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
		<!-- Search -->
		<div class="relative w-full max-w-md">
			<Search class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
			<input
				type="text"
				value={searchQuery}
				oninput={(e) => handleSearchInput(e.currentTarget.value)}
				placeholder="Buscar arquivos e pastas..."
				class="w-full rounded-xl border border-[#1f2d45] bg-[#131c2e] py-2.5 pr-9 pl-10 text-sm text-white placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
			/>
			{#if searchQuery}
				<button
					type="button"
					onclick={() => handleSearchInput('')}
					class="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-white"
				>
					<X class="h-3.5 w-3.5" />
				</button>
			{/if}
		</div>

		<!-- Action buttons -->
		<div class="flex flex-wrap items-center gap-2.5">
			{#if canWriteHere}
				<button
					type="button"
					onclick={() => fileInputEl?.click()}
					class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-500"
				>
					<Upload class="h-4 w-4" />
					Upload
				</button>
				<button
					type="button"
					onclick={() => {
						newFolderName = '';
						showNewFolderModal = true;
					}}
					class="inline-flex items-center gap-2 rounded-xl border border-[#233047] bg-[#131c2e] px-3.5 py-2.5 text-sm font-medium text-slate-200 transition hover:border-indigo-500/40 hover:bg-[#19253c]"
				>
					<FolderPlus class="h-4 w-4 text-indigo-400" />
					Nova Pasta
				</button>
			{/if}

			{#if view === 'trash' && nodes.length > 0}
				<button
					type="button"
					onclick={emptyTrash}
					class="inline-flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/15 px-4 py-2.5 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/25"
				>
					<Trash2 class="h-4 w-4" />
					Esvaziar Lixeira
				</button>
			{/if}

			<!-- View switcher -->
			<div class="ml-auto flex items-center rounded-xl border border-[#1f2d45] bg-[#131c2e] p-1">
				<button
					type="button"
					onclick={() => (displayMode = 'grid')}
					class="rounded-lg p-1.5 transition {displayMode === 'grid'
						? 'bg-[#22304c] text-white'
						: 'text-slate-400 hover:text-slate-200'}"
					title="Visualização em Grade"
				>
					<LayoutGrid class="h-4 w-4" />
				</button>
				<button
					type="button"
					onclick={() => (displayMode = 'list')}
					class="rounded-lg p-1.5 transition {displayMode === 'list'
						? 'bg-[#22304c] text-white'
						: 'text-slate-400 hover:text-slate-200'}"
					title="Visualização em Lista"
				>
					<List class="h-4 w-4" />
				</button>
			</div>
		</div>
	</div>

	<!-- Breadcrumbs & Sort Bar -->
	<div class="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[#1a253a] pb-3.5">
		<div class="flex flex-wrap items-center gap-1 text-sm">
			{#each breadcrumbs as crumb, idx (crumb.id ?? 'root-' + idx)}
				{#if idx > 0}
					<ChevronRight class="h-4 w-4 text-slate-600" />
				{/if}
				<button
					type="button"
					onclick={() => openFolder(crumb.id)}
					class="rounded-lg px-2 py-1 font-medium transition {idx === breadcrumbs.length - 1
						? 'text-white'
						: 'text-slate-400 hover:bg-[#131c2e] hover:text-slate-200'}"
				>
					{crumb.name}
				</button>
			{/each}
		</div>

		<div class="flex items-center gap-1.5 text-xs text-slate-400">
			<span>Ordenar:</span>
			<button
				type="button"
				onclick={() => toggleSort('name')}
				class="inline-flex items-center gap-1 rounded-lg px-2 py-1 transition {sortBy === 'name'
					? 'bg-[#19253c] text-indigo-300'
					: 'hover:bg-[#131c2e] hover:text-slate-200'}"
			>
				Nome <ArrowUpDown class="h-3 w-3" />
			</button>
			<button
				type="button"
				onclick={() => toggleSort('date')}
				class="inline-flex items-center gap-1 rounded-lg px-2 py-1 transition {sortBy === 'date'
					? 'bg-[#19253c] text-indigo-300'
					: 'hover:bg-[#131c2e] hover:text-slate-200'}"
			>
				Data <ArrowUpDown class="h-3 w-3" />
			</button>
			<button
				type="button"
				onclick={() => toggleSort('size')}
				class="inline-flex items-center gap-1 rounded-lg px-2 py-1 transition {sortBy === 'size'
					? 'bg-[#19253c] text-indigo-300'
					: 'hover:bg-[#131c2e] hover:text-slate-200'}"
			>
				Tamanho <ArrowUpDown class="h-3 w-3" />
			</button>
		</div>
	</div>

	<!-- Upload Progress Banner -->
	{#if uploading}
		<div class="mb-5 rounded-xl border border-indigo-500/30 bg-[#131c2e] p-4 shadow-lg">
			<div class="mb-2 flex items-center justify-between text-xs">
				<span class="font-medium text-indigo-200">Enviando {uploadLabel}...</span>
				<span class="font-mono text-indigo-300">{uploadProgress}%</span>
			</div>
			<div class="h-2 overflow-hidden rounded-full bg-[#0b101b]">
				<div
					class="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-150"
					style="width: {uploadProgress}%"
				></div>
			</div>
		</div>
	{/if}

	<!-- Content Area -->
	{#if loading}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
			{#each Array(8) as _, i (i)}
				<div class="h-36 animate-pulse rounded-2xl border border-[#1a253a] bg-[#131c2e]/60"></div>
			{/each}
		</div>
	{:else if nodes.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-[#233047] bg-[#0e1525]/50 py-20 text-center">
			<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#131c2e] text-slate-500">
				<FolderOpen class="h-8 w-8" />
			</div>
			<h3 class="text-base font-semibold text-white">
				{#if debouncedSearch}
					Nenhum resultado para "{debouncedSearch}"
				{:else if view === 'trash'}
					Sua lixeira está vazia
				{:else if view === 'starred'}
					Nenhum item favoritado ainda
				{:else if view === 'shared'}
					Nada compartilhado com você ainda
				{:else}
					Esta pasta está vazia
				{/if}
			</h3>
			<p class="mt-1 max-w-sm text-xs text-slate-400">
				{#if canWriteHere}
					Arraste arquivos para cá ou clique em "Upload" para enviar para o armazenamento em disco indexado no MariaDB.
				{:else}
					Os itens aparecerão aqui assim que estiverem disponíveis.
				{/if}
			</p>
			{#if canWriteHere}
				<div class="mt-5 flex gap-2.5">
					<button
						type="button"
						onclick={() => fileInputEl?.click()}
						class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
					>
						<Upload class="h-3.5 w-3.5" />
						Fazer Upload
					</button>
					<button
						type="button"
						onclick={() => {
							newFolderName = '';
							showNewFolderModal = true;
						}}
						class="inline-flex items-center gap-2 rounded-xl border border-[#233047] bg-[#131c2e] px-4 py-2 text-xs font-medium text-slate-200 hover:bg-[#1b273e]"
					>
						<FolderPlus class="h-3.5 w-3.5" />
						Nova Pasta
					</button>
				</div>
			{/if}
		</div>
	{:else if displayMode === 'grid'}
		<!-- GRID VIEW -->
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
			{#each nodes as node (node.id)}
				{@const isImage = node.type === 'file' && getFileCategory('file', node.mime_type, node.name) === 'image' && !node.is_trashed}
				<div
					ondblclick={() => handleNodeDoubleClick(node)}
					role="button"
					tabindex="0"
					onkeydown={(e) => {
						if (e.key === 'Enter') handleNodeDoubleClick(node);
					}}
					class="group flex flex-col overflow-hidden rounded-2xl border border-[#1f2d45] bg-[#131c2e] transition hover:border-indigo-500/40 hover:bg-[#172238] hover:shadow-xl hover:shadow-black/30"
				>
					<!-- Preview / Icon Banner -->
					<div class="relative flex h-32 items-center justify-center overflow-hidden bg-[#0e1525]">
						{#if isImage}
							<img
								src="/api/files/{node.id}/content"
								alt={node.name}
								loading="lazy"
								class="h-full w-full object-cover transition duration-300 group-hover:scale-105"
							/>
						{:else}
							<FileIcon type={node.type} mime={node.mime_type} name={node.name} size="lg" />
						{/if}

						<!-- Top badges -->
						<div class="absolute top-2.5 left-2.5 flex items-center gap-1.5">
							{#if node.permission && node.permission !== 'owner'}
								<span class="rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 backdrop-blur-xs">
									{node.permission === 'editor' ? 'Editor' : 'Leitor'}
								</span>
							{/if}
							{#if (node.share_count ?? 0) > 0}
								<span class="inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] text-sky-300 backdrop-blur-xs" title="Compartilhado com usuários">
									<Users class="h-3 w-3" /> {node.share_count}
								</span>
							{/if}
							{#if (node.link_count ?? 0) > 0}
								<span class="inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] text-indigo-300 backdrop-blur-xs" title="Links públicos ativos">
									<Link2 class="h-3 w-3" /> {node.link_count}
								</span>
							{/if}
						</div>

						<!-- Star button -->
						{#if !node.is_trashed && node.permission === 'owner'}
							<button
								type="button"
								onclick={(e) => {
									e.stopPropagation();
									toggleStar(node);
								}}
								class="absolute top-2 right-2 rounded-lg bg-black/50 p-1.5 backdrop-blur-xs transition hover:bg-black/80"
								title={node.is_starred ? 'Remover dos favoritos' : 'Favoritar'}
							>
								<Star
									class="h-3.5 w-3.5 {node.is_starred
										? 'fill-amber-400 text-amber-400'
										: 'text-slate-300'}"
								/>
							</button>
						{/if}
					</div>

					<!-- Info & Quick Actions -->
					<div class="flex flex-1 flex-col justify-between p-3.5">
						<div class="min-w-0">
							<p class="truncate text-sm font-semibold text-white" title={node.name}>
								{node.name}
							</p>
							<p class="mt-0.5 text-[11px] text-slate-400">
								{node.type === 'folder' ? 'Pasta' : formatBytes(node.size_bytes)} • {formatDate(node.updated_at)}
							</p>
							{#if view === 'shared' && node.owner_name}
								<p class="mt-0.5 truncate text-[10px] text-slate-500">De: {node.owner_name}</p>
							{/if}
						</div>

						<!-- Action bar -->
						<div class="mt-3 flex flex-wrap items-center gap-1 border-t border-[#1f2d45] pt-2.5">
							{#if node.is_trashed}
								<button
									type="button"
									onclick={() => restoreNode(node)}
									class="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-500/15 py-1.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/25"
								>
									<RotateCcw class="h-3.5 w-3.5" /> Restaurar
								</button>
								<button
									type="button"
									onclick={() => deletePermanent(node)}
									class="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-rose-500/15 py-1.5 text-[11px] font-medium text-rose-300 hover:bg-rose-500/25"
								>
									<Trash2 class="h-3.5 w-3.5" /> Excluir
								</button>
							{:else}
								{#if node.type === 'folder'}
									<button
										type="button"
										onclick={() => openFolder(node.id)}
										class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white"
										title="Abrir pasta"
									>
										<FolderOpen class="h-3.5 w-3.5" />
									</button>
								{:else}
									{#if isPreviewable(node.mime_type, node.name)}
										<button
											type="button"
											onclick={() => (previewNode = node)}
											class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white"
											title="Pré-visualizar"
										>
											<Eye class="h-3.5 w-3.5" />
										</button>
									{/if}
									<a
										href="/api/files/{node.id}/content?download=1"
										class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white"
										title="Baixar"
									>
										<Download class="h-3.5 w-3.5" />
									</a>
								{/if}

								{#if node.permission === 'owner'}
									<button
										type="button"
										onclick={() => (shareNode = node)}
										class="rounded-lg p-1.5 text-slate-400 hover:bg-indigo-500/20 hover:text-indigo-300"
										title="Compartilhar"
									>
										<Share2 class="h-3.5 w-3.5" />
									</button>
									<button
										type="button"
										onclick={() => (moveNode = node)}
										class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white"
										title="Mover"
									>
										<FolderInput class="h-3.5 w-3.5" />
									</button>
								{/if}

								{#if node.type === 'file'}
									<button
										type="button"
										onclick={() => copyFile(node)}
										class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white"
										title="Duplicar arquivo"
									>
										<Copy class="h-3.5 w-3.5" />
									</button>
								{/if}

								{#if node.permission === 'owner' || node.permission === 'editor'}
									<button
										type="button"
										onclick={() => {
											renameNode = node;
											renameValue = node.name;
										}}
										class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white"
										title="Renomear"
									>
										<Pencil class="h-3.5 w-3.5" />
									</button>
									<button
										type="button"
										onclick={() => trashNode(node)}
										class="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
										title="Mover para lixeira"
									>
										<Trash2 class="h-3.5 w-3.5" />
									</button>
								{/if}
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<!-- LIST VIEW -->
		<div class="overflow-x-auto rounded-2xl border border-[#1f2d45] bg-[#131c2e]">
			<table class="w-full text-left text-sm">
				<thead class="border-b border-[#1f2d45] bg-[#0e1525] text-xs uppercase tracking-wider text-slate-400">
					<tr>
						<th class="px-4 py-3">Nome</th>
						<th class="px-4 py-3">Tamanho</th>
						<th class="px-4 py-3">Modificado</th>
						<th class="px-4 py-3 text-right">Ações</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[#1a253a]">
					{#each nodes as node (node.id)}
						<tr
							ondblclick={() => handleNodeDoubleClick(node)}
							class="transition hover:bg-[#19243a]"
						>
							<td class="px-4 py-3">
								<div class="flex items-center gap-3">
									<FileIcon type={node.type} mime={node.mime_type} name={node.name} size="md" />
									<div class="min-w-0">
										<button
											type="button"
											onclick={() => handleNodeDoubleClick(node)}
											class="truncate font-medium text-white hover:text-indigo-300"
										>
											{node.name}
										</button>
										{#if node.is_starred}
											<Star class="ml-1.5 inline h-3 w-3 fill-amber-400 text-amber-400" />
										{/if}
									</div>
								</div>
							</td>
							<td class="px-4 py-3 font-mono text-xs text-slate-400">
								{node.type === 'folder' ? '—' : formatBytes(node.size_bytes)}
							</td>
							<td class="px-4 py-3 text-xs text-slate-400">
								{formatDate(node.updated_at)}
							</td>
							<td class="px-4 py-3">
								<div class="flex items-center justify-end gap-1">
									{#if node.is_trashed}
										<button
											type="button"
											onclick={() => restoreNode(node)}
											class="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25"
										>
											Restaurar
										</button>
										<button
											type="button"
											onclick={() => deletePermanent(node)}
											class="rounded-lg bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/25"
										>
											Excluir
										</button>
									{:else}
										{#if node.type === 'file'}
											<button
												type="button"
												onclick={() => (previewNode = node)}
												class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white"
												title="Visualizar"
											>
												<Eye class="h-4 w-4" />
											</button>
											<a
												href="/api/files/{node.id}/content?download=1"
												class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white"
												title="Baixar"
											>
												<Download class="h-4 w-4" />
											</a>
										{/if}
										{#if node.permission === 'owner'}
											<button
												type="button"
												onclick={() => toggleStar(node)}
												class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-amber-400"
												title="Favoritar"
											>
												<Star class="h-4 w-4 {node.is_starred ? 'fill-amber-400 text-amber-400' : ''}" />
											</button>
											<button
												type="button"
												onclick={() => (shareNode = node)}
												class="rounded-lg p-1.5 text-slate-400 hover:bg-indigo-500/20 hover:text-indigo-300"
												title="Compartilhar"
											>
												<Share2 class="h-4 w-4" />
											</button>
											<button
												type="button"
												onclick={() => (moveNode = node)}
												class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white"
												title="Mover"
											>
												<FolderInput class="h-4 w-4" />
											</button>
										{/if}
										{#if node.permission === 'owner' || node.permission === 'editor'}
											<button
												type="button"
												onclick={() => {
													renameNode = node;
													renameValue = node.name;
												}}
												class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white"
												title="Renomear"
											>
												<Pencil class="h-4 w-4" />
											</button>
											<button
												type="button"
												onclick={() => trashNode(node)}
												class="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
												title="Lixeira"
											>
												<Trash2 class="h-4 w-4" />
											</button>
										{/if}
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- New Folder Modal -->
{#if showNewFolderModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
		<form
			onsubmit={createFolder}
			class="w-full max-w-sm rounded-2xl border border-[#233047] bg-[#131c2e] p-5 shadow-2xl"
		>
			<h3 class="mb-3 text-base font-semibold text-white">Nova Pasta</h3>
			<input
				type="text"
				required
				bind:value={newFolderName}
				placeholder="Nome da pasta..."
				class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
			/>
			<div class="mt-4 flex justify-end gap-2">
				<button
					type="button"
					onclick={() => (showNewFolderModal = false)}
					class="rounded-xl border border-[#233047] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-[#19253b]"
				>
					Cancelar
				</button>
				<button
					type="submit"
					class="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
				>
					Criar Pasta
				</button>
			</div>
		</form>
	</div>
{/if}

<!-- Rename Modal -->
{#if renameNode}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
		<form
			onsubmit={submitRename}
			class="w-full max-w-sm rounded-2xl border border-[#233047] bg-[#131c2e] p-5 shadow-2xl"
		>
			<h3 class="mb-3 text-base font-semibold text-white">Renomear</h3>
			<input
				type="text"
				required
				bind:value={renameValue}
				class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
			/>
			<div class="mt-4 flex justify-end gap-2">
				<button
					type="button"
					onclick={() => (renameNode = null)}
					class="rounded-xl border border-[#233047] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-[#19253b]"
				>
					Cancelar
				</button>
				<button
					type="submit"
					class="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
				>
					Salvar
				</button>
			</div>
		</form>
	</div>
{/if}

<!-- Preview / Share / Move Modals -->
{#if previewNode}
	<PreviewModal node={previewNode} onClose={() => (previewNode = null)} />
{/if}

{#if shareNode}
	<ShareModal
		node={shareNode}
		onClose={() => (shareNode = null)}
		onUpdated={loadNodes}
	/>
{/if}

{#if moveNode}
	<MoveModal
		node={moveNode}
		onClose={() => (moveNode = null)}
		onMoved={loadNodes}
	/>
{/if}
