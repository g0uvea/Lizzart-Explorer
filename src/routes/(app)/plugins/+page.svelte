<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toast } from '$lib/stores/toast.svelte';
	import { i18n } from '$lib/stores/i18n.svelte';
	import {
		Puzzle,
		Server,
		FileText,
		Shield,
		Users,
		Check,
		Plus,
		Trash2,
		ExternalLink,
		Sparkles,
		Lock
	} from 'lucide-svelte';

	let { data } = $props();

	let mcInstalled = $state(true);
	let notesInstalled = $state(true);
	let busyId = $state<string | null>(null);
	let filterCategory = $state<'all' | 'apps' | 'admin'>('all');

	$effect(() => {
		mcInstalled = data.plugins?.mc_servers ?? true;
		notesInstalled = data.plugins?.notes ?? true;
	});

	async function togglePlugin(key: 'mc_servers' | 'notes', nextState: boolean, label: string) {
		busyId = key;
		try {
			const res = await fetch('/api/admin/plugins', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ [key]: nextState })
			});
			const payload = await res.json();
			if (!res.ok) {
				toast.error(payload.error || 'Erro ao atualizar plugin.');
				return;
			}
			mcInstalled = payload.plugins.mc_servers;
			notesInstalled = payload.plugins.notes;
			toast.success(
				nextState
					? `Plugin "${label}" instalado e ativado na barra lateral!`
					: `Plugin "${label}" desinstalado da barra lateral.`
			);
			await invalidateAll();
		} catch {
			toast.error('Falha de conexão ao atualizar plugin.');
		} finally {
			busyId = null;
		}
	}
</script>

