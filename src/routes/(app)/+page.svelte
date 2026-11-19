<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import type { BreadcrumbItem, StorageNode } from '$lib/types';
	import { quotaStore } from '$lib/stores/quota.svelte';
	import { transferManager } from '$lib/stores/transfers.svelte';
	import { dragStore, LIZZART_DRAG_MIME } from '$lib/stores/drag.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatBytes, formatDate, getFileCategory, isPreviewable } from '$lib/utils';
	import FileIcon from '$lib/components/explorer/FileIcon.svelte';
	import PreviewModal from '$lib/components/explorer/PreviewModal.svelte';
	import ImageCropModal from '$lib/components/explorer/ImageCropModal.svelte';
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
		FolderOpen,
		Crop,
		CheckSquare,
		RefreshCw,
		Check,
		MoreVertical
	} from 'lucide-svelte';

	let { data } = $props();

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
	let prefsInitialized = false;

	$effect(() => {
		if (!prefsInitialized && data.user) {
			displayMode = data.user.default_view_mode;
			sortBy = data.user.default_sort_by;
			sortDir = data.user.default_sort_dir;
			prefsInitialized = true;
		}
	});

	function persistUiPrefs(patch: Record<string, string>) {
		fetch('/api/auth/profile', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		}).catch(() => {});
	}

	function setDisplayMode(mode: 'grid' | 'list') {
		displayMode = mode;
		persistUiPrefs({ default_view_mode: mode });
	}

	let fileInputEl = $state<HTMLInputElement | null>(null);
	let contentAreaEl = $state<HTMLDivElement | null>(null);
	let externalDragOver = $state(false);

	// Internal Drag & Drop targets
	let dropHoverFolderId = $state<string | null>(null);
	let dropHoverCrumbIdx = $state<number | null>(null);

	// Multi-selection + Bounded Marquee Rectangle
	let selectedIds = $state<Set<string>>(new Set());
	let lastClickedId = $state<string | null>(null);
	let marquee = $state<{
		startX: number;
		startY: number;
		curX: number;
		curY: number;
		additive: boolean;
		initialSelection: Set<string>;
	} | null>(null);

	// Custom Context Menu
	let contextMenu = $state<{
		x: number;
		y: number;
		targetNode: StorageNode | null;
	} | null>(null);

	// Modals
	let previewNode = $state<StorageNode | null>(null);
	let cropNode = $state<StorageNode | null>(null);
	let shareNode = $state<StorageNode | null>(null);
	let moveNodes = $state<StorageNode[] | null>(null);

	let showNewFolderModal = $state(false);
	let newFolderName = $state('');

	let renameNode = $state<StorageNode | null>(null);
	let renameValue = $state('');

	let selectedNodes = $derived(nodes.filter((n) => selectedIds.has(n.id)));

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
		selectedIds = new Set();
		contextMenu = null;
		try {
			const params = new URLSearchParams();
			params.set('view', view);
			if (parentId) params.set('parentId', parentId);
			if (debouncedSearch) params.set('search', debouncedSearch);
			params.set('sort', sortBy);
			params.set('dir', sortDir);

			const res = await fetch(`/api/files?${params.toString()}`);
			const payload = await res.json();
			if (!res.ok) {
				toast.error(payload.error || 'Erro ao carregar arquivos.');
				return;
			}
			nodes = payload.nodes;
			breadcrumbs = payload.breadcrumbs;
			currentPermission = payload.currentPermission || 'owner';
			if (payload.quota) {
				quotaStore.sync(payload.quota.used_bytes, payload.quota.quota_bytes);
			}
		} catch {
			toast.error('Erro de conexão ao listar arquivos.');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void view;
		void parentId;
		void debouncedSearch;
		void sortBy;
		void sortDir;
		void dragStore.version;
		loadNodes();
	});

	let canWriteHere = $derived(
		!debouncedSearch &&
			(view === 'drive' || (view === 'shared' && Boolean(parentId))) &&
			(currentPermission === 'owner' || currentPermission === 'editor')
	);

	function canCropNode(node: StorageNode): boolean {
		if (node.type !== 'file' || node.is_trashed) return false;
		const isGif =
			(node.mime_type || '').toLowerCase() === 'image/gif' ||
			node.name.toLowerCase().endsWith('.gif');
		return getFileCategory('file', node.mime_type, node.name) === 'image' && !isGif;
	}

	function openFolder(folderId: string | null) {
		searchQuery = '';
		debouncedSearch = '';
		selectedIds = new Set();
		const params = new URLSearchParams();
		if (view !== 'drive') params.set('view', view);
		if (folderId) params.set('folder', folderId);
		const qs = params.toString();
		goto(qs ? `/?${qs}` : '/');
	}

	function handleNodeClick(node: StorageNode, e: MouseEvent) {
		e.stopPropagation();
		contextMenu = null;

		if (e.shiftKey && lastClickedId) {
			const idxA = nodes.findIndex((n) => n.id === lastClickedId);
			const idxB = nodes.findIndex((n) => n.id === node.id);
			if (idxA !== -1 && idxB !== -1) {
				const [from, to] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
				const next = new Set(e.ctrlKey || e.metaKey ? selectedIds : []);
				for (let i = from; i <= to; i++) next.add(nodes[i].id);
				selectedIds = next;
				return;
			}
		}

		if (e.ctrlKey || e.metaKey) {
			const next = new Set(selectedIds);
			if (next.has(node.id)) next.delete(node.id);
			else next.add(node.id);
			selectedIds = next;
			lastClickedId = node.id;
			return;
		}

		selectedIds = new Set([node.id]);
		lastClickedId = node.id;
	}

	function handleNodeDoubleClick(node: StorageNode) {
		if (node.is_trashed) return;
		if (node.type === 'folder') {
			openFolder(node.id);
		} else {
			previewNode = node;
		}
	}

	// Internal Drag & Drop for files and folders
	function onNodeDragStart(e: DragEvent, node: StorageNode) {
		if (node.is_trashed || node.permission !== 'owner') {
			e.preventDefault();
			return;
		}
		contextMenu = null;

		let itemsToDrag: StorageNode[];
		if (selectedIds.has(node.id)) {
			itemsToDrag = selectedNodes.filter((n) => !n.is_trashed && n.permission === 'owner');
		} else {
			selectedIds = new Set([node.id]);
			itemsToDrag = [node];
		}

		dragStore.start(itemsToDrag);
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData(LIZZART_DRAG_MIME, JSON.stringify(itemsToDrag.map((i) => i.id)));
			e.dataTransfer.setData('text/plain', itemsToDrag.map((i) => i.name).join(', '));
		}
	}

	function onNodeDragEnd() {
		dragStore.end();
		dropHoverFolderId = null;
		dropHoverCrumbIdx = null;
	}

	function isInternalDrag(e: DragEvent): boolean {
		return dragStore.active || Boolean(e.dataTransfer?.types.includes(LIZZART_DRAG_MIME));
	}

	function onFolderDragOver(e: DragEvent, targetFolder: StorageNode) {
		if (targetFolder.type !== 'folder' || targetFolder.is_trashed) return;
		if (!isInternalDrag(e)) return;
		if (dragStore.draggingIds.has(targetFolder.id)) return; // cannot drop folder into itself
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		dropHoverFolderId = targetFolder.id;
	}

	async function onFolderDrop(e: DragEvent, targetFolder: StorageNode) {
		if (targetFolder.type !== 'folder' || targetFolder.is_trashed) return;
		if (!isInternalDrag(e)) return;
		e.preventDefault();
		e.stopPropagation();
		dropHoverFolderId = null;

		const items = dragStore.draggingNodes.filter((n) => n.id !== targetFolder.id);
		dragStore.end();
		if (items.length === 0) return;

		await moveItemsToParent(items, targetFolder.id, targetFolder.name);
	}

	function onCrumbDragOver(e: DragEvent, idx: number, crumb: BreadcrumbItem) {
		if (!isInternalDrag(e)) return;
		if (view !== 'drive') return;
		if (crumb.id && dragStore.draggingIds.has(crumb.id)) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		dropHoverCrumbIdx = idx;
	}

	async function onCrumbDrop(e: DragEvent, crumb: BreadcrumbItem) {
		if (!isInternalDrag(e) || view !== 'drive') return;
		e.preventDefault();
		e.stopPropagation();
		dropHoverCrumbIdx = null;

		const items = dragStore.draggingNodes.filter((n) => n.id !== crumb.id);
		dragStore.end();
		if (items.length === 0) return;

		await moveItemsToParent(items, crumb.id, crumb.name);
	}

	async function moveItemsToParent(
		items: StorageNode[],
		targetParentId: string | null,
		targetLabel: string
	) {
		let moved = 0;
		for (const item of items) {
			if (item.parent_id === targetParentId) continue;
			const res = await fetch(`/api/files/${item.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ parent_id: targetParentId })
			});
			if (res.ok) {
				moved++;
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.error || `Erro ao mover "${item.name}".`);
			}
		}
		if (moved > 0) {
			toast.success(
				moved === 1
					? `"${items[0].name}" movido para "${targetLabel}"!`
					: `${moved} itens movidos para "${targetLabel}"!`
			);
			await loadNodes();
		}
	}

	// Marquee strictly confined to contentAreaEl
	function onContentMouseDown(e: MouseEvent) {
		if (e.button !== 0 || !contentAreaEl) return;
		contextMenu = null;

		const target = e.target as HTMLElement;
		if (target.closest('[data-node-id]') || target.closest('button, a, input, select')) {
			return;
		}

		const bounds = contentAreaEl.getBoundingClientRect();
		const startX = Math.max(0, Math.min(bounds.width, e.clientX - bounds.left));
		const startY = Math.max(0, Math.min(bounds.height, e.clientY - bounds.top));

		const additive = e.ctrlKey || e.metaKey || e.shiftKey;
		const initialSelection = additive ? new Set(selectedIds) : new Set<string>();
		if (!additive) {
			selectedIds = new Set();
		}

		marquee = {
			startX,
			startY,
			curX: startX,
			curY: startY,
			additive,
			initialSelection
		};

		window.addEventListener('mousemove', onMarqueeMove);
		window.addEventListener('mouseup', onMarqueeUp);
	}

	function onMarqueeMove(e: MouseEvent) {
		if (!marquee || !contentAreaEl) return;
		const bounds = contentAreaEl.getBoundingClientRect();

		const curX = Math.max(0, Math.min(bounds.width, e.clientX - bounds.left));
		const curY = Math.max(0, Math.min(bounds.height, e.clientY - bounds.top));
		marquee = { ...marquee, curX, curY };

		const relLeft = Math.min(marquee.startX, curX);
		const relRight = Math.max(marquee.startX, curX);
		const relTop = Math.min(marquee.startY, curY);
		const relBottom = Math.max(marquee.startY, curY);

		if (relRight - relLeft < 4 && relBottom - relTop < 4) return;

		const vpLeft = bounds.left + relLeft;
		const vpRight = bounds.left + relRight;
		const vpTop = bounds.top + relTop;
		const vpBottom = bounds.top + relBottom;

		const next = new Set(marquee.additive ? marquee.initialSelection : []);
		const itemEls = contentAreaEl.querySelectorAll<HTMLElement>('[data-node-id]');
		for (const el of itemEls) {
			const rect = el.getBoundingClientRect();
			const intersects =
				rect.left <= vpRight &&
				rect.right >= vpLeft &&
				rect.top <= vpBottom &&
				rect.bottom >= vpTop;
			if (intersects) {
				const id = el.dataset.nodeId;
				if (id) next.add(id);
			}
		}
		selectedIds = next;
	}

	function onMarqueeUp() {
		marquee = null;
		window.removeEventListener('mousemove', onMarqueeMove);
		window.removeEventListener('mouseup', onMarqueeUp);
	}

	// Custom Context Menu — safe action runner (captures target BEFORE closing menu!)
	function openContextMenu(e: MouseEvent, targetNode: StorageNode | null) {
		e.preventDefault();
		e.stopPropagation();

		if (targetNode && !selectedIds.has(targetNode.id)) {
			selectedIds = new Set([targetNode.id]);
			lastClickedId = targetNode.id;
		}

		const menuWidth = 236;
		const menuHeight = 360;
		const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
		const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);

		contextMenu = {
			x: Math.max(8, x),
			y: Math.max(8, y),
			targetNode
		};
	}

	function openMenuFromButton(e: MouseEvent, node: StorageNode) {
		e.stopPropagation();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		if (!selectedIds.has(node.id)) {
			selectedIds = new Set([node.id]);
		}
		const menuWidth = 236;
		const menuHeight = 360;
		const x = Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 10);
		const y = Math.min(rect.bottom + 4, window.innerHeight - menuHeight - 10);
		contextMenu = {
			x: Math.max(8, x),
			y: Math.max(8, y),
			targetNode: node
		};
	}

	/** Captures snapshot of targetNode & selection BEFORE closing the context menu */
	function runMenuAction(action: (node: StorageNode | null, multi: StorageNode[]) => void) {
		const node = contextMenu?.targetNode ?? null;
		const multi = [...selectedNodes];
		contextMenu = null;
		action(node, multi);
	}

	function handleWindowKeyDown(e: KeyboardEvent) {
		const activeTag = (document.activeElement?.tagName || '').toLowerCase();
		if (['input', 'textarea', 'select'].includes(activeTag)) return;

		if (e.key === 'Escape') {
			contextMenu = null;
			selectedIds = new Set();
		} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
			e.preventDefault();
			selectedIds = new Set(nodes.map((n) => n.id));
		} else if (e.key === 'Delete' && selectedNodes.length > 0 && !previewNode && !cropNode) {
			e.preventDefault();
			if (view === 'trash') bulkDeletePermanent(selectedNodes);
			else bulkTrash(selectedNodes);
		}
	}

	// External OS File Drop (Upload) — ignores internal node drags
	function onExternalDragOver(e: DragEvent) {
		if (isInternalDrag(e)) return;
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		if (canWriteHere) externalDragOver = true;
	}

	function onExternalDrop(e: DragEvent) {
		if (isInternalDrag(e)) return;
		e.preventDefault();
		externalDragOver = false;
		if (e.dataTransfer?.files?.length) {
			uploadFiles(e.dataTransfer.files);
		}
	}

	function uploadFiles(fileList: FileList | File[]) {
		const files = Array.from(fileList);
		if (files.length === 0) return;

		if (!canWriteHere) {
			toast.warning(
				'Navegue para Meus Arquivos ou uma pasta com permissão de Editor para fazer upload.'
			);
			return;
		}

		transferManager.enqueueUploads(files, parentId, () => {
			loadNodes();
		});
	}

	function downloadNode(node: StorageNode) {
		if (node.type !== 'file') return;
		transferManager.enqueueDownload(node.id, node.name, node.size_bytes, node.mime_type);
	}

	function bulkDownload(items: StorageNode[]) {
		const files = items.filter((n) => n.type === 'file');
		if (files.length === 0) {
			toast.info('Selecione pelo menos um arquivo para baixar.');
			return;
		}
		for (const f of files) downloadNode(f);
	}

	async function createFolder(e: SubmitEvent) {
		e.preventDefault();
		if (!newFolderName.trim()) return;
		const res = await fetch('/api/files/folder', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: newFolderName.trim(), parentId })
		});
		const payload = await res.json();
		if (!res.ok) {
			toast.error(payload.error || 'Erro ao criar pasta.');
			return;
		}
		toast.success(`Pasta "${payload.node.name}" criada!`);
		newFolderName = '';
		showNewFolderModal = false;
		await loadNodes();
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
		const payload = await res.json();
		if (!res.ok) {
			toast.error(payload.error || 'Falha ao renomear.');
			return;
		}
		toast.success('Item renomeado!');
		renameNode = null;
		await loadNodes();
	}

	async function copyFile(node: StorageNode) {
		const res = await fetch(`/api/files/${node.id}/copy`, { method: 'POST' });
		const payload = await res.json();
		if (!res.ok) {
			toast.error(payload.error || 'Falha ao duplicar arquivo.');
			return;
		}
		toast.success(`Cópia criada: "${payload.name}"`);
		await loadNodes();
	}

	async function trashNode(node: StorageNode) {
		const res = await fetch(`/api/files/${node.id}`, { method: 'DELETE' });
		if (!res.ok) {
			const payload = await res.json().catch(() => ({}));
			toast.error(payload.error || 'Não foi possível mover para a lixeira.');
			return;
		}
		toast.info(`"${node.name}" movido para a lixeira.`);
		await loadNodes();
	}

	async function bulkTrash(items: StorageNode[]) {
		const deletable = items.filter((n) => n.permission === 'owner' || n.permission === 'editor');
		if (deletable.length === 0) return;
		for (const n of deletable) {
			await fetch(`/api/files/${n.id}`, { method: 'DELETE' });
		}
		toast.info(`${deletable.length} item(ns) movido(s) para a lixeira.`);
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

	async function bulkRestore(items: StorageNode[]) {
		for (const n of items) {
			await fetch(`/api/files/${n.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ restore: true })
			});
		}
		toast.success(`${items.length} item(ns) restaurado(s)!`);
		await loadNodes();
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

	async function bulkDeletePermanent(items: StorageNode[]) {
		if (
			!confirm(`Excluir permanentemente ${items.length} item(ns)? Esta ação não pode ser desfeita.`)
		) {
			return;
		}
		for (const n of items) {
			await fetch(`/api/files/${n.id}?permanent=true`, { method: 'DELETE' });
		}
		toast.success(`${items.length} item(ns) excluído(s) do disco.`);
		await loadNodes();
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
		persistUiPrefs({ default_sort_by: sortBy, default_sort_dir: sortDir });
	}
