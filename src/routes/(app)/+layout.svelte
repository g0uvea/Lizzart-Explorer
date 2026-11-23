<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/stores';
	import { goto, invalidateAll } from '$app/navigation';
	import { quotaStore } from '$lib/stores/quota.svelte';
	import { workspaceStore } from '$lib/stores/workspace.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { i18n } from '$lib/stores/i18n.svelte';
	import { dragStore, LIZZART_DRAG_MIME } from '$lib/stores/drag.svelte';
	import { transferManager } from '$lib/stores/transfers.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatBytes, getInitials } from '$lib/utils';
	import {
		HardDrive,
		Clock,
		Star,
		Users,
		Trash2,
		Shield,
		Server,
		LogOut,
		Menu,
		X,
		Settings,
		Database,
		Layers,
		ChevronDown,
		Check,
		Plus,
		Puzzle,
		FileText
	} from 'lucide-svelte';

	let { data, children } = $props();
	let mobileOpen = $state(false);
	let wsDropdownOpen = $state(false);
	let sidebarDropTarget = $state<'root' | 'starred' | 'trash' | null>(null);

	onMount(() => {
		transferManager.restorePendingTransfers(() => {
			dragStore.notifyChanged();
		});
	});

	$effect(() => {
		const u = data.user;
		const wsList = data.workspaces || [];
		const urlWs = $page.url.searchParams.get('ws');
		untrack(() => {
			if (u) {
				themeStore.init(u.accent_color, u.layout_density);
				i18n.init(u.language, u.country);
			}
			workspaceStore.sync(wsList, urlWs);
		});
	});

	$effect(() => {
		const activeWs = workspaceStore.active;
		if (activeWs) {
			quotaStore.sync(activeWs.used_bytes, activeWs.quota_bytes, activeWs.name);
		} else {
			quotaStore.clear();
		}
	});

	let currentPath = $derived($page.url.pathname);
	let currentView = $derived($page.url.searchParams.get('view') || 'drive');
	let activeWs = $derived(workspaceStore.active);

	let quotaBarPercent = $derived.by(() => {
		if (!quotaStore.hasWorkspace || quotaStore.usedBytes <= 0) return 0;
		if (quotaStore.quotaBytes < 0) {
			return Math.min(100, Math.max(3, Math.round(Math.log10(quotaStore.usedBytes / 1024 + 1) * 12)));
		}
		if (quotaStore.quotaBytes === 0) return 0;
		return Math.min(100, Math.max(1, Math.round((quotaStore.usedBytes / quotaStore.quotaBytes) * 100)));
	});

	function isNavActive(path: string, view?: string): boolean {
		if (path === '/') {
			return currentPath === '/' && currentView === (view || 'drive');
		}
		return currentPath.startsWith(path);
	}

	function roleLabel(role: string): string {
		if (role === 'manager') return i18n.t('role.manager');
		if (role === 'editor') return i18n.t('role.editor');
		return i18n.t('role.viewer');
	}

	function selectWorkspace(wsId: string) {
		workspaceStore.setActive(wsId);
		wsDropdownOpen = false;
		mobileOpen = false;
		if (currentPath === '/') {
			const params = new URLSearchParams();
			params.set('ws', wsId);
			if (currentView !== 'drive' && currentView !== 'shared') {
				params.set('view', currentView);
			}
			goto(`/?${params.toString()}`);
		} else if (currentPath.startsWith('/notes')) {
			goto(`/notes?ws=${encodeURIComponent(wsId)}`);
		} else {
			goto(`/?ws=${encodeURIComponent(wsId)}`);
		}
	}

	function navHref(viewName?: string): string {
		const params = new URLSearchParams();
		if (viewName && viewName !== 'drive') params.set('view', viewName);
		if (activeWs && viewName !== 'shared') params.set('ws', activeWs.id);
		const qs = params.toString();
		return qs ? `/?${qs}` : '/';
	}

	function onNavDragOver(e: DragEvent, target: 'root' | 'starred' | 'trash') {
		if (!dragStore.active && !e.dataTransfer?.types.includes(LIZZART_DRAG_MIME)) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		sidebarDropTarget = target;
	}

	async function onNavDrop(e: DragEvent, target: 'root' | 'starred' | 'trash') {
		e.preventDefault();
		sidebarDropTarget = null;
		const items = [...dragStore.draggingNodes];
		dragStore.end();
		if (items.length === 0) return;

		if (target === 'root') {
			for (const item of items) {
				if (item.permission !== 'owner' && item.permission !== 'editor') continue;
				await fetch(`/api/files/${item.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ parent_id: null })
				});
			}
			toast.success(
				items.length === 1
					? `"${items[0].name}" movido para a raiz da workspace!`
					: `${items.length} itens movidos para a raiz da workspace!`
			);
			dragStore.notifyChanged();
		} else if (target === 'starred') {
			for (const item of items) {
				if (item.permission !== 'owner' && item.permission !== 'editor') continue;
				await fetch(`/api/files/${item.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ is_starred: true })
				});
			}
			toast.success(
				items.length === 1
					? `"${items[0].name}" adicionado aos Favoritos!`
					: `${items.length} itens adicionados aos Favoritos!`
			);
			dragStore.notifyChanged();
		} else if (target === 'trash') {
			for (const item of items) {
				if (item.permission !== 'owner' && item.permission !== 'editor') continue;
				await fetch(`/api/files/${item.id}`, { method: 'DELETE' });
			}
			toast.info(
				items.length === 1
					? `"${items[0].name}" movido para a Lixeira.`
					: `${items.length} itens movidos para a Lixeira.`
			);
			dragStore.notifyChanged();
		}
	}

	async function logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		toast.info('Você saiu da sua conta.');
		await invalidateAll();
		await goto('/login');
	}