<svelte:head>
	<title>{i18n.t('nav.plugins')} — Lizzart Explorer</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">
	<!-- Header -->
	<div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-start gap-3.5">
			<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-500/15 text-accent-400 ring-1 ring-accent-500/30">
				<Puzzle class="h-6 w-6" />
			</div>
			<div>
				<div class="flex flex-wrap items-center gap-2">
					<h1 class="text-xl font-bold text-white sm:text-2xl">{i18n.t('plugins.title')}</h1>
					<span class="inline-flex items-center gap-1 rounded-full bg-accent-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-accent-300">
						<Sparkles class="h-3 w-3" /> Modular
					</span>
				</div>
				<p class="mt-1 text-xs text-slate-400 sm:text-sm">
					{i18n.t('plugins.subtitle')}
				</p>
			</div>
		</div>

		<!-- Category Filter Pills -->
		<div class="flex items-center gap-1.5 self-start rounded-xl border border-[#1f2d45] bg-[#111929] p-1">
			<button
				type="button"
				onclick={() => (filterCategory = 'all')}
				class="rounded-lg px-3 py-1.5 text-xs font-semibold transition {filterCategory === 'all'
					? 'bg-accent-600 text-white'
					: 'text-slate-400 hover:text-slate-200'}"
			>
				{i18n.t('plugins.filter_all')}
			</button>
			<button
				type="button"
				onclick={() => (filterCategory = 'apps')}
				class="rounded-lg px-3 py-1.5 text-xs font-semibold transition {filterCategory === 'apps'
					? 'bg-accent-600 text-white'
					: 'text-slate-400 hover:text-slate-200'}"
			>
				{i18n.t('nav.apps_section')}
			</button>
			<button
				type="button"
				onclick={() => (filterCategory = 'admin')}
				class="rounded-lg px-3 py-1.5 text-xs font-semibold transition {filterCategory === 'admin'
					? 'bg-accent-600 text-white'
					: 'text-slate-400 hover:text-slate-200'}"
			>
				Admin & Infra
			</button>
		</div>
	</div>

	<!-- Plugins Grid -->
	<div class="grid grid-cols-1 gap-5 md:grid-cols-2">
		{#if filterCategory === 'all' || filterCategory === 'apps'}
			<!-- PLUGIN 1: ANOTAÇÕES PESSOAIS (APPS) -->
			<div class="flex flex-col justify-between rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 transition hover:border-[#2c3f60] sm:p-6">
				<div>
					<div class="mb-4 flex items-start justify-between gap-3">
						<div class="flex items-center gap-3.5">
							<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
								<FileText class="h-6 w-6" />
							</div>
							<div>
								<div class="flex flex-wrap items-center gap-2">
									<h2 class="text-base font-bold text-white">{i18n.t('plugins.notes_title')}</h2>
									<span class="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
										{i18n.t('nav.apps_section')}
									</span>
								</div>
								<p class="mt-0.5 text-xs text-slate-400">
									Markdown • Estilo Notion / Obsidian Simplificado
								</p>
							</div>
						</div>

						{#if notesInstalled}
							<span class="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-500/20 px-2.5 py-1 text-[11px] font-semibold text-accent-300">
								<Check class="h-3.5 w-3.5" /> {i18n.t('plugins.installed')}
							</span>
						{:else}
							<span class="inline-flex shrink-0 items-center rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-400">
								{i18n.t('plugins.not_installed')}
							</span>
						{/if}
					</div>

					<p class="text-xs leading-relaxed text-slate-300 sm:text-sm">
						{i18n.t('plugins.notes_desc')}
					</p>

					<div class="mt-4 flex flex-wrap gap-2">
						<span class="inline-flex items-center gap-1.5 rounded-lg border border-[#233047] bg-[#0e1525] px-2.5 py-1 text-[11px] text-slate-300">
							<Users class="h-3.5 w-3.5 text-accent-400" />
							{i18n.t('plugins.access_all_users')}
						</span>
						<span class="inline-flex items-center gap-1.5 rounded-lg border border-[#233047] bg-[#0e1525] px-2.5 py-1 text-[11px] text-slate-300">
							<Lock class="h-3.5 w-3.5 text-amber-400" />
							{i18n.t('plugins.isolated_per_ws')}
						</span>
					</div>
				</div>

				<div class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#1f2d45] pt-4">
					{#if notesInstalled}
						<a
							href="/notes"
							class="inline-flex items-center gap-1.5 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500"
						>
							<ExternalLink class="h-3.5 w-3.5" />
							{i18n.t('plugins.open_app')}
						</a>
						<button
							type="button"
							disabled={busyId === 'notes'}
							onclick={() => togglePlugin('notes', false, i18n.t('plugins.notes_title'))}
							class="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
						>
							<Trash2 class="h-3.5 w-3.5" />
							{i18n.t('plugins.uninstall')}
						</button>
					{:else}
						<span class="text-xs text-slate-500">{i18n.t('plugins.install_hint_apps')}</span>
						<button
							type="button"
							disabled={busyId === 'notes'}
							onclick={() => togglePlugin('notes', true, i18n.t('plugins.notes_title'))}
							class="inline-flex items-center gap-1.5 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
						>
							<Plus class="h-3.5 w-3.5" />
							{i18n.t('plugins.install')}
						</button>
					{/if}
				</div>
			</div>
		{/if}

		{#if filterCategory === 'all' || filterCategory === 'admin'}
			<!-- PLUGIN 2: SERVIDORES MINECRAFT (ADMIN ONLY) -->
			<div class="flex flex-col justify-between rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 transition hover:border-[#2c3f60] sm:p-6">
				<div>
					<div class="mb-4 flex items-start justify-between gap-3">
						<div class="flex items-center gap-3.5">
							<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30">
								<Server class="h-6 w-6" />
							</div>
							<div>
								<div class="flex flex-wrap items-center gap-2">
									<h2 class="text-base font-bold text-white">{i18n.t('plugins.mc_title')}</h2>
									<span class="rounded-md bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
										Admin & Infra
									</span>
								</div>
								<p class="mt-0.5 text-xs text-slate-400">
									Console, Arquivos, Jogadores & Topologia de Instâncias
								</p>
							</div>
						</div>

						{#if mcInstalled}
							<span class="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-500/20 px-2.5 py-1 text-[11px] font-semibold text-accent-300">
								<Check class="h-3.5 w-3.5" /> {i18n.t('plugins.installed')}
							</span>
						{:else}
							<span class="inline-flex shrink-0 items-center rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-400">
								{i18n.t('plugins.not_installed')}
							</span>
						{/if}
					</div>

					<p class="text-xs leading-relaxed text-slate-300 sm:text-sm">
						{i18n.t('plugins.mc_desc')}
					</p>

					<div class="mt-4 flex flex-wrap gap-2">
						<span class="inline-flex items-center gap-1.5 rounded-lg border border-[#233047] bg-[#0e1525] px-2.5 py-1 text-[11px] text-amber-300">
							<Shield class="h-3.5 w-3.5 text-amber-400" />
							{i18n.t('plugins.access_admin_only')}
						</span>
					</div>
				</div>

				<div class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#1f2d45] pt-4">
					{#if mcInstalled}
						<a
							href="/minecraft"
							class="inline-flex items-center gap-1.5 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500"
						>
							<ExternalLink class="h-3.5 w-3.5" />
							{i18n.t('plugins.open_app')}
						</a>
						<button
							type="button"
							disabled={busyId === 'mc_servers'}
							onclick={() => togglePlugin('mc_servers', false, i18n.t('plugins.mc_title'))}
							class="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
						>
							<Trash2 class="h-3.5 w-3.5" />
							{i18n.t('plugins.uninstall')}
						</button>
					{:else}
						<span class="text-xs text-slate-500">{i18n.t('plugins.install_hint_admin')}</span>
						<button
							type="button"
							disabled={busyId === 'mc_servers'}
							onclick={() => togglePlugin('mc_servers', true, i18n.t('plugins.mc_title'))}
							class="inline-flex items-center gap-1.5 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
						>
							<Plus class="h-3.5 w-3.5" />
							{i18n.t('plugins.install')}
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
