<script lang="ts">
	import { onMount } from 'svelte';
	import type { McServerRecord } from '$lib/types';
	import { toast } from '$lib/stores/toast.svelte';
	import {
		Server,
		Plus,
		Cpu,
		MemoryStick,
		Users,
		ArrowRight,
		Trash2,
		X,
		Info,
		Power
	} from 'lucide-svelte';

	let servers = $state<McServerRecord[]>([]);
	let loading = $state(true);

	let showCreateModal = $state(false);
	let formName = $state('');
	let formDesc = $state('');
	let formVersion = $state('1.21.4');
	let formPort = $state(25565);
	let formRam = $state(4096);
	let formMaxPlayers = $state(20);
	let formMotd = $state('Bem-vindo ao Lizzart Craft!');

	async function loadServers() {
		loading = true;
		try {
			const res = await fetch('/api/minecraft');
			const data = await res.json();
			if (res.ok) {
				servers = data.servers;
			} else {
				toast.error(data.error || 'Erro ao carregar instâncias.');
			}
		} finally {
			loading = false;
		}
	}

	onMount(loadServers);

	async function createServer(e: SubmitEvent) {
		e.preventDefault();
		const res = await fetch('/api/minecraft', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: formName,
				description: formDesc,
				version: formVersion,
				edition_label: 'Interface Casca',
				host_port: formPort,
				allocated_ram_mb: formRam,
				max_players: formMaxPlayers,
				motd: formMotd
			})
		});
		const data = await res.json();
		if (!res.ok) {
			toast.error(data.error || 'Falha ao criar instância.');
			return;
		}
		toast.success(`Instância "${formName}" criada na interface!`);
		showCreateModal = false;
		formName = '';
		formDesc = '';
		await loadServers();
	}

	async function deleteServer(srv: McServerRecord) {
		if (!confirm(`Remover a instância "${srv.name}" do painel?`)) return;
		const res = await fetch(`/api/minecraft/${srv.id}`, { method: 'DELETE' });
		if (res.ok) {
			toast.info(`Instância "${srv.name}" removida.`);
			await loadServers();
		}
	}

	function triggerShellStart(srv: McServerRecord) {
		toast.warning(
			`[Modo Casca UI] Motor de inicialização desacoplado. "${srv.name}" está aguardando integração do runner.`
		);
	}
</script>

<svelte:head>
	<title>Servidores Minecraft — Lizzart Explorer</title>
</svelte:head>

