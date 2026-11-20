<script lang="ts">
	import { toast } from '$lib/stores/toast.svelte';
	import {
		ArrowLeft,
		Play,
		RotateCw,
		Square,
		Skull,
		Terminal,
		Users,
		SlidersHorizontal,
		Archive,
		Cpu,
		MemoryStick,
		Activity,
		HardDrive,
		Copy,
		Send,
		Save,
		FolderOpen
	} from 'lucide-svelte';

	let { data } = $props();

	let tab = $state<'console' | 'players' | 'properties' | 'backups'>('console');
	let server = $state({
		id: '',
		name: '',
		description: null as string | null,
		version: '1.21.4',
		edition_label: 'Vanilla',
		host_port: 25565,
		max_players: 20,
		allocated_ram_mb: 4096,
		motd: '',
		gamemode: 'survival',
		difficulty: 'normal',
		pvp: true,
		online_mode: true,
		whitelist: false,
		status: 'offline' as 'offline' | 'online' | 'starting' | 'stopping',
		created_by: null as string | null,
		created_at: ''
	});
	let savingProps = $state(false);

	// Shell console simulation
	let commandInput = $state('');
	let consoleLines = $state<string[]>([]);

	$effect(() => {
		const s = data.server;
		server = { ...s };
		consoleLines = [
			`[Lizzart MC Shell] Instância carregada: ${s.name} (v${s.version})`,
			`[Lizzart MC Shell] Porta configurada: 0.0.0.0:${s.host_port} | Memória alocada: ${s.allocated_ram_mb} MB`,
			`[Lizzart MC Shell] Status atual: OFFLINE — Modo Casca (sem motor/loader conectado).`,
			`[Lizzart MC Shell] Dica: você pode editar server.properties na aba "Propriedades" e salvar no MariaDB.`
		];
	});

	function sendShellAction(action: string) {
		const ts = new Date().toLocaleTimeString('pt-BR');
		consoleLines = [
			...consoleLines,
			`[${ts} WARN] Ação "${action}" acionada no modo Casca UI — nenhum processo Java/runner conectado ainda.`
		];
		toast.info(`Ação "${action}" (Casca UI) registrada no console visual.`);
	}

	function sendCommand(e: SubmitEvent) {
		e.preventDefault();
		const cmd = commandInput.trim();
		if (!cmd) return;
		const ts = new Date().toLocaleTimeString('pt-BR');
		consoleLines = [
			...consoleLines,
			`> ${cmd}`,
			`[${ts} INFO] [Casca UI] Comando "${cmd}" recebido pela interface (sem servidor em execução).`
		];
		commandInput = '';
	}

	async function copyAddress() {
		await navigator.clipboard.writeText(`127.0.0.1:${server.host_port}`);
		toast.success('Endereço copiado!');
	}

	async function saveProperties(e: SubmitEvent) {
		e.preventDefault();
		savingProps = true;
		try {
			const res = await fetch(`/api/minecraft/${server.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: server.name,
					version: server.version,
					host_port: server.host_port,
					max_players: server.max_players,
					allocated_ram_mb: server.allocated_ram_mb,
					motd: server.motd,
					gamemode: server.gamemode,
					difficulty: server.difficulty,
					pvp: server.pvp,
					online_mode: server.online_mode,
					whitelist: server.whitelist
				})
			});
			if (res.ok) {
				toast.success('Propriedades salvas no MariaDB!');
			} else {
				toast.error('Erro ao salvar propriedades.');
			}
		} finally {
			savingProps = false;
		}
	}
</script>

<svelte:head>
	<title>{server.name} — Painel Minecraft</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl p-3.5 sm:p-6 lg:p-8">
	<!-- Top Back & Header -->
	<div class="mb-6">
		<a
			href="/minecraft"
			class="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white"
		>
			<ArrowLeft class="h-3.5 w-3.5" />
			Voltar para Servidores
		</a>

		<div class="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5">
			<div>
				<div class="flex flex-wrap items-center gap-2.5">
					<h1 class="text-xl font-bold text-white">{server.name}</h1>
					<span class="rounded-full border border-slate-700 bg-[#0b101b] px-2.5 py-0.5 text-[11px] font-medium text-slate-300">
						Offline • Casca UI
					</span>
					<button
						type="button"
						onclick={copyAddress}
						class="inline-flex items-center gap-1.5 rounded-lg border border-[#233047] bg-[#0b101b] px-2.5 py-1 font-mono text-xs text-indigo-300 hover:border-indigo-500/40"
						title="Copiar endereço"
					>
						127.0.0.1:{server.host_port}
						<Copy class="h-3 w-3" />
					</button>
				</div>
				<p class="mt-1 text-xs text-slate-400">{server.motd}</p>
			</div>

			<!-- Power Controls (UI Shell) -->
			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onclick={() => sendShellAction('Iniciar')}
					class="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
				>
					<Play class="h-3.5 w-3.5" /> Iniciar
				</button>
				<button
					type="button"
					onclick={() => sendShellAction('Reiniciar')}
					class="inline-flex items-center gap-1.5 rounded-xl bg-amber-600/90 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-500"
				>
					<RotateCw class="h-3.5 w-3.5" /> Reiniciar
				</button>
				<button
					type="button"
					onclick={() => sendShellAction('Parar')}
					class="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-500"
				>
					<Square class="h-3.5 w-3.5" /> Parar
				</button>
				<button
					type="button"
					onclick={() => sendShellAction('Kill')}
					class="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
					title="Forçar parada"
				>
					<Skull class="h-3.5 w-3.5" />
				</button>
			</div>
		</div>
	</div>

	<!-- Resource Gauges -->
	<div class="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-4">
			<div class="flex items-center justify-between text-xs text-slate-400">
				<span>Uso de CPU</span>
				<Cpu class="h-4 w-4 text-sky-400" />
			</div>
			<p class="mt-2 font-mono text-xl font-bold text-white">0.0%</p>
			<div class="mt-2 h-1.5 rounded-full bg-[#0b101b]">
				<div class="h-full w-1 rounded-full bg-sky-500"></div>
			</div>
		</div>
		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-4">
			<div class="flex items-center justify-between text-xs text-slate-400">
				<span>Memória RAM</span>
				<MemoryStick class="h-4 w-4 text-indigo-400" />
			</div>
			<p class="mt-2 font-mono text-xl font-bold text-white">
				0 <span class="text-xs font-normal text-slate-500">/ {server.allocated_ram_mb} MB</span>
			</p>
			<div class="mt-2 h-1.5 rounded-full bg-[#0b101b]">
				<div class="h-full w-1 rounded-full bg-indigo-500"></div>
			</div>
		</div>
		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-4">
			<div class="flex items-center justify-between text-xs text-slate-400">
				<span>TPS do Mundo</span>
				<Activity class="h-4 w-4 text-emerald-400" />
			</div>
			<p class="mt-2 font-mono text-xl font-bold text-white">—</p>
			<p class="mt-1 text-[11px] text-slate-500">Aguardando runtime</p>
		</div>
		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-4">
			<div class="flex items-center justify-between text-xs text-slate-400">
				<span>Jogadores Online</span>
				<Users class="h-4 w-4 text-amber-400" />
			</div>
			<p class="mt-2 font-mono text-xl font-bold text-white">
				0 <span class="text-xs font-normal text-slate-500">/ {server.max_players}</span>
			</p>
			<p class="mt-1 text-[11px] text-slate-500">Versão {server.version}</p>
		</div>
	</div>

	<!-- Tabs -->
	<div class="no-scrollbar mb-5 flex gap-1 overflow-x-auto border-b border-[#1a253a]">
		<button
			type="button"
			onclick={() => (tab = 'console')}
			class="inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-medium transition sm:px-4 sm:py-3 sm:text-sm {tab === 'console'
				? 'border-emerald-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<Terminal class="h-4 w-4" /> Console
		</button>
		<button
			type="button"
			onclick={() => (tab = 'players')}
			class="inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-medium transition sm:px-4 sm:py-3 sm:text-sm {tab === 'players'
				? 'border-emerald-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<Users class="h-4 w-4" /> Jogadores
		</button>
		<button
			type="button"
			onclick={() => (tab = 'properties')}
			class="inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-medium transition sm:px-4 sm:py-3 sm:text-sm {tab === 'properties'
				? 'border-emerald-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<SlidersHorizontal class="h-4 w-4" /> Propriedades
		</button>
		<button
			type="button"
			onclick={() => (tab = 'backups')}
			class="inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-medium transition sm:px-4 sm:py-3 sm:text-sm {tab === 'backups'
				? 'border-emerald-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<Archive class="h-4 w-4" /> Backups
		</button>
	</div>

	<!-- Tab Panels -->
	{#if tab === 'console'}
		<div class="overflow-hidden rounded-2xl border border-[#1f2d45] bg-[#0a0f1a]">
			<div class="flex items-center justify-between border-b border-[#1a253a] bg-[#0e1525] px-4 py-2.5 text-xs text-slate-400">
				<span class="font-mono">console://lizzart-mc/{server.id.slice(0, 8)}</span>
				<button
					type="button"
					onclick={() => (consoleLines = ['[Lizzart MC Shell] Console limpo.'])}
					class="text-slate-400 hover:text-white"
				>
					Limpar
				</button>
			</div>
			<div class="h-80 overflow-y-auto p-4 font-mono text-xs leading-relaxed text-slate-300 space-y-1">
				{#each consoleLines as line, idx (idx)}
					<div class={line.startsWith('>') ? 'text-emerald-400' : line.includes('WARN') ? 'text-amber-300' : 'text-slate-300'}>
						{line}
					</div>
				{/each}
			</div>
			<form onsubmit={sendCommand} class="flex border-t border-[#1a253a] bg-[#0e1525]">
				<input
					type="text"
					bind:value={commandInput}
					placeholder="Digite um comando (ex: list, say Olá, whitelist reload)..."
					class="flex-1 bg-transparent px-4 py-3 font-mono text-xs text-white placeholder-slate-500 outline-none"
				/>
				<button
					type="submit"
					class="inline-flex items-center gap-1.5 bg-accent-600 px-5 py-3 text-xs font-semibold text-white hover:bg-accent-500"
				>
					<Send class="h-3.5 w-3.5" /> Enviar
				</button>
			</form>
		</div>
	{:else if tab === 'players'}
		<div class="grid grid-cols-1 gap-5 md:grid-cols-2">
			<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5">
				<h3 class="mb-3 text-sm font-semibold text-white">Jogadores Conectados (0/{server.max_players})</h3>
				<div class="rounded-xl border border-dashed border-[#233047] py-12 text-center text-xs text-slate-500">
					Nenhum jogador online. Conecte um runtime ao painel para visualizar jogadores em tempo real.
				</div>
			</div>
			<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5">
				<h3 class="mb-3 text-sm font-semibold text-white">Operadores & Whitelist</h3>
				<p class="mb-4 text-xs text-slate-400">
					Whitelist está atualmente <strong class={server.whitelist ? 'text-emerald-400' : 'text-slate-300'}>{server.whitelist ? 'ATIVADA' : 'DESATIVADA'}</strong> nas propriedades.
				</p>
				<div class="rounded-xl border border-dashed border-[#233047] py-10 text-center text-xs text-slate-500">
					Gerenciamento de UUIDs / <code class="font-mono">ops.json</code> será habilitado junto com o iniciador do servidor.
				</div>
			</div>
		</div>
	{:else if tab === 'properties'}
		<form onsubmit={saveProperties} class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-6 space-y-5">
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<div>
					<label for="pn" class="mb-1.5 block text-xs text-slate-400">Nome da Instância</label>
					<input id="pn" type="text" bind:value={server.name} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-emerald-500" />
				</div>
				<div>
					<label for="pv" class="mb-1.5 block text-xs text-slate-400">Versão</label>
					<input id="pv" type="text" bind:value={server.version} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-emerald-500" />
				</div>
				<div>
					<label for="pp" class="mb-1.5 block text-xs text-slate-400">server-port</label>
					<input id="pp" type="number" bind:value={server.host_port} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-emerald-500" />
				</div>
				<div>
					<label for="pmp" class="mb-1.5 block text-xs text-slate-400">max-players</label>
					<input id="pmp" type="number" bind:value={server.max_players} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-emerald-500" />
				</div>
				<div>
					<label for="pram" class="mb-1.5 block text-xs text-slate-400">Memória RAM Alocada (MB)</label>
					<input id="pram" type="number" step="512" bind:value={server.allocated_ram_mb} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-emerald-500" />
				</div>
				<div>
					<label for="pgm" class="mb-1.5 block text-xs text-slate-400">gamemode</label>
					<select id="pgm" bind:value={server.gamemode} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-emerald-500">
						<option value="survival">Survival</option>
						<option value="creative">Creative</option>
						<option value="adventure">Adventure</option>
						<option value="spectator">Spectator</option>
					</select>
				</div>
				<div>
					<label for="pdiff" class="mb-1.5 block text-xs text-slate-400">difficulty</label>
					<select id="pdiff" bind:value={server.difficulty} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-emerald-500">
						<option value="peaceful">Peaceful</option>
						<option value="easy">Easy</option>
						<option value="normal">Normal</option>
						<option value="hard">Hard</option>
					</select>
				</div>
				<div class="sm:col-span-2">
					<label for="pmotd" class="mb-1.5 block text-xs text-slate-400">motd</label>
					<input id="pmotd" type="text" bind:value={server.motd} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-emerald-500" />
				</div>
			</div>

			<div class="flex flex-wrap gap-6 border-t border-[#1f2d45] pt-4 text-sm text-slate-200">
				<label class="flex items-center gap-2">
					<input type="checkbox" bind:checked={server.pvp} class="h-4 w-4 accent-emerald-600" />
					pvp
				</label>
				<label class="flex items-center gap-2">
					<input type="checkbox" bind:checked={server.online_mode} class="h-4 w-4 accent-emerald-600" />
					online-mode
				</label>
				<label class="flex items-center gap-2">
					<input type="checkbox" bind:checked={server.whitelist} class="h-4 w-4 accent-emerald-600" />
					white-list
				</label>
			</div>

			<button
				type="submit"
				disabled={savingProps}
				class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
			>
				<Save class="h-4 w-4" />
				{savingProps ? 'Salvando...' : 'Salvar server.properties no MariaDB'}
			</button>
		</form>
	{:else}
		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-6">
			<div class="flex flex-wrap items-center justify-between gap-4 border-b border-[#1f2d45] pb-4">
				<div>
					<h3 class="text-sm font-semibold text-white">Integração com Lizzart Explorer</h3>
					<p class="mt-0.5 text-xs text-slate-400">
						Os backups compactados dos mundos poderão ser armazenados diretamente na sua nuvem privada.
					</p>
				</div>
				<a
					href="/"
					class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
				>
					<FolderOpen class="h-4 w-4" />
					Abrir Explorador de Arquivos
				</a>
			</div>
			<div class="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-[#233047] py-12 text-center">
				<HardDrive class="mb-2 h-8 w-8 text-slate-600" />
				<p class="text-xs font-medium text-slate-300">Nenhum snapshot de mundo criado</p>
				<p class="mt-1 text-[11px] text-slate-500">Quando o motor de servidor for acoplado, backups automáticos aparecerão aqui.</p>
			</div>
		</div>
	{/if}
</div>
