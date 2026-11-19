<script lang="ts">
	import { page } from '$app/stores';
	import { goto, invalidateAll } from '$app/navigation';
	import { quotaStore } from '$lib/stores/quota.svelte';
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
		UserCog,
		Database
	} from 'lucide-svelte';

	let { data, children } = $props();
	let mobileOpen = $state(false);

	$effect(() => {
		if (data.user) {
			quotaStore.sync(data.user.used_bytes, data.user.quota_bytes);
		}
	});

	let currentPath = $derived($page.url.pathname);
	let currentView = $derived($page.url.searchParams.get('view') || 'drive');

	let quotaPercent = $derived(
		quotaStore.quotaBytes <= 0
			? 0
			: Math.min(100, Math.round((quotaStore.usedBytes / quotaStore.quotaBytes) * 100))
	);

	function isNavActive(path: string, view?: string): boolean {
		if (path === '/') {
			return currentPath === '/' && currentView === (view || 'drive');
		}
		return currentPath.startsWith(path);
	}

	async function logout() {
		await fetch('/api/auth/logout', { method: 'POST' });
		toast.info('Você saiu da sua conta.');
		await invalidateAll();
		await goto('/login');
	}
</script>

<div class="flex min-h-screen bg-[#0b101b] text-slate-100">
	<!-- Mobile Backdrop -->
	{#if mobileOpen}
		<button
			type="button"
			onclick={() => (mobileOpen = false)}
			class="fixed inset-0 z-30 bg-black/60 backdrop-blur-xs lg:hidden"
			aria-label="Fechar menu"
		></button>
	{/if}

	<!-- Sidebar -->
	<aside
		class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-[#1a253a] bg-[#0e1525] transition-transform duration-200 lg:static lg:translate-x-0 {mobileOpen
			? 'translate-x-0'
			: '-translate-x-full'}"
	>
		<!-- Brand -->
		<div class="flex items-center justify-between px-5 py-5">
			<a href="/" class="flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-600/20">
					<HardDrive class="h-5 w-5 text-white" />
				</div>
				<div>
					<span class="block text-sm font-bold tracking-tight text-white">Lizzart Explorer</span>
					<span class="block text-[11px] text-slate-400">Cloud + Admin Suite</span>
				</div>
			</a>
			<button
				type="button"
				onclick={() => (mobileOpen = false)}
				class="rounded-lg p-1 text-slate-400 hover:text-white lg:hidden"
			>
				<X class="h-5 w-5" />
			</button>
		</div>

		<!-- Navigation -->
		<nav class="flex-1 space-y-6 overflow-y-auto px-3 py-2">
			<div>
				<p class="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
					Armazenamento
				</p>
				<div class="space-y-1">
					<a
						href="/"
						onclick={() => (mobileOpen = false)}
						class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition {isNavActive('/', 'drive')
							? 'bg-[#19253c] text-white shadow-xs ring-1 ring-indigo-500/30'
							: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
					>
						<HardDrive class="h-4 w-4 {isNavActive('/', 'drive') ? 'text-indigo-400' : ''}" />
						Meu Drive
					</a>
					<a
						href="/?view=recent"
						onclick={() => (mobileOpen = false)}
						class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition {isNavActive('/', 'recent')
							? 'bg-[#19253c] text-white shadow-xs ring-1 ring-indigo-500/30'
							: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
					>
						<Clock class="h-4 w-4 {isNavActive('/', 'recent') ? 'text-indigo-400' : ''}" />
						Recentes
					</a>
					<a
						href="/?view=starred"
						onclick={() => (mobileOpen = false)}
						class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition {isNavActive('/', 'starred')
							? 'bg-[#19253c] text-white shadow-xs ring-1 ring-indigo-500/30'
							: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
					>
						<Star class="h-4 w-4 {isNavActive('/', 'starred') ? 'text-amber-400' : ''}" />
						Favoritos
					</a>
					<a
						href="/?view=shared"
						onclick={() => (mobileOpen = false)}
						class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition {isNavActive('/', 'shared')
							? 'bg-[#19253c] text-white shadow-xs ring-1 ring-indigo-500/30'
							: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
					>
						<Users class="h-4 w-4 {isNavActive('/', 'shared') ? 'text-emerald-400' : ''}" />
						Compartilhados
					</a>
					<a
						href="/?view=trash"
						onclick={() => (mobileOpen = false)}
						class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition {isNavActive('/', 'trash')
							? 'bg-[#19253c] text-white shadow-xs ring-1 ring-rose-500/30'
							: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
					>
						<Trash2 class="h-4 w-4 {isNavActive('/', 'trash') ? 'text-rose-400' : ''}" />
						Lixeira
					</a>
				</div>
			</div>

			{#if data.user.role === 'admin'}
				<div>
					<p class="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
						Administração & Infra
					</p>
					<div class="space-y-1">
						<a
							href="/minecraft"
							onclick={() => (mobileOpen = false)}
							class="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition {isNavActive('/minecraft')
								? 'bg-[#19253c] text-white shadow-xs ring-1 ring-emerald-500/30'
								: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
						>
							<span class="flex items-center gap-3">
								<Server class="h-4 w-4 {isNavActive('/minecraft') ? 'text-emerald-400' : ''}" />
								Servidores MC
							</span>
							<span class="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
								UI
							</span>
						</a>
						<a
							href="/admin"
							onclick={() => (mobileOpen = false)}
							class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition {isNavActive('/admin')
								? 'bg-[#19253c] text-white shadow-xs ring-1 ring-indigo-500/30'
								: 'text-slate-400 hover:bg-[#141e33] hover:text-slate-200'}"
						>
							<Shield class="h-4 w-4 {isNavActive('/admin') ? 'text-indigo-400' : ''}" />
							Painel Admin
						</a>
					</div>
				</div>
			{/if}
		</nav>

		<!-- Storage Quota Widget -->
		<div class="mx-3 mb-3 rounded-xl border border-[#1f2d45] bg-[#131c2e] p-3.5">
			<div class="mb-2 flex items-center justify-between text-xs">
				<span class="flex items-center gap-1.5 font-medium text-slate-300">
					<Database class="h-3.5 w-3.5 text-indigo-400" />
					Armazenamento
				</span>
				<span class="font-mono text-[11px] text-slate-400">
					{quotaStore.quotaBytes < 0 ? '∞' : `${quotaPercent}%`}
				</span>
			</div>
			<div class="h-2 w-full overflow-hidden rounded-full bg-[#0b101b]">
				<div
					class="h-full rounded-full transition-all duration-500 {quotaPercent > 85
						? 'bg-rose-500'
						: quotaPercent > 65
							? 'bg-amber-500'
							: 'bg-gradient-to-r from-indigo-500 to-emerald-400'}"
					style="width: {quotaStore.quotaBytes < 0 ? 15 : Math.max(2, quotaPercent)}%"
				></div>
			</div>
			<p class="mt-2 text-[11px] text-slate-400">
				<strong class="text-slate-200">{formatBytes(quotaStore.usedBytes)}</strong> de
				{formatBytes(quotaStore.quotaBytes)}
			</p>
		</div>

		<!-- User Footer -->
		<div class="border-t border-[#1a253a] p-3">
			<div class="flex items-center justify-between gap-2 rounded-xl bg-[#131c2e] p-2.5">
				<a href="/profile" class="flex min-w-0 flex-1 items-center gap-2.5 hover:opacity-90">
					<div
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
						style="background-color: {data.user.avatar_color}"
					>
						{getInitials(data.user.name)}
					</div>
					<div class="min-w-0">
						<p class="truncate text-xs font-semibold text-white">{data.user.name}</p>
						<p class="truncate text-[10px] text-slate-400">
							{data.user.role === 'admin' ? 'Administrador' : 'Usuário'}
						</p>
					</div>
				</a>
				<div class="flex items-center gap-1">
					<a
						href="/profile"
						class="rounded-lg p-1.5 text-slate-400 hover:bg-[#1e2c44] hover:text-white"
						title="Perfil"
					>
						<UserCog class="h-4 w-4" />
					</a>
					<button
						type="button"
						onclick={logout}
						class="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
						title="Sair"
					>
						<LogOut class="h-4 w-4" />
					</button>
				</div>
			</div>
		</div>
	</aside>

	<!-- Main Content -->
	<div class="flex min-w-0 flex-1 flex-col">
		<!-- Mobile Header -->
		<header class="flex items-center justify-between border-b border-[#1a253a] bg-[#0e1525] px-4 py-3 lg:hidden">
			<button
				type="button"
				onclick={() => (mobileOpen = true)}
				class="rounded-lg p-1.5 text-slate-300 hover:bg-[#19253c]"
			>
				<Menu class="h-5 w-5" />
			</button>
			<span class="text-sm font-bold text-white">Lizzart Explorer</span>
			<a
				href="/profile"
				class="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
				style="background-color: {data.user.avatar_color}"
			>
				{getInitials(data.user.name)}
			</a>
		</header>

		<main class="flex-1 overflow-y-auto">
			{@render children()}
		</main>
	</div>
</div>