<div class="mx-auto max-w-7xl p-6 lg:p-8">
	<!-- Header -->
	<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
		<div>
			<div class="flex items-center gap-2.5">
				<h1 class="text-2xl font-bold text-white">Painel Minecraft</h1>
				<span class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
					Casca UI
				</span>
			</div>
			<p class="mt-1 text-sm text-slate-400">
				Gerenciamento visual de instâncias, console, jogadores e propriedades de servidor.
			</p>
		</div>
		<button
			type="button"
			onclick={() => (showCreateModal = true)}
			class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500"
		>
			<Plus class="h-4 w-4" />
			Nova Instância
		</button>
	</div>

	<!-- Info Banner -->
	<div class="mb-6 flex items-start gap-3 rounded-2xl border border-indigo-500/25 bg-indigo-500/10 p-4 text-xs text-indigo-200">
		<Info class="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
		<div>
			<strong class="font-semibold text-white">Interface de Casca (Sem Iniciadores):</strong>
			Este painel está estruturado sem acoplamento a modloaders, plugin loaders ou binários Java. As instâncias e propriedades (<code class="font-mono text-indigo-300">server.properties</code>) já são persistidas no MariaDB, prontas para conectar um daemon executor posteriormente.
		</div>
	</div>

	{#if loading}
		<div class="grid grid-cols-1 gap-5 md:grid-cols-2">
			{#each Array(2) as _, i (i)}
				<div class="h-52 animate-pulse rounded-2xl border border-[#1f2d45] bg-[#131c2e]/70"></div>
			{/each}
		</div>
	{:else if servers.length === 0}
		<div class="rounded-2xl border border-dashed border-[#233047] bg-[#0e1525] py-20 text-center">
			<Server class="mx-auto mb-3 h-10 w-10 text-slate-600" />
			<p class="text-sm font-semibold text-white">Nenhuma instância configurada</p>
			<p class="mt-1 text-xs text-slate-400">Crie uma nova instância visual para começar a configurar seu painel.</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
			{#each servers as srv (srv.id)}
				<div class="flex flex-col justify-between rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 shadow-lg transition hover:border-emerald-500/35">
					<div>
						<div class="flex items-start justify-between gap-3">
							<div class="flex items-center gap-3.5">
								<div class="flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
									<Server class="h-6 w-6" />
								</div>
								<div>
									<h2 class="text-base font-bold text-white">{srv.name}</h2>
									<p class="text-xs text-slate-400">{srv.description || 'Instância Minecraft'}</p>
								</div>
							</div>
							<span class="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-[#0b101b] px-2.5 py-1 text-[11px] font-medium text-slate-300">
								<span class="h-2 w-2 rounded-full bg-slate-500"></span>
								Parado (Casca)
							</span>
						</div>

						<!-- Connection & specs strip -->
						<div class="mt-4 grid grid-cols-3 gap-2.5 rounded-xl border border-[#1d2a42] bg-[#0b101b] p-3 text-xs">
							<div>
								<span class="block text-[10px] uppercase tracking-wider text-slate-500">Endereço</span>
								<code class="font-mono font-semibold text-slate-200">:{srv.host_port}</code>
							</div>
							<div>
								<span class="block text-[10px] uppercase tracking-wider text-slate-500">Memória Alocada</span>
								<span class="inline-flex items-center gap-1 font-mono font-semibold text-slate-200">
									<MemoryStick class="h-3 w-3 text-indigo-400" />
									{(srv.allocated_ram_mb / 1024).toFixed(1)} GB
								</span>
							</div>
							<div>
								<span class="block text-[10px] uppercase tracking-wider text-slate-500">Jogadores</span>
								<span class="inline-flex items-center gap-1 font-mono font-semibold text-slate-200">
									<Users class="h-3 w-3 text-emerald-400" />
									0 / {srv.max_players}
								</span>
							</div>
						</div>

						<div class="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
							<span class="rounded-md bg-[#1a263e] px-2 py-0.5 font-mono text-slate-300">v{srv.version}</span>
							<span class="rounded-md bg-[#1a263e] px-2 py-0.5 text-slate-300 capitalize">{srv.gamemode}</span>
							<span class="rounded-md bg-[#1a263e] px-2 py-0.5 text-slate-300 capitalize">{srv.difficulty}</span>
							<span class="inline-flex items-center gap-1 text-slate-500">
								<Cpu class="h-3 w-3" /> 0% CPU
							</span>
						</div>
					</div>

					<!-- Actions -->
					<div class="mt-5 flex items-center justify-between gap-2 border-t border-[#1f2d45] pt-4">
						<div class="flex items-center gap-2">
							<button
								type="button"
								onclick={() => triggerShellStart(srv)}
								class="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
							>
								<Power class="h-3.5 w-3.5" />
								Iniciar
							</button>
							<button
								type="button"
								onclick={() => deleteServer(srv)}
								class="rounded-xl border border-[#233047] p-2 text-slate-400 hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-400"
								title="Remover instância"
							>
								<Trash2 class="h-4 w-4" />
							</button>
						</div>

						<a
							href="/minecraft/{srv.id}"
							class="inline-flex items-center gap-1.5 rounded-xl border border-[#233047] bg-[#172338] px-4 py-2 text-xs font-semibold text-white transition hover:border-emerald-500/40 hover:bg-[#1e2d48]"
						>
							Gerenciar Painel
							<ArrowRight class="h-3.5 w-3.5 text-emerald-400" />
						</a>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Create Instance Modal -->
{#if showCreateModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
		<form
			onsubmit={createServer}
			class="w-full max-w-lg rounded-2xl border border-[#233047] bg-[#131c2e] p-6 shadow-2xl space-y-4"
		>
			<div class="flex items-center justify-between">
				<div>
					<h3 class="text-base font-semibold text-white">Nova Instância Minecraft (Casca)</h3>
					<p class="text-xs text-slate-400">Cria apenas o registro visual e metadados de configuração.</p>
				</div>
				<button type="button" onclick={() => (showCreateModal = false)} class="text-slate-400 hover:text-white">
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div class="sm:col-span-2">
					<label for="mname" class="mb-1 block text-xs text-slate-400">Nome do Servidor</label>
					<input id="mname" type="text" required bind:value={formName} placeholder="Ex: Lizzart Survival" class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-emerald-500" />
				</div>
				<div class="sm:col-span-2">
					<label for="mdesc" class="mb-1 block text-xs text-slate-400">Descrição</label>
					<input id="mdesc" type="text" bind:value={formDesc} placeholder="Servidor privado da equipe..." class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-emerald-500" />
				</div>
				<div>
					<label for="mver" class="mb-1 block text-xs text-slate-400">Versão Alvo</label>
					<input id="mver" type="text" bind:value={formVersion} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-emerald-500" />
				</div>
				<div>
					<label for="mport" class="mb-1 block text-xs text-slate-400">Porta</label>
					<input id="mport" type="number" bind:value={formPort} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-emerald-500" />
				</div>
				<div>
					<label for="mram" class="mb-1 block text-xs text-slate-400">RAM Alocada (MB)</label>
					<input id="mram" type="number" step="512" min="512" bind:value={formRam} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-emerald-500" />
				</div>
				<div>
					<label for="mmax" class="mb-1 block text-xs text-slate-400">Máx. Jogadores</label>
					<input id="mmax" type="number" min="1" bind:value={formMaxPlayers} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-emerald-500" />
				</div>
				<div class="sm:col-span-2">
					<label for="mmotd" class="mb-1 block text-xs text-slate-400">MOTD</label>
					<input id="mmotd" type="text" bind:value={formMotd} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-emerald-500" />
				</div>
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<button type="button" onclick={() => (showCreateModal = false)} class="rounded-xl border border-[#233047] px-4 py-2 text-xs text-slate-300">Cancelar</button>
				<button type="submit" class="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500">Criar Instância</button>
			</div>
		</form>
	</div>
{/if}