</script>

<svelte:window
	onkeydown={handleWindowKeyDown}
	onclick={() => (contextMenu = null)}
/>

<svelte:head>
	<title>Meus Arquivos — Lizzart Explorer</title>
</svelte:head>

<div
	class="relative flex min-h-full flex-1 flex-col p-3.5 sm:p-6 lg:p-8"
	ondragover={onExternalDragOver}
	ondragleave={(e) => {
		if (e.currentTarget === e.target) externalDragOver = false;
	}}
	ondrop={onExternalDrop}
	role="region"
	aria-label="Explorador de arquivos"
>
	<!-- External Upload Drag Overlay -->
	{#if externalDragOver}
		<div class="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
			<div class="flex flex-col items-center rounded-3xl border-2 border-dashed border-accent-400 bg-[#131c2e]/95 px-8 py-10 text-center shadow-2xl sm:px-14 sm:py-12">
				<CloudUpload class="mb-4 h-14 w-14 text-accent-400 sm:h-16 sm:w-16" />
				<h2 class="text-lg font-bold text-white sm:text-xl">Solte seus arquivos aqui</h2>
				<p class="mt-1 text-xs text-slate-300 sm:text-sm">Upload retomável (8 MB → 64 MB) na qualidade original</p>
			</div>
		</div>
	{/if}

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
	<div class="mb-4 flex flex-col gap-3 sm:mb-5 md:flex-row md:items-center md:justify-between">
		<div class="relative w-full md:max-w-md">
			<Search class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
			<input
				type="text"
				value={searchQuery}
				oninput={(e) => handleSearchInput(e.currentTarget.value)}
				placeholder="Buscar arquivos e pastas..."
				class="w-full rounded-xl border border-[#1f2d45] bg-[#131c2e] py-2.5 pr-9 pl-10 text-sm text-white placeholder-slate-500 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
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

		<div class="flex flex-wrap items-center gap-2">
			{#if canWriteHere}
				<button
					type="button"
					onclick={() => fileInputEl?.click()}
					class="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent-600/25 transition hover:bg-accent-500 sm:flex-none sm:px-4"
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
					class="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#233047] bg-[#131c2e] px-3.5 py-2.5 text-sm font-medium text-slate-200 transition hover:border-accent-500/40 hover:bg-[#19253c] sm:flex-none"
				>
					<FolderPlus class="h-4 w-4 text-accent-400" />
					Nova Pasta
				</button>
			{/if}

			{#if view === 'trash' && nodes.length > 0}
				<button
					type="button"
					onclick={emptyTrash}
					class="inline-flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/15 px-3.5 py-2.5 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/25"
				>
					<Trash2 class="h-4 w-4" />
					Esvaziar Lixeira
				</button>
			{/if}

			<div class="ml-auto flex items-center rounded-xl border border-[#1f2d45] bg-[#131c2e] p-1">
				<button
					type="button"
					onclick={() => setDisplayMode('grid')}
					class="rounded-lg p-1.5 transition {displayMode === 'grid'
						? 'bg-[#22304c] text-accent-300'
						: 'text-slate-400 hover:text-slate-200'}"
					title="Visualização em Grade"
				>
					<LayoutGrid class="h-4 w-4" />
				</button>
				<button
					type="button"
					onclick={() => setDisplayMode('list')}
					class="rounded-lg p-1.5 transition {displayMode === 'list'
						? 'bg-[#22304c] text-accent-300'
						: 'text-slate-400 hover:text-slate-200'}"
					title="Visualização em Lista"
				>
					<List class="h-4 w-4" />
				</button>
			</div>
		</div>
	</div>

	<!-- Breadcrumbs (also drop targets for moving items up!) & Sort Bar -->
	<div class="mb-4 flex flex-wrap items-center justify-between gap-2.5 border-b border-[#1a253a] pb-3">
		<div class="flex flex-wrap items-center gap-1 text-sm">
			{#each breadcrumbs as crumb, idx (crumb.id ?? 'root-' + idx)}
				{#if idx > 0}
					<ChevronRight class="h-4 w-4 text-slate-600" />
				{/if}
				<button
					type="button"
					onclick={() => openFolder(crumb.id)}
					ondragover={(e) => onCrumbDragOver(e, idx, crumb)}
					ondragleave={() => {
						if (dropHoverCrumbIdx === idx) dropHoverCrumbIdx = null;
					}}
					ondrop={(e) => onCrumbDrop(e, crumb)}
					class="rounded-lg px-2 py-1 font-medium transition {dropHoverCrumbIdx === idx
						? 'bg-accent-500/25 text-white ring-2 ring-accent-400'
						: idx === breadcrumbs.length - 1
							? 'text-white'
							: 'text-slate-400 hover:bg-[#131c2e] hover:text-slate-200'}"
				>
					{crumb.name}
				</button>
			{/each}
		</div>

		<div class="flex items-center gap-1 text-xs text-slate-400">
			<span class="hidden sm:inline">Ordenar:</span>
			<button
				type="button"
				onclick={() => toggleSort('name')}
				class="inline-flex items-center gap-1 rounded-lg px-2 py-1 transition {sortBy === 'name'
					? 'bg-[#19253c] text-accent-300'
					: 'hover:bg-[#131c2e] hover:text-slate-200'}"
			>
				Nome <ArrowUpDown class="h-3 w-3" />
			</button>
			<button
				type="button"
				onclick={() => toggleSort('date')}
				class="inline-flex items-center gap-1 rounded-lg px-2 py-1 transition {sortBy === 'date'
					? 'bg-[#19253c] text-accent-300'
					: 'hover:bg-[#131c2e] hover:text-slate-200'}"
			>
				Data <ArrowUpDown class="h-3 w-3" />
			</button>
			<button
				type="button"
				onclick={() => toggleSort('size')}
				class="inline-flex items-center gap-1 rounded-lg px-2 py-1 transition {sortBy === 'size'
					? 'bg-[#19253c] text-accent-300'
					: 'hover:bg-[#131c2e] hover:text-slate-200'}"
			>
				Tamanho <ArrowUpDown class="h-3 w-3" />
			</button>
		</div>
	</div>

	<!-- BOUNDED CONTENT AREA -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={contentAreaEl}
		onmousedown={onContentMouseDown}
		oncontextmenu={(e) => openContextMenu(e, null)}
		role="region"
		aria-label="Área de conteúdo dos arquivos"
		class="relative flex flex-1 flex-col overflow-hidden rounded-2xl"
	>
		<!-- Marquee Selection Rectangle strictly clipped inside contentAreaEl -->
		{#if marquee}
			{@const rectL = Math.min(marquee.startX, marquee.curX)}
			{@const rectT = Math.min(marquee.startY, marquee.curY)}
			{@const rectW = Math.abs(marquee.curX - marquee.startX)}
			{@const rectH = Math.abs(marquee.curY - marquee.startY)}
			{#if rectW > 3 || rectH > 3}
				<div
					class="pointer-events-none absolute z-30 rounded border border-accent-400 bg-accent-500/20"
					style="left: {rectL}px; top: {rectT}px; width: {rectW}px; height: {rectH}px;"
				></div>
			{/if}
		{/if}

		{#if loading}
			<div class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
				{#each Array(6) as _, i (i)}
					<div class="h-36 animate-pulse rounded-2xl border border-[#1a253a] bg-[#131c2e]/60"></div>
				{/each}
			</div>
		{:else if nodes.length === 0}
			<div class="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-[#233047] bg-[#0e1525]/50 px-4 py-16 text-center sm:py-20">
				<div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#131c2e] text-slate-500 sm:h-16 sm:w-16">
					<FolderOpen class="h-7 w-7 sm:h-8 sm:w-8" />
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
						Arraste arquivos para cá, use o botão direito ou clique em "Upload" (chunks retomáveis 8–64 MB).
					{:else}
						Os itens aparecerão aqui assim que estiverem disponíveis.
					{/if}
				</p>
				{#if canWriteHere}
					<div class="mt-5 flex flex-wrap justify-center gap-2.5">
						<button
							type="button"
							onclick={() => fileInputEl?.click()}
							class="inline-flex items-center gap-2 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500"
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
							<FolderPlus class="h-3.5 w-3.5 text-accent-400" />
							Nova Pasta
						</button>
					</div>
				{/if}
			</div>
		{:else if displayMode === 'grid'}
			<!-- RESPONSIVE GRID VIEW WITH DRAG & DROP -->
			<div class="grid grid-cols-2 gap-3 pb-4 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
				{#each nodes as node (node.id)}
					{@const isSelected = selectedIds.has(node.id)}
					{@const isDragging = dragStore.draggingIds.has(node.id)}
					{@const isDropTarget = dropHoverFolderId === node.id}
					{@const isImage = node.type === 'file' && getFileCategory('file', node.mime_type, node.name) === 'image' && !node.is_trashed}
					<div
						data-node-id={node.id}
						draggable={!node.is_trashed && node.permission === 'owner'}
						ondragstart={(e) => onNodeDragStart(e, node)}
						ondragend={onNodeDragEnd}
						ondragover={(e) => onFolderDragOver(e, node)}
						ondragleave={() => {
							if (dropHoverFolderId === node.id) dropHoverFolderId = null;
						}}
						ondrop={(e) => onFolderDrop(e, node)}
						onclick={(e) => handleNodeClick(node, e)}
						ondblclick={() => handleNodeDoubleClick(node)}
						oncontextmenu={(e) => openContextMenu(e, node)}
						role="button"
						tabindex="0"
						onkeydown={(e) => {
							if (e.key === 'Enter') handleNodeDoubleClick(node);
						}}
						class="group flex flex-col overflow-hidden rounded-2xl border transition {isDragging
							? 'opacity-45'
							: ''} {isDropTarget
							? 'scale-[1.02] border-accent-400 bg-accent-500/20 ring-2 ring-accent-400 shadow-2xl'
							: isSelected
								? 'border-accent-400 bg-[#18273e] ring-2 ring-accent-500/35 shadow-xl'
								: 'border-[#1f2d45] bg-[#131c2e] hover:border-accent-500/40 hover:bg-[#172238] hover:shadow-xl hover:shadow-black/30'}"
					>
						<div class="relative flex h-24 items-center justify-center overflow-hidden bg-[#0e1525] sm:h-32">
							{#if isImage}
								<img
									src="/api/files/{node.id}/content?v={encodeURIComponent(node.updated_at)}"
									alt={node.name}
									loading="lazy"
									draggable="false"
									class="h-full w-full object-cover transition duration-300 group-hover:scale-105"
								/>
							{:else}
								<FileIcon type={node.type} mime={node.mime_type} name={node.name} size="lg" />
							{/if}

							{#if isDropTarget}
								<div class="absolute inset-0 flex items-center justify-center bg-accent-600/25 text-xs font-semibold text-white backdrop-blur-[1px]">
									Soltar aqui
								</div>
							{/if}

							{#if isSelected}
								<div class="absolute top-2 left-2 flex h-5 w-5 items-center justify-center rounded-md bg-accent-500 text-white shadow">
									<Check class="h-3.5 w-3.5" />
								</div>
							{:else}
								<div class="absolute top-2 left-2 flex items-center gap-1">
									{#if node.permission && node.permission !== 'owner'}
										<span class="rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-accent-300 backdrop-blur-xs">
											{node.permission === 'editor' ? 'Editor' : 'Leitor'}
										</span>
									{/if}
									{#if (node.share_count ?? 0) > 0}
										<span class="inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] text-sky-300 backdrop-blur-xs">
											<Users class="h-2.5 w-2.5" /> {node.share_count}
										</span>
									{/if}
									{#if (node.link_count ?? 0) > 0}
										<span class="inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] text-accent-300 backdrop-blur-xs">
											<Link2 class="h-2.5 w-2.5" /> {node.link_count}
										</span>
									{/if}
								</div>
							{/if}

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

						<div class="flex flex-1 flex-col justify-between p-2.5 sm:p-3.5">
							<div class="flex items-start justify-between gap-1.5">
								<div class="min-w-0">
									<p class="truncate text-xs font-semibold text-white sm:text-sm" title={node.name}>
										{node.name}
									</p>
									<p class="mt-0.5 truncate text-[10px] text-slate-400 sm:text-[11px]">
										{node.type === 'folder' ? 'Pasta' : formatBytes(node.size_bytes)}
										<span class="hidden sm:inline"> • {formatDate(node.updated_at)}</span>
									</p>
									{#if view === 'shared' && node.owner_username}
										<p class="mt-0.5 truncate font-mono text-[10px] text-slate-500">@{node.owner_username}</p>
									{/if}
								</div>
								<button
									type="button"
									onclick={(e) => openMenuFromButton(e, node)}
									class="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-[#22304c] hover:text-white"
									aria-label="Opções"
								>
									<MoreVertical class="h-4 w-4" />
								</button>
							</div>

							<div class="mt-2.5 hidden flex-wrap items-center gap-1 border-t border-[#1f2d45] pt-2 sm:flex">
								{#if node.is_trashed}
									<button
										type="button"
										onclick={(e) => { e.stopPropagation(); restoreNode(node); }}
										class="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent-500/15 py-1 text-[11px] font-medium text-accent-300 hover:bg-accent-500/25"
									>
										<RotateCcw class="h-3.5 w-3.5" /> Restaurar
									</button>
									<button
										type="button"
										onclick={(e) => { e.stopPropagation(); deletePermanent(node); }}
										class="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-rose-500/15 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-500/25"
									>
										<Trash2 class="h-3.5 w-3.5" /> Excluir
									</button>
								{:else}
									{#if node.type === 'folder'}
										<button type="button" onclick={(e) => { e.stopPropagation(); openFolder(node.id); }} class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white" title="Abrir pasta"><FolderOpen class="h-3.5 w-3.5" /></button>
									{:else}
										{#if isPreviewable(node.mime_type, node.name)}
											<button type="button" onclick={(e) => { e.stopPropagation(); previewNode = node; }} class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white" title="Visualizar"><Eye class="h-3.5 w-3.5" /></button>
										{/if}
										{#if canCropNode(node)}
											<button type="button" onclick={(e) => { e.stopPropagation(); cropNode = node; }} class="rounded-lg p-1.5 text-slate-400 hover:bg-accent-500/20 hover:text-accent-300" title="Recortar bordas"><Crop class="h-3.5 w-3.5" /></button>
										{/if}
										<button type="button" onclick={(e) => { e.stopPropagation(); downloadNode(node); }} class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white" title="Baixar"><Download class="h-3.5 w-3.5" /></button>
									{/if}
									{#if node.permission === 'owner'}
										<button type="button" onclick={(e) => { e.stopPropagation(); shareNode = node; }} class="rounded-lg p-1.5 text-slate-400 hover:bg-accent-500/20 hover:text-accent-300" title="Compartilhar"><Share2 class="h-3.5 w-3.5" /></button>
										<button type="button" onclick={(e) => { e.stopPropagation(); moveNodes = [node]; }} class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white" title="Mover"><FolderInput class="h-3.5 w-3.5" /></button>
									{/if}
									{#if node.permission === 'owner' || node.permission === 'editor'}
										<button type="button" onclick={(e) => { e.stopPropagation(); renameNode = node; renameValue = node.name; }} class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white" title="Renomear"><Pencil class="h-3.5 w-3.5" /></button>
										<button type="button" onclick={(e) => { e.stopPropagation(); trashNode(node); }} class="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-400" title="Lixeira"><Trash2 class="h-3.5 w-3.5" /></button>
									{/if}
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<!-- RESPONSIVE LIST VIEW WITH DRAG & DROP -->
			<div class="overflow-x-auto rounded-2xl border border-[#1f2d45] bg-[#131c2e]">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-[#1f2d45] bg-[#0e1525] text-xs uppercase tracking-wider text-slate-400">
						<tr>
							<th class="px-3.5 py-3 sm:px-4">Nome</th>
							<th class="px-3 py-3">Tamanho</th>
							<th class="hidden px-4 py-3 md:table-cell">Modificado</th>
							<th class="px-3 py-3 text-right sm:px-4">Ações</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-[#1a253a]">
						{#each nodes as node (node.id)}
							{@const isSelected = selectedIds.has(node.id)}
							{@const isDragging = dragStore.draggingIds.has(node.id)}
							{@const isDropTarget = dropHoverFolderId === node.id}
							<tr
								data-node-id={node.id}
								draggable={!node.is_trashed && node.permission === 'owner'}
								ondragstart={(e) => onNodeDragStart(e, node)}
								ondragend={onNodeDragEnd}
								ondragover={(e) => onFolderDragOver(e, node)}
								ondragleave={() => {
									if (dropHoverFolderId === node.id) dropHoverFolderId = null;
								}}
								ondrop={(e) => onFolderDrop(e, node)}
								onclick={(e) => handleNodeClick(node, e)}
								ondblclick={() => handleNodeDoubleClick(node)}
								oncontextmenu={(e) => openContextMenu(e, node)}
								class="transition {isDragging ? 'opacity-45' : ''} {isDropTarget
									? 'bg-accent-500/25 ring-1 ring-inset ring-accent-400'
									: isSelected
										? 'bg-accent-500/15'
										: 'hover:bg-[#19243a]'}"
							>
								<td class="px-3.5 py-3 sm:px-4">
									<div class="flex items-center gap-2.5">
										<FileIcon type={node.type} mime={node.mime_type} name={node.name} size="md" />
										<div class="min-w-0">
											<span class="block max-w-[160px] truncate font-medium text-white sm:max-w-xs md:max-w-md">{node.name}</span>
										</div>
										{#if node.is_starred}
											<Star class="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
										{/if}
									</div>
								</td>
								<td class="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-400">
									{node.type === 'folder' ? '—' : formatBytes(node.size_bytes)}
								</td>
								<td class="hidden whitespace-nowrap px-4 py-3 text-xs text-slate-400 md:table-cell">
									{formatDate(node.updated_at)}
								</td>
								<td class="px-3 py-3 sm:px-4">
									<div class="flex items-center justify-end gap-1">
										{#if !node.is_trashed && node.type === 'file'}
											<button type="button" onclick={(e) => { e.stopPropagation(); previewNode = node; }} class="hidden rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white sm:inline-flex" title="Visualizar"><Eye class="h-4 w-4" /></button>
											<button type="button" onclick={(e) => { e.stopPropagation(); downloadNode(node); }} class="hidden rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white sm:inline-flex" title="Baixar"><Download class="h-4 w-4" /></button>
										{/if}
										<button
											type="button"
											onclick={(e) => openMenuFromButton(e, node)}
											class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white"
											aria-label="Opções"
										>
											<MoreVertical class="h-4 w-4" />
										</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>

<!-- CUSTOM CONTEXT MENU (100% Fixed: snapshots targetNode before closing!) -->
{#if contextMenu}
	{@const tNode = contextMenu.targetNode}
	{@const isMulti = selectedNodes.length > 1 && (!tNode || selectedIds.has(tNode.id))}
	<div
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			if (e.key === 'Escape') contextMenu = null;
		}}
		oncontextmenu={(e) => e.preventDefault()}
		role="menu"
		tabindex="-1"
		class="fixed z-[80] w-58 overflow-hidden rounded-xl border border-[#2a3b58] bg-[#111929]/95 py-1.5 text-xs shadow-2xl backdrop-blur-xl"
		style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
	>
		{#if isMulti}
			<div class="border-b border-[#1f2d45] px-3 py-1.5 text-[11px] font-semibold text-accent-300">
				{selectedNodes.length} itens selecionados
			</div>
			{#if view === 'trash'}
				<button type="button" onclick={() => runMenuAction((_, m) => bulkRestore(m))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white">
					<RotateCcw class="h-3.5 w-3.5 text-accent-400" /> Restaurar selecionados
				</button>
				<button type="button" onclick={() => runMenuAction((_, m) => bulkDeletePermanent(m))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-rose-300 hover:bg-rose-500/20">
					<Trash2 class="h-3.5 w-3.5" /> Excluir permanentemente
				</button>
			{:else}
				<button type="button" onclick={() => runMenuAction((_, m) => bulkDownload(m))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white">
					<Download class="h-3.5 w-3.5 text-accent-400" /> Baixar selecionados
				</button>
				{#if selectedNodes.every((n) => n.permission === 'owner')}
					<button type="button" onclick={() => runMenuAction((_, m) => (moveNodes = m))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white">
						<FolderInput class="h-3.5 w-3.5 text-slate-400" /> Mover selecionados
					</button>
				{/if}
				<div class="my-1 border-t border-[#1f2d45]"></div>
				<button type="button" onclick={() => runMenuAction((_, m) => bulkTrash(m))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-rose-300 hover:bg-rose-500/20">
					<Trash2 class="h-3.5 w-3.5" /> Mover para lixeira
				</button>
			{/if}
		{:else if tNode}
			<div class="truncate border-b border-[#1f2d45] px-3 py-1.5 text-[11px] font-semibold text-slate-400">
				{tNode.name}
			</div>
			{#if tNode.is_trashed}
				<button type="button" onclick={() => runMenuAction((n) => n && restoreNode(n))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white">
					<RotateCcw class="h-3.5 w-3.5 text-accent-400" /> Restaurar
				</button>
				<button type="button" onclick={() => runMenuAction((n) => n && deletePermanent(n))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-rose-300 hover:bg-rose-500/20">
					<Trash2 class="h-3.5 w-3.5" /> Excluir permanentemente
				</button>
			{:else}
				{#if tNode.type === 'folder'}
					<button type="button" onclick={() => runMenuAction((n) => n && openFolder(n.id))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white">
						<FolderOpen class="h-3.5 w-3.5 text-accent-400" /> Abrir pasta
					</button>
				{:else}
					<button type="button" onclick={() => runMenuAction((n) => n && (previewNode = n))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white">
						<Eye class="h-3.5 w-3.5 text-accent-400" /> Visualizar / Reproduzir
					</button>
					{#if canCropNode(tNode)}
						<button type="button" onclick={() => runMenuAction((n) => n && (cropNode = n))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white">
							<Crop class="h-3.5 w-3.5 text-accent-400" /> Recortar bordas
						</button>
					{/if}
					<button type="button" onclick={() => runMenuAction((n) => n && downloadNode(n))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white">
						<Download class="h-3.5 w-3.5 text-slate-400" /> Baixar (retomável)
					</button>
				{/if}

				{#if tNode.permission === 'owner'}
					<button type="button" onclick={() => runMenuAction((n) => n && (shareNode = n))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white">
						<Share2 class="h-3.5 w-3.5 text-accent-400" /> Compartilhar
					</button>
					<button type="button" onclick={() => runMenuAction((n) => n && toggleStar(n))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white">
						<Star class="h-3.5 w-3.5 {tNode.is_starred ? 'fill-amber-400 text-amber-400' : 'text-slate-400'}" />
						{tNode.is_starred ? 'Remover dos favoritos' : 'Favoritar'}
					</button>
					<button type="button" onclick={() => runMenuAction((n) => n && (moveNodes = [n]))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white">
						<FolderInput class="h-3.5 w-3.5 text-slate-400" /> Mover para...
					</button>
				{/if}

				{#if tNode.type === 'file'}
					<button type="button" onclick={() => runMenuAction((n) => n && copyFile(n))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white">
						<Copy class="h-3.5 w-3.5 text-slate-400" /> Duplicar
					</button>
				{/if}

				{#if tNode.permission === 'owner' || tNode.permission === 'editor'}
					<button
						type="button"
						onclick={() =>
							runMenuAction((n) => {
								if (!n) return;
								renameNode = n;
								renameValue = n.name;
							})}
						class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white"
					>
						<Pencil class="h-3.5 w-3.5 text-slate-400" /> Renomear
					</button>
					<div class="my-1 border-t border-[#1f2d45]"></div>
					<button type="button" onclick={() => runMenuAction((n) => n && trashNode(n))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-rose-300 hover:bg-rose-500/20">
						<Trash2 class="h-3.5 w-3.5" /> Mover para lixeira
					</button>
				{/if}
			{/if}
		{:else}
			{#if canWriteHere}
				<button type="button" onclick={() => runMenuAction(() => fileInputEl?.click())} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white">
					<Upload class="h-3.5 w-3.5 text-accent-400" /> Fazer upload de arquivos
				</button>
				<button
					type="button"
					onclick={() =>
						runMenuAction(() => {
							newFolderName = '';
							showNewFolderModal = true;
						})}
					class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white"
				>
					<FolderPlus class="h-3.5 w-3.5 text-accent-400" /> Nova pasta
				</button>
				<div class="my-1 border-t border-[#1f2d45]"></div>
			{/if}
			<button type="button" onclick={() => runMenuAction(() => (selectedIds = new Set(nodes.map((n) => n.id))))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white">
				<CheckSquare class="h-3.5 w-3.5 text-slate-400" /> Selecionar tudo
			</button>
			<button type="button" onclick={() => runMenuAction(() => setDisplayMode(displayMode === 'grid' ? 'list' : 'grid'))} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white">
				{#if displayMode === 'grid'}
					<List class="h-3.5 w-3.5 text-slate-400" /> Mudar para Lista
				{:else}
					<LayoutGrid class="h-3.5 w-3.5 text-slate-400" /> Mudar para Grade
				{/if}
			</button>
			<button type="button" onclick={() => runMenuAction(() => loadNodes())} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white">
				<RefreshCw class="h-3.5 w-3.5 text-slate-400" /> Atualizar pasta
			</button>
		{/if}
	</div>
{/if}

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
				class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 text-sm text-white outline-none focus:border-accent-500"
			/>
			<div class="mt-4 flex justify-end gap-2">
				<button type="button" onclick={() => (showNewFolderModal = false)} class="rounded-xl border border-[#233047] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-[#19253b]">Cancelar</button>
				<button type="submit" class="rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500">Criar Pasta</button>
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
				class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 text-sm text-white outline-none focus:border-accent-500"
			/>
			<div class="mt-4 flex justify-end gap-2">
				<button type="button" onclick={() => (renameNode = null)} class="rounded-xl border border-[#233047] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-[#19253b]">Cancelar</button>
				<button type="submit" class="rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500">Salvar</button>
			</div>
		</form>
	</div>
{/if}

{#if previewNode}
	<PreviewModal
		node={previewNode}
		onClose={() => (previewNode = null)}
		onRequestCrop={(n) => {
			previewNode = null;
			cropNode = n;
		}}
	/>
{/if}

{#if cropNode}
	<ImageCropModal
		node={cropNode}
		onClose={() => (cropNode = null)}
		onSaved={loadNodes}
	/>
{/if}

{#if shareNode}
	<ShareModal
		node={shareNode}
		onClose={() => (shareNode = null)}
		onUpdated={loadNodes}
	/>
{/if}

{#if moveNodes}
	<MoveModal
		nodes={moveNodes}
		onClose={() => (moveNodes = null)}
		onMoved={loadNodes}
	/>
{/if}