</script>

<div class="flex h-dvh w-full overflow-hidden bg-[#0b101b] text-slate-100">
	{#if mobileOpen}
		<button
			type="button"
			onclick={() => {
				mobileOpen = false;
				wsDropdownOpen = false;
			}}
			class="fixed inset-0 z-30 bg-black/65 backdrop-blur-xs lg:hidden"
			aria-label="Fechar menu"
		></button>
	{/if}

	<!-- Sidebar -->
	<aside
		class="fixed inset-y-0 left-0 z-40 flex w-[82vw] max-w-72 shrink-0 flex-col border-r border-[#1a253a] bg-[#0e1525] transition-transform duration-200 lg:static lg:w-64 lg:translate-x-0 {mobileOpen
			? 'translate-x-0'
			: '-translate-x-full'}"
	>
		<!-- Top Header: Active Workspace Icon, Name & User Role (replaces static app brand) -->
		<div class="relative px-3 pt-3.5 pb-3">
			<div class="flex items-center gap-2">
				{#if activeWs}
					<button
						type="button"
						onclick={() => (wsDropdownOpen = !wsDropdownOpen)}
						class="flex min-w-0 flex-1 items-center justify-between gap-2.5 rounded-xl border border-[#1f2d45] bg-[#131c2e] px-3 py-2.5 text-left transition hover:border-accent-500/40"
					>
						<div class="flex min-w-0 items-center gap-3">
							<span
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-lg"
								style="background-color: {activeWs.color}"
							>
								<Layers class="h-5 w-5" />
							</span>
							<div class="min-w-0">
								<span class="block truncate text-sm font-bold tracking-tight text-white">
									{activeWs.name}
								</span>
								<span class="block truncate text-[11px] text-slate-400">
									Workspace • {roleLabel(activeWs.role)}
								</span>
							</div>
						</div>
						<ChevronDown class="h-4 w-4 shrink-0 text-slate-400 transition {wsDropdownOpen ? 'rotate-180' : ''}" />
					</button>
				{:else}
					<div class="flex min-w-0 flex-1 items-center justify-between gap-2.5 rounded-xl border border-dashed border-[#233047] bg-[#111929]/70 px-3 py-2.5 text-xs">
						<div class="flex min-w-0 items-center gap-3">
							<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#19253c] text-slate-400">
								<Layers class="h-5 w-5" />
							</div>
							<div class="min-w-0">
								<span class="block truncate text-sm font-bold text-slate-200">
									{i18n.t('nav.no_workspace')}
								</span>
								{#if data.user.role === 'admin'}
									<a
										href="/admin"
										onclick={() => (mobileOpen = false)}
										class="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-400 hover:underline"
									>
										<Plus class="h-3 w-3" /> {i18n.t('nav.create_connect_admin')}
									</a>
								{:else}
									<span class="block truncate text-[10px] text-slate-500">
										{i18n.t('nav.waiting_admin')}
									</span>
								{/if}
							</div>
						</div>
					</div>
				{/if}

				<button
					type="button"
					onclick={() => (mobileOpen = false)}
					class="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-[#19253c] hover:text-white lg:hidden"
					aria-label="Fechar menu lateral"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			{#if activeWs && wsDropdownOpen}
				<div class="absolute inset-x-3 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-[#2a3b58] bg-[#111929] p-1.5 shadow-2xl">
					<p class="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
						{i18n.t('nav.your_workspaces')} ({workspaceStore.workspaces.length})
					</p>
					{#each workspaceStore.workspaces as ws (ws.id)}
						<button
							type="button"
							onclick={() => selectWorkspace(ws.id)}
							class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition {ws.id === activeWs.id
								? 'bg-accent-500/15 text-white'
								: 'text-slate-300 hover:bg-[#19253c]'}"
						>
							<span class="flex min-w-0 items-center gap-2">
								<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background-color: {ws.color}"></span>
								<span class="truncate font-medium">{ws.name}</span>
							</span>
							<span class="flex shrink-0 items-center gap-1.5">
								<span class="text-[10px] text-slate-500">{roleLabel(ws.role)}</span>
								{#if ws.id === activeWs.id}
									<Check class="h-3.5 w-3.5 text-accent-400" />
								{/if}
							</span>
						</button>
					{/each}
					{#if data.user.role === 'admin'}
						<div class="my-1 border-t border-[#1f2d45]"></div>
						<a
							href="/admin"
							onclick={() => {
								wsDropdownOpen = false;
								mobileOpen = false;
							}}
							class="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-accent-300 hover:bg-accent-500/15"
						>
							<Plus class="h-3.5 w-3.5" />
							{i18n.t('nav.manage_workspaces')}
						</a>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Navigation -->
		<nav class="flex-1 space-y-5 overflow-y-auto px-3 py-1">
			<div>
				<p class="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
					{i18n.t('nav.storage')}
				</p>
				<div class="space-y-1">
					<a
						href={navHref('drive')}
						onclick={() => (mobileOpen = false)}
						ondragover={(e) => onNavDragOver(e, 'root')}
						ondragleave={() => {
							if (sidebarDropTarget === 'root') sidebarDropTarget = null;
						}}
						ondrop={(e) => onNavDrop(e, 'root')}
						class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition {sidebarDropTarget === 'root'
							? 'bg-accent-500/25 text-white ring-2 ring-accent-400'
							: isNavActive('/', 'drive')
								? 'bg-[#19253c] text-white shadow-xs ring-1 ring-accent-500/40'
								: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
					>
						<HardDrive class="h-4 w-4 shrink-0 {isNavActive('/', 'drive') || sidebarDropTarget === 'root' ? 'text-accent-400' : ''}" />
						<span class="truncate">{i18n.t('nav.files')}</span>
					</a>
					<a
						href={navHref('recent')}
						onclick={() => (mobileOpen = false)}
						class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition {isNavActive('/', 'recent')
							? 'bg-[#19253c] text-white shadow-xs ring-1 ring-accent-500/40'
							: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
					>
						<Clock class="h-4 w-4 shrink-0 {isNavActive('/', 'recent') ? 'text-accent-400' : ''}" />
						<span class="truncate">{i18n.t('nav.recent')}</span>
					</a>
					<a
						href={navHref('starred')}
						onclick={() => (mobileOpen = false)}
						ondragover={(e) => onNavDragOver(e, 'starred')}
						ondragleave={() => {
							if (sidebarDropTarget === 'starred') sidebarDropTarget = null;
						}}
						ondrop={(e) => onNavDrop(e, 'starred')}
						class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition {sidebarDropTarget === 'starred'
							? 'bg-amber-500/20 text-white ring-2 ring-amber-400'
							: isNavActive('/', 'starred')
								? 'bg-[#19253c] text-white shadow-xs ring-1 ring-accent-500/40'
								: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
					>
						<Star class="h-4 w-4 shrink-0 {isNavActive('/', 'starred') || sidebarDropTarget === 'starred' ? 'text-amber-400' : ''}" />
						<span class="truncate">{i18n.t('nav.starred')}</span>
					</a>
					<a
						href={navHref('shared')}
						onclick={() => (mobileOpen = false)}
						class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition {isNavActive('/', 'shared')
							? 'bg-[#19253c] text-white shadow-xs ring-1 ring-accent-500/40'
							: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
					>
						<Users class="h-4 w-4 shrink-0 {isNavActive('/', 'shared') ? 'text-accent-400' : ''}" />
						<span class="truncate">{i18n.t('nav.shared')}</span>
					</a>
					<a
						href={navHref('trash')}
						onclick={() => (mobileOpen = false)}
						ondragover={(e) => onNavDragOver(e, 'trash')}
						ondragleave={() => {
							if (sidebarDropTarget === 'trash') sidebarDropTarget = null;
						}}
						ondrop={(e) => onNavDrop(e, 'trash')}
						class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition {sidebarDropTarget === 'trash'
							? 'bg-rose-500/25 text-white ring-2 ring-rose-400'
							: isNavActive('/', 'trash')
								? 'bg-[#19253c] text-white shadow-xs ring-1 ring-rose-500/40'
								: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
					>
						<Trash2 class="h-4 w-4 shrink-0 {isNavActive('/', 'trash') || sidebarDropTarget === 'trash' ? 'text-rose-400' : ''}" />
						<span class="truncate">{i18n.t('nav.trash')}</span>
					</a>
				</div>
			</div>

			{#if data.plugins?.notes !== false}
				<div>
					<p class="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
						{i18n.t('nav.apps_section')}
					</p>
					<div class="space-y-1">
						<a
							href={activeWs ? `/notes?ws=${encodeURIComponent(activeWs.id)}` : '/notes'}
							onclick={() => (mobileOpen = false)}
							class="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition {isNavActive('/notes')
								? 'bg-[#19253c] text-white shadow-xs ring-1 ring-accent-500/40'
								: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
						>
							<span class="flex min-w-0 items-center gap-3">
								<FileText class="h-4 w-4 shrink-0 {isNavActive('/notes') ? 'text-accent-400' : ''}" />
								<span class="truncate">{i18n.t('nav.notes')}</span>
							</span>
							<span class="shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
								.md
							</span>
						</a>
					</div>
				</div>
			{/if}

			{#if data.user.role === 'admin'}
				<div>
					<p class="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
						{i18n.t('nav.admin_section')}
					</p>
					<div class="space-y-1">
						<a
							href="/admin"
							onclick={() => (mobileOpen = false)}
							class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition {isNavActive('/admin')
								? 'bg-[#19253c] text-white shadow-xs ring-1 ring-accent-500/40'
								: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
						>
							<Shield class="h-4 w-4 shrink-0 {isNavActive('/admin') ? 'text-accent-400' : ''}" />
							<span class="truncate">{i18n.t('nav.admin_panel')}</span>
						</a>
						<a
							href="/plugins"
							onclick={() => (mobileOpen = false)}
							class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition {isNavActive('/plugins')
								? 'bg-[#19253c] text-white shadow-xs ring-1 ring-accent-500/40'
								: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
						>
							<Puzzle class="h-4 w-4 shrink-0 {isNavActive('/plugins') ? 'text-accent-400' : ''}" />
							<span class="truncate">{i18n.t('nav.plugins')}</span>
						</a>
						{#if data.plugins?.mc_servers !== false}
							<a
								href="/minecraft"
								onclick={() => (mobileOpen = false)}
								class="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition {isNavActive('/minecraft')
									? 'bg-[#19253c] text-white shadow-xs ring-1 ring-accent-500/40'
									: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
							>
								<span class="flex min-w-0 items-center gap-3">
									<Server class="h-4 w-4 shrink-0 {isNavActive('/minecraft') ? 'text-accent-400' : ''}" />
									<span class="truncate">{i18n.t('nav.mc_servers')}</span>
								</span>
								<span class="shrink-0 rounded-md bg-accent-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-300">
									UI
								</span>
							</a>
						{/if}
					</div>
				</div>
			{/if}

			<div>
				<p class="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
					{i18n.t('nav.preferences')}
				</p>
				<a
					href="/profile"
					onclick={() => (mobileOpen = false)}
					class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition {isNavActive('/profile')
						? 'bg-[#19253c] text-white shadow-xs ring-1 ring-accent-500/40'
						: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
				>
					<Settings class="h-4 w-4 shrink-0 {isNavActive('/profile') ? 'text-accent-400' : ''}" />
					<span class="truncate">{i18n.t('nav.settings')}</span>
				</a>
			</div>
		</nav>

		<!-- Active Workspace Storage Quota Widget -->
		<div class="mx-3 mb-3 rounded-xl border border-[#1f2d45] bg-[#131c2e] p-3">
			{#if quotaStore.hasWorkspace}
				<div class="mb-2 flex items-center justify-between gap-2 text-xs">
					<span class="flex min-w-0 items-center gap-1.5 font-medium text-slate-300">
						<Database class="h-3.5 w-3.5 shrink-0 text-accent-400" />
						<span class="truncate">{quotaStore.workspaceName || 'Workspace'}</span>
					</span>
					<span class="shrink-0 font-mono text-[11px] text-slate-400">
						{quotaStore.quotaBytes < 0 ? '∞' : `${quotaBarPercent}%`}
					</span>
				</div>
				<div class="h-2 w-full overflow-hidden rounded-full bg-[#0b101b]">
					{#if quotaBarPercent > 0}
						<div
							class="h-full rounded-full transition-all duration-500 {quotaBarPercent > 85
								? 'bg-rose-500'
								: quotaBarPercent > 65
									? 'bg-amber-500'
									: 'bg-accent-500'}"
							style="width: {quotaBarPercent}%"
						></div>
					{/if}
				</div>
				<p class="mt-2 truncate text-[11px] text-slate-400">
					<strong class="text-slate-200">{formatBytes(quotaStore.usedBytes)}</strong> {i18n.t('nav.of')}
					{formatBytes(quotaStore.quotaBytes)}
				</p>
			{:else}
				<div class="flex items-center gap-2 text-[11px] text-slate-400">
					<Database class="h-3.5 w-3.5 shrink-0 text-slate-500" />
					<span>{i18n.t('nav.quota_by_ws')}</span>
				</div>
			{/if}
		</div>

		<!-- User Footer -->
		<div class="border-t border-[#1a253a] p-3 pb-safe">
			<div class="flex items-center justify-between gap-2 rounded-xl bg-[#131c2e] p-2.5">
				<a
					href="/profile"
					onclick={() => (mobileOpen = false)}
					class="flex min-w-0 flex-1 items-center gap-2.5 hover:opacity-90"
				>
					{#if data.user.avatar_url}
						<img
							src={data.user.avatar_url}
							alt={data.user.full_name}
							class="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/10"
						/>
					{:else}
						<div
							class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
							style="background-color: {data.user.avatar_color}"
						>
							{getInitials(data.user.full_name)}
						</div>
					{/if}
					<div class="min-w-0">
						<p class="truncate text-xs font-semibold text-white">{data.user.full_name}</p>
						<p class="truncate font-mono text-[10px] text-slate-400">@{data.user.username}</p>
					</div>
				</a>
				<button
					type="button"
					onclick={logout}
					class="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
					title="Sair"
					aria-label="Sair"
				>
					<LogOut class="h-4 w-4" />
				</button>
			</div>
		</div>
	</aside>

	<!-- Main Content -->
	<div class="flex min-w-0 flex-1 flex-col overflow-hidden">
		<!-- Mobile Header -->
		<header class="flex shrink-0 items-center justify-between gap-2 border-b border-[#1a253a] bg-[#0e1525] px-3 py-2.5 lg:hidden">
			<button
				type="button"
				onclick={() => (mobileOpen = true)}
				class="shrink-0 rounded-lg p-2 text-slate-300 hover:bg-[#19253c]"
				aria-label="Abrir menu"
			>
				<Menu class="h-5 w-5" />
			</button>

			<button
				type="button"
				onclick={() => (mobileOpen = true)}
				class="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 hover:bg-[#141e33]"
			>
				{#if activeWs}
					<span
						class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white"
						style="background-color: {activeWs.color}"
					>
						<Layers class="h-3.5 w-3.5" />
					</span>
					<div class="min-w-0 text-left">
						<span class="block truncate text-xs font-bold text-white">{activeWs.name}</span>
						<span class="block truncate text-[10px] text-slate-400">{roleLabel(activeWs.role)}</span>
					</div>
				{:else}
					<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#19253c]">
						<Layers class="h-3.5 w-3.5 text-slate-300" />
					</div>
					<span class="truncate text-sm font-bold text-white">{i18n.t('nav.no_workspace')}</span>
				{/if}
			</button>

			<a href="/profile" class="h-8 w-8 shrink-0 overflow-hidden rounded-full ring-1 ring-white/10">
				{#if data.user.avatar_url}
					<img src={data.user.avatar_url} alt={data.user.full_name} class="h-full w-full object-cover" />
				{:else}
					<div
						class="flex h-full w-full items-center justify-center text-[11px] font-bold text-white"
						style="background-color: {data.user.avatar_color}"
					>
						{getInitials(data.user.full_name)}
					</div>
				{/if}
			</a>
		</header>

		<main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
			{@render children()}
		</main>
	</div>
</div>
