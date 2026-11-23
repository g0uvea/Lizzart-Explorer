<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import type { BreadcrumbItem, StorageNode } from '$lib/types';
	import { quotaStore } from '$lib/stores/quota.svelte';
	import { workspaceStore } from '$lib/stores/workspace.svelte';
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
		MoreVertical,
		Layers,
		Shield,
		Play
	} from 'lucide-svelte';

	let { data } = $props();

	let view = $derived($page.url.searchParams.get('view') || 'drive');
	let parentId = $derived($page.url.searchParams.get('folder') || null);
	let activeWs = $derived(workspaceStore.active);
	let activeWsId = $derived(activeWs?.id ?? null);

	let nodes = $state<StorageNode[]>([]);
	let breadcrumbs = $state<BreadcrumbItem[]>([]);
	let currentPermission = $state<'owner' | 'editor' | 'viewer'>('viewer');
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

	// Custom Context Menu (floating on desktop, bottom-sheet on mobile)
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

	let failedThumbs = $state<Set<string>>(new Set());
	function markThumbFailed(id: string) {
		const next = new Set(failedThumbs);
		next.add(id);
		failedThumbs = next;
	}

	let renameNode = $state<StorageNode | null>(null);
	let renameValue = $state('');

	let selectedNodes = $derived(nodes.filter((n) => selectedIds.has(n.id)));

	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	function handleSearchInput(val: string) {
		searchQuery = val;
		if (searchTimer) clearTimeout(searchTimer);
		const delay = data.perf?.searchDebounceMs ?? 280;
		searchTimer = setTimeout(() => {
			debouncedSearch = val.trim();
		}, delay);
	}

	async function loadNodes() {
		selectedIds = new Set();
		contextMenu = null;

		if (view !== 'shared' && !activeWsId) {
			nodes = [];
			breadcrumbs = [{ id: null, name: 'Sem Workspace' }];
			currentPermission = 'viewer';
			loading = false;
			return;
		}

		loading = true;
		try {
			const params = new URLSearchParams();
			params.set('view', view);
			if (activeWsId && view !== 'shared') params.set('workspaceId', activeWsId);
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
			currentPermission = payload.currentPermission || 'viewer';
			if (payload.quota && activeWs) {
				quotaStore.sync(payload.quota.used_bytes, payload.quota.quota_bytes, activeWs.name);
				workspaceStore.updateActiveUsage(payload.quota.used_bytes, payload.quota.quota_bytes);
			}
		} catch {
			toast.error('Erro de conexão ao listar arquivos.');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void view;
		void activeWsId;
		void parentId;
		void debouncedSearch;
		void sortBy;
		void sortDir;
		void dragStore.version;
		loadNodes();
	});

	let canWriteHere = $derived(
		!debouncedSearch &&
			((view === 'drive' && Boolean(activeWsId)) || (view === 'shared' && Boolean(parentId))) &&
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
		if (activeWsId && view !== 'shared') params.set('ws', activeWsId);
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

		// Touch / small screen convenience: single tap on a folder opens it directly if already selected or on touch viewport
		const isTouchSmall = typeof window !== 'undefined' && window.innerWidth < 640;
		if (isTouchSmall && !node.is_trashed) {
			if (node.type === 'folder') {
				openFolder(node.id);
				return;
			}
			previewNode = node;
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

	function onNodeDragStart(e: DragEvent, node: StorageNode) {
		if (node.is_trashed || (node.permission !== 'owner' && node.permission !== 'editor')) {
			e.preventDefault();
			return;
		}
		contextMenu = null;

		let itemsToDrag: StorageNode[];
		if (selectedIds.has(node.id)) {
			itemsToDrag = selectedNodes.filter(
				(n) => !n.is_trashed && (n.permission === 'owner' || n.permission === 'editor')
			);
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
		if (dragStore.draggingIds.has(targetFolder.id)) return;
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

	// Marquee strictly confined to contentAreaEl (desktop mouse only)
	function onContentMouseDown(e: MouseEvent) {
		if (e.button !== 0 || !contentAreaEl || window.innerWidth < 640) return;
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
				'Selecione uma Workspace com permissão de Gestor/Editor ou uma pasta compartilhada editável para fazer upload.'
			);
			return;
		}

		const targetWsId = activeWsId || '';
		transferManager.enqueueUploads(files, targetWsId, parentId, () => {
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
			body: JSON.stringify({
				name: newFolderName.trim(),
				workspaceId: activeWsId,
				parentId
			})
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
		const res = await fetch(`/api/files/${node.id}/copy`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ workspaceId: activeWsId || node.workspace_id })
		});
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
		} else {
			const payload = await res.json().catch(() => ({}));
			toast.error(payload.error || 'Sem permissão para exclusão permanente.');
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
		if (!activeWsId) return;
		if (!confirm('Esvaziar toda a lixeira desta workspace e apagar os arquivos permanentemente?')) {
			return;
		}
		const res = await fetch('/api/files/trash/empty', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ workspaceId: activeWsId })
		});
		if (res.ok) {
			toast.success('Lixeira esvaziada com sucesso!');
			await loadNodes();
		} else {
			const payload = await res.json().catch(() => ({}));
			toast.error(payload.error || 'Sem permissão para esvaziar lixeira.');
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
	<title>{activeWs ? activeWs.name : 'Arquivos'} — Lizzart Explorer</title>
</svelte:head>

<div
	class="relative flex min-h-full min-w-0 flex-1 flex-col p-3 sm:p-6 lg:p-8"
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
			<div class="flex flex-col items-center rounded-3xl border-2 border-dashed border-accent-400 bg-[#131c2e]/95 px-6 py-8 text-center shadow-2xl sm:px-14 sm:py-12">
				<CloudUpload class="mb-4 h-12 w-12 text-accent-400 sm:h-16 sm:w-16" />
				<h2 class="text-lg font-bold text-white sm:text-xl">Solte seus arquivos aqui</h2>
				<p class="mt-1 text-xs text-slate-300 sm:text-sm">
					Upload retomável em blocos de 8 MB (até 20 MB em rede ultra-estável)
				</p>
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

	<!-- No Workspace Connected State -->
	{#if view !== 'shared' && !activeWs}
		<div class="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
			<div class="w-full max-w-md rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-6 shadow-2xl sm:p-8">
				<div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-500/15 text-accent-400">
					<Layers class="h-7 w-7" />
				</div>
				<h1 class="text-lg font-bold text-white sm:text-xl">Nenhuma Workspace Conectada</h1>
				<p class="mt-2 text-xs leading-relaxed text-slate-400 sm:text-sm">
					{#if data.user.role === 'admin'}
						Contas e Workspaces são independentes. Crie uma workspace com cota dedicada e conecte sua conta (ou sua equipe) pelo Painel Admin.
					{:else}
						Sua conta ainda não foi vinculada a nenhuma workspace. Peça a um administrador para conectá-lo a uma workspace.
					{/if}
				</p>
				<div class="mt-6 flex flex-col justify-center gap-2.5 sm:flex-row">
					{#if data.user.role === 'admin'}
						<a
							href="/admin"
							class="inline-flex items-center justify-center gap-2 rounded-xl bg-accent-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-accent-600/25 hover:bg-accent-500"
						>
							<Shield class="h-4 w-4" />
							Gerenciar Workspaces no Admin
						</a>
					{/if}
					<a
						href="/?view=shared"
						class="inline-flex items-center justify-center gap-2 rounded-xl border border-[#233047] bg-[#0e1525] px-4 py-2.5 text-xs font-medium text-slate-200 hover:bg-[#19253c]"
					>
						<Users class="h-4 w-4 text-accent-400" />
						Ver Compartilhados
					</a>
				</div>
			</div>
		</div>
	{:else}
		<!-- Top Header & Actions -->
		<div class="mb-3.5 flex flex-col gap-2.5 sm:mb-5 md:flex-row md:items-center md:justify-between">
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
						aria-label="Limpar busca"
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
						class="inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-accent-600 px-3 py-2.5 text-xs font-semibold text-white shadow-lg shadow-accent-600/25 transition hover:bg-accent-500 sm:flex-none sm:px-4 sm:text-sm"
					>
						<Upload class="h-4 w-4 shrink-0" />
						<span class="truncate">Upload</span>
					</button>
					<button
						type="button"
						onclick={() => {
							newFolderName = '';
							showNewFolderModal = true;
						}}
						class="inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-[#233047] bg-[#131c2e] px-3 py-2.5 text-xs font-medium text-slate-200 transition hover:border-accent-500/40 hover:bg-[#19253c] sm:flex-none sm:px-3.5 sm:text-sm"
					>
						<FolderPlus class="h-4 w-4 shrink-0 text-accent-400" />
						<span class="truncate">Nova Pasta</span>
					</button>
				{/if}

				{#if view === 'trash' && nodes.length > 0 && currentPermission === 'owner'}
					<button
						type="button"
						onclick={emptyTrash}
						class="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/15 px-3 py-2.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/25 sm:flex-none sm:text-sm"
					>
						<Trash2 class="h-4 w-4 shrink-0" />
						Esvaziar Lixeira
					</button>
				{/if}

				<div class="ml-auto flex shrink-0 items-center rounded-xl border border-[#1f2d45] bg-[#131c2e] p-1">
					<button
						type="button"
						onclick={() => setDisplayMode('grid')}
						class="rounded-lg p-1.5 transition {displayMode === 'grid'
							? 'bg-[#22304c] text-accent-300'
							: 'text-slate-400 hover:text-slate-200'}"
						title="Visualização em Grade"
						aria-label="Grade"
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
						aria-label="Lista"
					>
						<List class="h-4 w-4" />
					</button>
				</div>
			</div>
		</div>

		<!-- Breadcrumbs & Sort Bar -->
		<div class="mb-3.5 flex flex-col gap-2 border-b border-[#1a253a] pb-3 sm:mb-4 sm:flex-row sm:items-center sm:justify-between">
			<div class="no-scrollbar flex items-center gap-1 overflow-x-auto text-xs whitespace-nowrap sm:text-sm">
				{#each breadcrumbs as crumb, idx (crumb.id ?? 'root-' + idx)}
					{#if idx > 0}
						<ChevronRight class="h-3.5 w-3.5 shrink-0 text-slate-600" />
					{/if}
					<button
						type="button"
						onclick={() => openFolder(crumb.id)}
						ondragover={(e) => onCrumbDragOver(e, idx, crumb)}
						ondragleave={() => {
							if (dropHoverCrumbIdx === idx) dropHoverCrumbIdx = null;
						}}
						ondrop={(e) => onCrumbDrop(e, crumb)}
						class="shrink-0 rounded-lg px-2 py-1 font-medium transition {dropHoverCrumbIdx === idx
							? 'bg-accent-500/25 text-white ring-2 ring-accent-400'
							: idx === breadcrumbs.length - 1
								? 'text-white'
								: 'text-slate-400 hover:bg-[#131c2e] hover:text-slate-200'}"
					>
						{crumb.name}
					</button>
				{/each}
			</div>

			<div class="flex shrink-0 items-center gap-1 text-xs text-slate-400">
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
			class="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl"
		>
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
				<div class="grid grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
					{#each Array(6) as _, i (i)}
						<div class="h-32 animate-pulse rounded-2xl border border-[#1a253a] bg-[#131c2e]/60 sm:h-36"></div>
					{/each}
				</div>
			{:else if nodes.length === 0}
				<div class="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-[#233047] bg-[#0e1525]/50 px-4 py-14 text-center sm:py-20">
					<div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#131c2e] text-slate-500 sm:h-16 sm:w-16">
						<FolderOpen class="h-7 w-7 sm:h-8 sm:w-8" />
					</div>
					<h3 class="text-base font-semibold text-white">
						{#if debouncedSearch}
							Nenhum resultado para "{debouncedSearch}"
						{:else if view === 'trash'}
							A lixeira desta workspace está vazia
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
							Arraste arquivos para cá ou clique em "Upload" (blocos retomáveis de 8 MB até 20 MB em rede ultra-estável).
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
				<div class="grid grid-cols-2 gap-3 pb-6 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
					{#each nodes as node (node.id)}
						{@const isSelected = selectedIds.has(node.id)}
						{@const isDragging = dragStore.draggingIds.has(node.id)}
						{@const isDropTarget = dropHoverFolderId === node.id}
						{@const cat =
							node.type === 'file'
								? getFileCategory('file', node.mime_type, node.name)
								: 'folder'}
						{@const hasVisualThumb =
							node.type === 'file' &&
							!node.is_trashed &&
							(cat === 'image' || cat === 'video') &&
							!failedThumbs.has(node.id)}
						<div
							data-node-id={node.id}
							draggable={!node.is_trashed && (node.permission === 'owner' || node.permission === 'editor')}
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
							class="group flex min-w-0 flex-col overflow-hidden rounded-2xl border transition {isDragging
								? 'opacity-45'
								: ''} {isDropTarget
								? 'scale-[1.02] border-accent-400 bg-accent-500/20 shadow-2xl ring-2 ring-accent-400'
								: isSelected
									? 'border-accent-400 bg-[#18273e] shadow-xl ring-2 ring-accent-500/35'
									: 'border-[#1f2d45] bg-[#131c2e] hover:border-accent-500/40 hover:bg-[#172238] hover:shadow-xl hover:shadow-black/30'}"
						>
							<!-- Uniform Square Thumbnail Area (1:1 aspect-square for all cards: Videos, Photos, Folders & Files) -->
							<div class="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-[#0e1525]">
								{#if hasVisualThumb}
									<img
										src="/api/files/{node.id}/thumb?v={encodeURIComponent(node.updated_at)}"
										alt={node.name}
										loading="lazy"
										decoding="async"
										draggable="false"
										onerror={() => markThumbFailed(node.id)}
										class="h-full w-full object-cover transition duration-300 group-hover:scale-105"
									/>
									{#if cat === 'video'}
										<div class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25 transition group-hover:bg-black/35">
											<div class="flex h-10 w-10 items-center justify-center rounded-full bg-black/65 text-white shadow-lg ring-1 ring-white/20">
												<Play class="ml-0.5 h-4 w-4 fill-white" />
											</div>
										</div>
									{/if}
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
									<div class="absolute top-2 left-2 flex max-w-[70%] flex-wrap items-center gap-1">
										{#if node.permission && node.permission !== 'owner'}
											<span class="rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-accent-300">
												{node.permission === 'editor' ? 'Editor' : 'Leitor'}
											</span>
										{/if}
										{#if (node.share_count ?? 0) > 0}
											<span class="inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] text-sky-300">
												<Users class="h-2.5 w-2.5" /> {node.share_count}
											</span>
										{/if}
										{#if (node.link_count ?? 0) > 0}
											<span class="inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] text-accent-300">
												<Link2 class="h-2.5 w-2.5" /> {node.link_count}
											</span>
										{/if}
									</div>
								{/if}

								{#if !node.is_trashed && (node.permission === 'owner' || node.permission === 'editor')}
									<button
										type="button"
										onclick={(e) => {
											e.stopPropagation();
											toggleStar(node);
										}}
										class="absolute top-2 right-2 rounded-lg bg-black/55 p-1.5 transition hover:bg-black/80"
										title={node.is_starred ? 'Remover dos favoritos' : 'Favoritar'}
										aria-label={node.is_starred ? 'Remover dos favoritos' : 'Favoritar'}
									>
										<Star
											class="h-3.5 w-3.5 {node.is_starred
												? 'fill-amber-400 text-amber-400'
												: 'text-slate-300'}"
										/>
									</button>
								{/if}
							</div>

							<div class="flex min-w-0 flex-1 flex-col justify-between p-2.5 sm:p-3.5">
								<div class="flex min-w-0 items-start justify-between gap-1">
									<div class="min-w-0 flex-1">
										<p class="truncate text-xs font-semibold text-white sm:text-sm" title={node.name}>
											{node.name}
										</p>
										<p class="mt-0.5 truncate text-[10px] text-slate-400 sm:text-[11px]">
											{node.type === 'folder' ? 'Pasta' : formatBytes(node.size_bytes)}
											<span class="hidden sm:inline"> • {formatDate(node.updated_at)}</span>
										</p>
										{#if view === 'shared' && node.workspace_name}
											<p class="mt-0.5 truncate text-[10px] text-slate-500">{node.workspace_name}</p>
										{/if}
									</div>
									<button
										type="button"
										onclick={(e) => openMenuFromButton(e, node)}
										class="-mr-1 shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white"
										aria-label="Opções de {node.name}"
									>
										<MoreVertical class="h-4 w-4" />
									</button>
								</div>

								<div class="mt-2.5 hidden flex-wrap items-center gap-1 border-t border-[#1f2d45] pt-2 sm:flex">
									{#if node.is_trashed}
										<button
											type="button"
											onclick={(e) => {
												e.stopPropagation();
												restoreNode(node);
											}}
											class="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent-500/15 py-1 text-[11px] font-medium text-accent-300 hover:bg-accent-500/25"
										>
											<RotateCcw class="h-3.5 w-3.5" /> Restaurar
										</button>
										{#if node.permission === 'owner'}
											<button
												type="button"
												onclick={(e) => {
													e.stopPropagation();
													deletePermanent(node);
												}}
												class="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-rose-500/15 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-500/25"
											>
												<Trash2 class="h-3.5 w-3.5" /> Excluir
											</button>
										{/if}
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
										{/if}
										{#if node.permission === 'owner' || node.permission === 'editor'}
											<button type="button" onclick={(e) => { e.stopPropagation(); moveNodes = [node]; }} class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white" title="Mover"><FolderInput class="h-3.5 w-3.5" /></button>
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
				<!-- RESPONSIVE LIST VIEW -->
				<div class="w-full overflow-x-auto rounded-2xl border border-[#1f2d45] bg-[#131c2e]">
					<table class="w-full table-fixed text-left text-sm sm:table-auto">
						<thead class="border-b border-[#1f2d45] bg-[#0e1525] text-xs uppercase tracking-wider text-slate-400">
							<tr>
								<th class="w-auto px-3 py-3 sm:px-4">Nome</th>
								<th class="w-20 px-2 py-3 sm:w-auto sm:px-3">Tam.</th>
								<th class="hidden px-4 py-3 md:table-cell">Modificado</th>
								<th class="w-14 px-2 py-3 text-right sm:w-auto sm:px-4">Ações</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-[#1a253a]">
							{#each nodes as node (node.id)}
								{@const isSelected = selectedIds.has(node.id)}
								{@const isDragging = dragStore.draggingIds.has(node.id)}
								{@const isDropTarget = dropHoverFolderId === node.id}
								<tr
									data-node-id={node.id}
									draggable={!node.is_trashed && (node.permission === 'owner' || node.permission === 'editor')}
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
									<td class="px-3 py-3 sm:px-4">
										<div class="flex min-w-0 items-center gap-2.5">
											<FileIcon type={node.type} mime={node.mime_type} name={node.name} size="md" />
											<div class="min-w-0 flex-1">
												<span class="block truncate text-xs font-medium text-white sm:text-sm">{node.name}</span>
											</div>
											{#if node.is_starred}
												<Star class="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
											{/if}
										</div>
									</td>
									<td class="whitespace-nowrap px-2 py-3 font-mono text-[11px] text-slate-400 sm:px-3 sm:text-xs">
										{node.type === 'folder' ? '—' : formatBytes(node.size_bytes)}
									</td>
									<td class="hidden whitespace-nowrap px-4 py-3 text-xs text-slate-400 md:table-cell">
										{formatDate(node.updated_at)}
									</td>
									<td class="px-2 py-3 sm:px-4">
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
	{/if}
</div>

<!-- CUSTOM CONTEXT MENU (Mobile Bottom Sheet on <640px, Floating Clamped Menu on Desktop!) -->
{#if contextMenu}
	{@const tNode = contextMenu.targetNode}
	{@const isMulti = selectedNodes.length > 1 && (!tNode || selectedIds.has(tNode.id))}

	<!-- Mobile backdrop -->
	<button
		type="button"
		onclick={() => (contextMenu = null)}
		class="fixed inset-0 z-[75] bg-black/60 sm:hidden"
		aria-label="Fechar menu de opções"
	></button>

	<div
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			if (e.key === 'Escape') contextMenu = null;
		}}
		oncontextmenu={(e) => e.preventDefault()}
		role="menu"
		tabindex="-1"
		class="fixed inset-x-0 bottom-0 z-[80] max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-[#2a3b58] bg-[#111929]/98 py-2 pb-safe text-sm shadow-2xl backdrop-blur-xl sm:inset-auto sm:w-58 sm:max-h-[calc(100dvh-16px)] sm:rounded-xl sm:border sm:py-1.5 sm:text-xs"
		style="--ctx-x: {contextMenu.x}px; --ctx-y: {contextMenu.y}px;"
	>
		<!-- Mobile handle -->
		<div class="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-600/70 sm:hidden"></div>

		{#if isMulti}
			<div class="border-b border-[#1f2d45] px-4 py-2 text-xs font-semibold text-accent-300 sm:px-3 sm:py-1.5 sm:text-[11px]">
				{selectedNodes.length} itens selecionados
			</div>
			{#if view === 'trash'}
				<button type="button" onclick={() => runMenuAction((_, m) => bulkRestore(m))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2">
					<RotateCcw class="h-4 w-4 text-accent-400 sm:h-3.5 sm:w-3.5" /> Restaurar selecionados
				</button>
				{#if currentPermission === 'owner'}
					<button type="button" onclick={() => runMenuAction((_, m) => bulkDeletePermanent(m))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-rose-300 hover:bg-rose-500/20 sm:gap-2.5 sm:px-3 sm:py-2">
						<Trash2 class="h-4 w-4 sm:h-3.5 sm:w-3.5" /> Excluir permanentemente
					</button>
				{/if}
			{:else}
				<button type="button" onclick={() => runMenuAction((_, m) => bulkDownload(m))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2">
					<Download class="h-4 w-4 text-accent-400 sm:h-3.5 sm:w-3.5" /> Baixar selecionados
				</button>
				{#if selectedNodes.every((n) => n.permission === 'owner' || n.permission === 'editor')}
					<button type="button" onclick={() => runMenuAction((_, m) => (moveNodes = m))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2">
						<FolderInput class="h-4 w-4 text-slate-400 sm:h-3.5 sm:w-3.5" /> Mover selecionados
					</button>
					<div class="my-1 border-t border-[#1f2d45]"></div>
					<button type="button" onclick={() => runMenuAction((_, m) => bulkTrash(m))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-rose-300 hover:bg-rose-500/20 sm:gap-2.5 sm:px-3 sm:py-2">
						<Trash2 class="h-4 w-4 sm:h-3.5 sm:w-3.5" /> Mover para lixeira
					</button>
				{/if}
			{/if}
		{:else if tNode}
			<div class="truncate border-b border-[#1f2d45] px-4 py-2 text-xs font-semibold text-slate-300 sm:px-3 sm:py-1.5 sm:text-[11px] sm:text-slate-400">
				{tNode.name}
			</div>
			{#if tNode.is_trashed}
				<button type="button" onclick={() => runMenuAction((n) => n && restoreNode(n))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2">
					<RotateCcw class="h-4 w-4 text-accent-400 sm:h-3.5 sm:w-3.5" /> Restaurar
				</button>
				{#if tNode.permission === 'owner'}
					<button type="button" onclick={() => runMenuAction((n) => n && deletePermanent(n))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-rose-300 hover:bg-rose-500/20 sm:gap-2.5 sm:px-3 sm:py-2">
						<Trash2 class="h-4 w-4 sm:h-3.5 sm:w-3.5" /> Excluir permanentemente
					</button>
				{/if}
			{:else}
				{#if tNode.type === 'folder'}
					<button type="button" onclick={() => runMenuAction((n) => n && openFolder(n.id))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2">
						<FolderOpen class="h-4 w-4 text-accent-400 sm:h-3.5 sm:w-3.5" /> Abrir pasta
					</button>
				{:else}
					<button type="button" onclick={() => runMenuAction((n) => n && (previewNode = n))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2">
						<Eye class="h-4 w-4 text-accent-400 sm:h-3.5 sm:w-3.5" /> Visualizar / Reproduzir
					</button>
					{#if canCropNode(tNode)}
						<button type="button" onclick={() => runMenuAction((n) => n && (cropNode = n))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2">
							<Crop class="h-4 w-4 text-accent-400 sm:h-3.5 sm:w-3.5" /> Recortar bordas
						</button>
					{/if}
					<button type="button" onclick={() => runMenuAction((n) => n && downloadNode(n))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2">
						<Download class="h-4 w-4 text-slate-400 sm:h-3.5 sm:w-3.5" /> Baixar (retomável)
					</button>
				{/if}

				{#if tNode.permission === 'owner'}
					<button type="button" onclick={() => runMenuAction((n) => n && (shareNode = n))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2">
						<Share2 class="h-4 w-4 text-accent-400 sm:h-3.5 sm:w-3.5" /> Compartilhar
					</button>
				{/if}

				{#if tNode.permission === 'owner' || tNode.permission === 'editor'}
					<button type="button" onclick={() => runMenuAction((n) => n && toggleStar(n))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2">
						<Star class="h-4 w-4 sm:h-3.5 sm:w-3.5 {tNode.is_starred ? 'fill-amber-400 text-amber-400' : 'text-slate-400'}" />
						{tNode.is_starred ? 'Remover dos favoritos' : 'Favoritar'}
					</button>
					<button type="button" onclick={() => runMenuAction((n) => n && (moveNodes = [n]))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2">
						<FolderInput class="h-4 w-4 text-slate-400 sm:h-3.5 sm:w-3.5" /> Mover para...
					</button>
				{/if}

				{#if tNode.type === 'file' && (tNode.permission === 'owner' || tNode.permission === 'editor')}
					<button type="button" onclick={() => runMenuAction((n) => n && copyFile(n))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2">
						<Copy class="h-4 w-4 text-slate-400 sm:h-3.5 sm:w-3.5" /> Duplicar
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
						class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2"
					>
						<Pencil class="h-4 w-4 text-slate-400 sm:h-3.5 sm:w-3.5" /> Renomear
					</button>
					<div class="my-1 border-t border-[#1f2d45]"></div>
					<button type="button" onclick={() => runMenuAction((n) => n && trashNode(n))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-rose-300 hover:bg-rose-500/20 sm:gap-2.5 sm:px-3 sm:py-2">
						<Trash2 class="h-4 w-4 sm:h-3.5 sm:w-3.5" /> Mover para lixeira
					</button>
				{/if}
			{/if}
		{:else}
			{#if canWriteHere}
				<button type="button" onclick={() => runMenuAction(() => fileInputEl?.click())} class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2">
					<Upload class="h-4 w-4 text-accent-400 sm:h-3.5 sm:w-3.5" /> Fazer upload de arquivos
				</button>
				<button
					type="button"
					onclick={() =>
						runMenuAction(() => {
							newFolderName = '';
							showNewFolderModal = true;
						})}
					class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2"
				>
					<FolderPlus class="h-4 w-4 text-accent-400 sm:h-3.5 sm:w-3.5" /> Nova pasta
				</button>
				<div class="my-1 border-t border-[#1f2d45]"></div>
			{/if}
			<button type="button" onclick={() => runMenuAction(() => (selectedIds = new Set(nodes.map((n) => n.id))))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2">
				<CheckSquare class="h-4 w-4 text-slate-400 sm:h-3.5 sm:w-3.5" /> Selecionar tudo
			</button>
			<button type="button" onclick={() => runMenuAction(() => setDisplayMode(displayMode === 'grid' ? 'list' : 'grid'))} class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2">
				{#if displayMode === 'grid'}
					<List class="h-4 w-4 text-slate-400 sm:h-3.5 sm:w-3.5" /> Mudar para Lista
				{:else}
					<LayoutGrid class="h-4 w-4 text-slate-400 sm:h-3.5 sm:w-3.5" /> Mudar para Grade
				{/if}
			</button>
			<button type="button" onclick={() => runMenuAction(() => loadNodes())} class="flex w-full items-center gap-3 px-4 py-3 text-left text-slate-200 hover:bg-accent-500/20 hover:text-white sm:gap-2.5 sm:px-3 sm:py-2">
				<RefreshCw class="h-4 w-4 text-slate-400 sm:h-3.5 sm:w-3.5" /> Atualizar pasta
			</button>
		{/if}
	</div>
{/if}

<style>
	@media (min-width: 640px) {
		[role='menu'] {
			left: var(--ctx-x);
			top: var(--ctx-y);
		}
	}
</style>

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
		workspaceId={moveNodes[0]?.workspace_id || activeWsId || ''}
		onClose={() => (moveNodes = null)}
		onMoved={loadNodes}
	/>
{/if}
