<script lang="ts">
	import { onMount } from 'svelte';
	import type { AuditLogRecord, SafeUser, SystemSettings } from '$lib/types';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatBytes, formatDate, getInitials } from '$lib/utils';
	import {
		Users,
		HardDrive,
		FileStack,
		Link2,
		UserPlus,
		Shield,
		Activity,
		Settings,
		Pencil,
		Trash2,
		X,
		Save,
		RefreshCw,
		Smartphone,
		Database,
		FolderCog,
		CheckCircle2
	} from 'lucide-svelte';

	let { data } = $props();

	let tab = $state<'users' | 'audit' | 'settings'>('users');
	let loading = $state(true);

	let stats = $state({
		total_users: 0,
		admin_count: 0,
		active_count: 0,
		total_used_bytes: 0,
		total_files: 0,
		total_folders: 0,
		trashed_items: 0,
		active_links: 0,
		total_downloads: 0,
		storage_root: ''
	});
	let users = $state<SafeUser[]>([]);
	let auditLogs = $state<AuditLogRecord[]>([]);
	let settings = $state<SystemSettings>({
		default_quota_gb: 10,
		max_upload_mb: 10240
	});

	// Disk & MariaDB storage configuration
	let diskPath = $state('./storage');
	let diskResolved = $state('');
	let diskFreeBytes = $state<number | null>(null);
	let diskTotalBytes = $state<number | null>(null);
	let migrateFiles = $state(true);
	let diskBusy = $state(false);

	let dbHost = $state('127.0.0.1');
	let dbPort = $state(3306);
	let dbUser = $state('root');
	let dbPassword = $state('');
	let dbHasPassword = $state(false);
	let dbKeepPassword = $state(true);
	let dbName = $state('lizzart_explorer');
	let dbBusy = $state(false);
	let dbTestVersion = $state<string | null>(null);

	// Create user modal (minimum quota 10 GB)
	let showCreateModal = $state(false);
	let newUsername = $state('');
	let newFirstName = $state('');
	let newLastName = $state('');
	let newPassword = $state('');
	let newRole = $state<'user' | 'admin'>('user');
	let newQuotaGb = $state(10);
	let newUnlimited = $state(false);

	// Edit user modal
	let editUser = $state<SafeUser | null>(null);
	let editFirstName = $state('');
	let editLastName = $state('');
	let editRole = $state<'user' | 'admin'>('user');
	let editQuotaGb = $state(10);
	let editUnlimited = $state(false);
	let editActive = $state(true);
	let editNewPass = $state('');
	let editReset2fa = $state(false);

	let savingSettings = $state(false);

	async function loadOverview() {
		loading = true;
		try {
			const [ovRes, cfgRes] = await Promise.all([
				fetch('/api/admin/overview'),
				fetch('/api/admin/storage-config')
			]);
			const payload = await ovRes.json();
			if (!ovRes.ok) {
				toast.error(payload.error || 'Erro ao carregar painel administrativo.');
				return;
			}
			stats = payload.stats;
			users = payload.users;
			auditLogs = payload.auditLogs;
			settings = payload.settings;
			newQuotaGb = Math.max(10, payload.settings.default_quota_gb);

			if (cfgRes.ok) {
				const cfg = await cfgRes.json();
				diskPath = cfg.disk.raw_path;
				diskResolved = cfg.disk.resolved_path;
				diskFreeBytes = cfg.disk.free_bytes;
				diskTotalBytes = cfg.disk.total_bytes;

				dbHost = cfg.database.host;
				dbPort = cfg.database.port;
				dbUser = cfg.database.user;
				dbName = cfg.database.database;
				dbHasPassword = cfg.database.has_password;
				dbKeepPassword = cfg.database.has_password;
				dbPassword = '';
			}
		} finally {
			loading = false;
		}
	}

	onMount(loadOverview);

	async function testDiskPath() {
		diskBusy = true;
		try {
			const res = await fetch('/api/admin/storage-config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'test-disk', storage_root: diskPath })
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error || 'Diretório inválido.');
				return;
			}
			diskResolved = data.resolved_path;
			diskFreeBytes = data.free_bytes;
			diskTotalBytes = data.total_bytes;
			toast.success(`Diretório acessível e gravável: ${data.resolved_path}`);
		} finally {
			diskBusy = false;
		}
	}

	async function saveDiskPath(e: SubmitEvent) {
		e.preventDefault();
		diskBusy = true;
		try {
			const res = await fetch('/api/admin/storage-config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'save-disk',
					storage_root: diskPath,
					migrate: migrateFiles
				})
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error || 'Erro ao aplicar diretório.');
				return;
			}
			diskResolved = data.resolved_path;
			diskFreeBytes = data.free_bytes;
			diskTotalBytes = data.total_bytes;
			toast.success(
				migrateFiles && data.migrated_count > 0
					? `Diretório alterado e ${data.migrated_count} arquivo(s) migrado(s)!`
					: 'Local de armazenamento em disco atualizado!'
			);
			await loadOverview();
		} finally {
			diskBusy = false;
		}
	}

	async function testDbConn() {
		dbBusy = true;
		dbTestVersion = null;
		try {
			const res = await fetch('/api/admin/storage-config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'test-db',
					host: dbHost,
					port: dbPort,
					user: dbUser,
					password: dbPassword,
					keep_existing_password: dbKeepPassword
				})
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error || 'Falha ao conectar no MariaDB.');
				return;
			}
			dbTestVersion = data.version;
			toast.success(`Conexão bem-sucedida! Servidor: ${data.version}`);
		} finally {
			dbBusy = false;
		}
	}

	async function saveDbConn(e: SubmitEvent) {
		e.preventDefault();
		if (
			!confirm(
				`Aplicar nova conexão MariaDB (${dbUser}@${dbHost}:${dbPort}/${dbName})? O pool será reconectado imediatamente.`
			)
		) {
			return;
		}
		dbBusy = true;
		try {
			const res = await fetch('/api/admin/storage-config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'save-db',
					host: dbHost,
					port: dbPort,
					user: dbUser,
					password: dbPassword,
					keep_existing_password: dbKeepPassword,
					database: dbName
				})
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error || 'Não foi possível salvar a conexão do banco.');
				return;
			}
			toast.success(`Banco MariaDB atualizado e reconectado (${data.version})!`);
			await loadOverview();
		} finally {
			dbBusy = false;
		}
	}

	async function createUser(e: SubmitEvent) {
		e.preventDefault();
		if (!newUnlimited && newQuotaGb < 10) {
			toast.error('A cota mínima para novos usuários é de 10 GB.');
			return;
		}
		const res = await fetch('/api/admin/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: newUsername,
				first_name: newFirstName,
				last_name: newLastName,
				password: newPassword,
				role: newRole,
				quota_gb: newQuotaGb,
				unlimited: newUnlimited
			})
		});
		const payload = await res.json();
		if (!res.ok) {
			toast.error(payload.error || 'Falha ao criar usuário.');
			return;
		}
		toast.success(`Usuário @${payload.username} cadastrado!`);
		showCreateModal = false;
		newUsername = '';
		newFirstName = '';
		newLastName = '';
		newPassword = '';
		newRole = 'user';
		newUnlimited = false;
		newQuotaGb = Math.max(10, settings.default_quota_gb);
		await loadOverview();
	}

	function openEdit(u: SafeUser) {
		editUser = u;
		editFirstName = u.first_name;
		editLastName = u.last_name;
		editRole = u.role;
		editUnlimited = u.quota_bytes < 0;
		editQuotaGb =
			u.quota_bytes < 0
				? 50
				: Math.max(10, Math.round(u.quota_bytes / (1024 * 1024 * 1024)));
		editActive = u.is_active;
		editNewPass = '';
		editReset2fa = false;
	}

	async function saveUserEdit(e: SubmitEvent) {
		e.preventDefault();
		if (!editUser) return;
		if (!editUnlimited && editQuotaGb < 10) {
			toast.error('A cota mínima permitida é de 10 GB.');
			return;
		}
		const res = await fetch(`/api/admin/users/${editUser.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				first_name: editFirstName,
				last_name: editLastName,
				role: editRole,
				quota_gb: editUnlimited ? -1 : editQuotaGb,
				is_active: editActive,
				new_password: editNewPass.trim() ? editNewPass.trim() : undefined,
				reset_2fa: editReset2fa || undefined
			})
		});
		const payload = await res.json();
		if (!res.ok) {
			toast.error(payload.error || 'Falha ao atualizar usuário.');
			return;
		}
		toast.success('Usuário atualizado!');
		editUser = null;
		await loadOverview();
	}

	async function deleteUser(u: SafeUser) {
		if (
			!confirm(
				`Excluir permanentemente a conta @${u.username} (${u.full_name}) e todos os seus arquivos?`
			)
		) {
			return;
		}
		const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
		const payload = await res.json();
		if (!res.ok) {
			toast.error(payload.error || 'Não foi possível excluir usuário.');
			return;
		}
		toast.success('Usuário e arquivos removidos.');
		await loadOverview();
	}

	async function saveSettings(e: SubmitEvent) {
		e.preventDefault();
		if (settings.default_quota_gb < 10) {
			toast.error('A cota padrão mínima é de 10 GB.');
			return;
		}
		savingSettings = true;
		try {
			const res = await fetch('/api/admin/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(settings)
			});
			const data = await res.json();
			if (res.ok) {
				toast.success('Políticas de cota e upload salvas!');
				await loadOverview();
			} else {
				toast.error(data.error || 'Erro ao salvar configurações.');
			}
		} finally {
			savingSettings = false;
		}
	}
</script>

<svelte:head>
	<title>Painel Admin — Lizzart Explorer</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
	<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold text-white">Painel Administrativo</h1>
			<p class="mt-1 text-sm text-slate-400">
				Contas, cotas (mín. 10 GB), auditoria, local dos arquivos em disco e banco MariaDB.
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2.5">
			<button
				type="button"
				onclick={loadOverview}
				class="inline-flex items-center gap-2 rounded-xl border border-[#233047] bg-[#131c2e] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-[#19253c]"
			>
				<RefreshCw class="h-3.5 w-3.5" />
				Atualizar
			</button>
			<button
				type="button"
				onclick={() => (showCreateModal = true)}
				class="inline-flex items-center gap-2 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-accent-600/25 hover:bg-accent-500"
			>
				<UserPlus class="h-4 w-4" />
				Cadastrar Usuário
			</button>
		</div>
	</div>

	<!-- KPI Cards -->
	<div class="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-4 sm:p-5">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-slate-400">Contas</span>
				<div class="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400">
					<Users class="h-4 w-4" />
				</div>
			</div>
			<p class="mt-2.5 text-xl font-bold text-white sm:text-2xl">{stats.total_users}</p>
			<p class="mt-0.5 text-[11px] text-slate-500">{stats.admin_count} admins • {stats.active_count} ativas</p>
		</div>

		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-4 sm:p-5">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-slate-400">Em Disco</span>
				<div class="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400">
					<HardDrive class="h-4 w-4" />
				</div>
			</div>
			<p class="mt-2.5 text-xl font-bold text-white sm:text-2xl">{formatBytes(stats.total_used_bytes)}</p>
			<p class="mt-0.5 truncate font-mono text-[10px] text-slate-500" title={stats.storage_root}>
				{stats.storage_root || './storage'}
			</p>
		</div>

		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-4 sm:p-5">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-slate-400">Índice MariaDB</span>
				<div class="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
					<FileStack class="h-4 w-4" />
				</div>
			</div>
			<p class="mt-2.5 text-xl font-bold text-white sm:text-2xl">{stats.total_files}</p>
			<p class="mt-0.5 text-[11px] text-slate-500">{stats.total_folders} pastas • {stats.trashed_items} lixeira</p>
		</div>

		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-4 sm:p-5">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-slate-400">Links Públicos</span>
				<div class="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
					<Link2 class="h-4 w-4" />
				</div>
			</div>
			<p class="mt-2.5 text-xl font-bold text-white sm:text-2xl">{stats.active_links}</p>
			<p class="mt-0.5 text-[11px] text-slate-500">{stats.total_downloads} downloads</p>
		</div>
	</div>

	<!-- Tabs -->
	<div class="mb-5 flex gap-1 overflow-x-auto border-b border-[#1a253a]">
		<button
			type="button"
			onclick={() => (tab = 'users')}
			class="inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition {tab === 'users'
				? 'border-accent-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<Shield class="h-4 w-4" />
			Usuários & Cotas
		</button>
		<button
			type="button"
			onclick={() => (tab = 'audit')}
			class="inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition {tab === 'audit'
				? 'border-accent-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<Activity class="h-4 w-4" />
			Logs de Auditoria
		</button>
		<button
			type="button"
			onclick={() => (tab = 'settings')}
			class="inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition {tab === 'settings'
				? 'border-accent-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<Settings class="h-4 w-4" />
			Armazenamento & Banco
		</button>
	</div>

	{#if loading}
		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-12 text-center text-sm text-slate-400">
			Carregando dados do MariaDB...
		</div>
	{:else if tab === 'users'}
		<div class="overflow-x-auto rounded-2xl border border-[#1f2d45] bg-[#131c2e]">
			<table class="w-full text-left text-sm">
				<thead class="border-b border-[#1f2d45] bg-[#0e1525] text-xs uppercase tracking-wider text-slate-400">
					<tr>
						<th class="px-4 py-3.5 sm:px-5">Usuário</th>
						<th class="px-4 py-3.5">Cargo</th>
						<th class="px-4 py-3.5">Uso / Cota</th>
						<th class="hidden px-4 py-3.5 sm:table-cell">2FA</th>
						<th class="hidden px-4 py-3.5 md:table-cell">Status</th>
						<th class="px-4 py-3.5 text-right sm:px-5">Ações</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[#1a253a]">
					{#each users as u (u.id)}
						<tr class="hover:bg-[#182338]">
							<td class="px-4 py-3.5 sm:px-5">
								<div class="flex items-center gap-3">
									{#if u.avatar_url}
										<img src={u.avatar_url} alt={u.full_name} class="h-9 w-9 shrink-0 rounded-full object-cover" />
									{:else}
										<div
											class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
											style="background-color: {u.avatar_color}"
										>
											{getInitials(u.full_name)}
										</div>
									{/if}
									<div class="min-w-0">
										<p class="truncate font-medium text-white">{u.full_name}</p>
										<p class="truncate font-mono text-xs text-slate-400">@{u.username}</p>
									</div>
								</div>
							</td>
							<td class="whitespace-nowrap px-4 py-3.5">
								<span
									class="rounded-full px-2.5 py-0.5 text-xs font-semibold {u.role === 'admin'
										? 'bg-accent-500/20 text-accent-300'
										: 'bg-slate-700/50 text-slate-300'}"
								>
									{u.role === 'admin' ? 'Admin' : 'Usuário'}
								</span>
							</td>
							<td class="whitespace-nowrap px-4 py-3.5 font-mono text-xs text-slate-300">
								{formatBytes(u.used_bytes)} / {formatBytes(u.quota_bytes)}
							</td>
							<td class="hidden px-4 py-3.5 sm:table-cell">
								{#if u.totp_enabled}
									<span class="inline-flex items-center gap-1 rounded-full bg-accent-500/15 px-2 py-0.5 text-[11px] font-medium text-accent-300">
										<Smartphone class="h-3 w-3" /> Ativo
									</span>
								{:else}
									<span class="text-xs text-slate-500">—</span>
								{/if}
							</td>
							<td class="hidden px-4 py-3.5 md:table-cell">
								<span
									class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium {u.is_active
										? 'bg-accent-500/15 text-accent-300'
										: 'bg-rose-500/15 text-rose-300'}"
								>
									<span class="h-1.5 w-1.5 rounded-full {u.is_active ? 'bg-accent-400' : 'bg-rose-400'}"></span>
									{u.is_active ? 'Ativo' : 'Suspenso'}
								</span>
							</td>
							<td class="px-4 py-3.5 sm:px-5">
								<div class="flex justify-end gap-1.5">
									<button
										type="button"
										onclick={() => openEdit(u)}
										class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white"
										title="Editar permissões e cota"
									>
										<Pencil class="h-4 w-4" />
									</button>
									{#if u.id !== data.user.id}
										<button
											type="button"
											onclick={() => deleteUser(u)}
											class="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
											title="Excluir conta"
										>
											<Trash2 class="h-4 w-4" />
										</button>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else if tab === 'audit'}
		<div class="overflow-x-auto rounded-2xl border border-[#1f2d45] bg-[#131c2e]">
			<table class="w-full text-left text-xs">
				<thead class="border-b border-[#1f2d45] bg-[#0e1525] uppercase tracking-wider text-slate-400">
					<tr>
						<th class="px-4 py-3">Data</th>
						<th class="px-4 py-3">Usuário</th>
						<th class="px-4 py-3">Ação</th>
						<th class="px-4 py-3">Detalhes</th>
						<th class="hidden px-4 py-3 sm:table-cell">IP</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[#1a253a]">
					{#each auditLogs as log (log.id)}
						<tr class="hover:bg-[#182338]">
							<td class="whitespace-nowrap px-4 py-3 text-slate-400">{formatDate(log.created_at)}</td>
							<td class="px-4 py-3 text-slate-200">{log.username ? `@${log.username}` : 'Sistema'}</td>
							<td class="px-4 py-3">
								<code class="rounded bg-[#0b101b] px-2 py-0.5 font-mono text-[11px] text-accent-300">
									{log.action}
								</code>
							</td>
							<td class="px-4 py-3 text-slate-300">{log.details || '—'}</td>
							<td class="hidden px-4 py-3 font-mono text-slate-500 sm:table-cell">{log.ip_address || '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<!-- STORAGE & DATABASE INFRASTRUCTURE SETTINGS -->
		<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
			<!-- 1. Local Disk Storage Path -->
			<form onsubmit={saveDiskPath} class="space-y-4 rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 sm:p-6">
				<div class="flex items-center gap-2.5 border-b border-[#1f2d45] pb-3.5">
					<div class="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400">
						<FolderCog class="h-4 w-4" />
					</div>
					<div>
						<h3 class="text-sm font-semibold text-white">Local dos Arquivos em Disco</h3>
						<p class="text-xs text-slate-400">Os arquivos físicos dos usuários são gravados diretamente neste diretório.</p>
					</div>
				</div>

				<div>
					<label for="diskp" class="mb-1.5 block text-xs font-medium text-slate-400">
						Caminho do Diretório (<code class="font-mono text-accent-300">STORAGE_ROOT</code>)
					</label>
					<input
						id="diskp"
						type="text"
						required
						bind:value={diskPath}
						placeholder="Ex: D:\LizzartStorage ou ./storage"
						class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 font-mono text-xs text-white outline-none focus:border-accent-500"
					/>
					{#if diskResolved}
						<p class="mt-1.5 break-all font-mono text-[11px] text-slate-500">
							Resolvido: <span class="text-slate-300">{diskResolved}</span>
						</p>
					{/if}
				</div>

				{#if diskFreeBytes !== null && diskTotalBytes !== null}
					<div class="rounded-xl border border-[#1f2d45] bg-[#0b101b] p-3 text-xs">
						<div class="flex items-center justify-between text-slate-300">
							<span>Espaço livre no volume</span>
							<span class="font-mono font-semibold text-accent-300">
								{formatBytes(diskFreeBytes)} livre / {formatBytes(diskTotalBytes)}
							</span>
						</div>
					</div>
				{/if}

				<label class="flex items-center gap-2 text-xs text-slate-300">
					<input type="checkbox" bind:checked={migrateFiles} class="accent-accent-500" />
					Migrar arquivos e avatares já existentes para o novo diretório
				</label>

				<div class="flex flex-wrap gap-2 pt-1">
					<button
						type="button"
						disabled={diskBusy}
						onclick={testDiskPath}
						class="rounded-xl border border-[#233047] bg-[#0e1525] px-4 py-2 text-xs font-medium text-slate-200 hover:bg-[#19253c] disabled:opacity-50"
					>
						Testar Diretório
					</button>
					<button
						type="submit"
						disabled={diskBusy}
						class="inline-flex items-center gap-1.5 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
					>
						<Save class="h-3.5 w-3.5" />
						{diskBusy ? 'Aplicando...' : 'Salvar Local em Disco'}
					</button>
				</div>
			</form>

			<!-- 2. MariaDB Metadata & Index Connection -->
			<form onsubmit={saveDbConn} class="space-y-4 rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 sm:p-6">
				<div class="flex items-center gap-2.5 border-b border-[#1f2d45] pb-3.5">
					<div class="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
						<Database class="h-4 w-4" />
					</div>
					<div>
						<h3 class="text-sm font-semibold text-white">Banco de Dados MariaDB (Metadados & Índice)</h3>
						<p class="text-xs text-slate-400">Armazena apenas contas, permissões, cotas e o índice dos arquivos no disco.</p>
					</div>
				</div>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
					<div class="sm:col-span-2">
						<label for="dbh" class="mb-1 block text-xs text-slate-400">Host / IP</label>
						<input id="dbh" type="text" required bind:value={dbHost} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 font-mono text-xs text-white outline-none focus:border-accent-500" />
					</div>
					<div>
						<label for="dbp" class="mb-1 block text-xs text-slate-400">Porta</label>
						<input id="dbp" type="number" required bind:value={dbPort} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 font-mono text-xs text-white outline-none focus:border-accent-500" />
					</div>
				</div>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div>
						<label for="dbu" class="mb-1 block text-xs text-slate-400">Usuário MariaDB</label>
						<input id="dbu" type="text" required bind:value={dbUser} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 font-mono text-xs text-white outline-none focus:border-accent-500" />
					</div>
					<div>
						<label for="dbn" class="mb-1 block text-xs text-slate-400">Nome do Banco</label>
						<input id="dbn" type="text" required bind:value={dbName} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 font-mono text-xs text-white outline-none focus:border-accent-500" />
					</div>
				</div>

				<div>
					<label for="dbpw" class="mb-1 block text-xs text-slate-400">Senha do Banco</label>
					<input
						id="dbpw"
						type="password"
						disabled={dbHasPassword && dbKeepPassword}
						bind:value={dbPassword}
						placeholder={dbHasPassword ? 'Mantendo senha atual...' : 'Sem senha (vazio)'}
						class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-xs text-white outline-none focus:border-accent-500 disabled:opacity-50"
					/>
					{#if dbHasPassword}
						<label class="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400">
							<input type="checkbox" bind:checked={dbKeepPassword} class="accent-accent-500" />
							Manter senha configurada atualmente
						</label>
					{/if}
				</div>

				{#if dbTestVersion}
					<div class="flex items-center gap-2 rounded-xl border border-accent-500/30 bg-accent-500/10 px-3 py-2 text-xs text-accent-200">
						<CheckCircle2 class="h-4 w-4 shrink-0 text-accent-400" />
						<span>Conectado com sucesso: <strong class="font-mono">{dbTestVersion}</strong></span>
					</div>
				{/if}

				<div class="flex flex-wrap gap-2 pt-1">
					<button
						type="button"
						disabled={dbBusy}
						onclick={testDbConn}
						class="rounded-xl border border-[#233047] bg-[#0e1525] px-4 py-2 text-xs font-medium text-slate-200 hover:bg-[#19253c] disabled:opacity-50"
					>
						Testar Conexão
					</button>
					<button
						type="submit"
						disabled={dbBusy}
						class="inline-flex items-center gap-1.5 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
					>
						<Database class="h-3.5 w-3.5" />
						{dbBusy ? 'Reconectando...' : 'Salvar & Reconectar'}
					</button>
				</div>
			</form>

			<!-- 3. Quotas & Upload Policies -->
			<form onsubmit={saveSettings} class="space-y-4 rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 sm:p-6 lg:col-span-2">
				<div class="border-b border-[#1f2d45] pb-3">
					<h3 class="text-sm font-semibold text-white">Políticas de Cota & Upload</h3>
					<p class="text-xs text-slate-400">
						O auto-registro público é desativado por padrão; apenas administradores cadastram novas contas.
					</p>
				</div>

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label for="defq" class="mb-1.5 block text-xs font-medium text-slate-400">
							Cota padrão p/ novos usuários (GB — mín. 10)
						</label>
						<input
							id="defq"
							type="number"
							min="10"
							bind:value={settings.default_quota_gb}
							class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 text-sm text-white outline-none focus:border-accent-500"
						/>
					</div>
					<div>
						<label for="maxup" class="mb-1.5 block text-xs font-medium text-slate-400">
							Tamanho máximo por arquivo (MB)
						</label>
						<input
							id="maxup"
							type="number"
							min="10"
							bind:value={settings.max_upload_mb}
							class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 text-sm text-white outline-none focus:border-accent-500"
						/>
					</div>
				</div>

				<button
					type="submit"
					disabled={savingSettings}
					class="inline-flex items-center gap-2 rounded-xl bg-accent-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
				>
					<Save class="h-4 w-4" />
					{savingSettings ? 'Salvando...' : 'Salvar Políticas'}
				</button>
			</form>
		</div>
	{/if}
</div>

<!-- Create User Modal -->
{#if showCreateModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
		<form
			onsubmit={createUser}
			class="w-full max-w-md space-y-4 rounded-2xl border border-[#233047] bg-[#131c2e] p-6 shadow-2xl"
		>
			<div class="flex items-center justify-between">
				<h3 class="text-base font-semibold text-white">Cadastrar Novo Usuário</h3>
				<button type="button" onclick={() => (showCreateModal = false)} class="text-slate-400 hover:text-white">
					<X class="h-4 w-4" />
				</button>
			</div>

			<div>
				<label for="cu" class="mb-1 block text-xs text-slate-400">Usuário (imutável)</label>
				<div class="relative">
					<span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-accent-400">@</span>
					<input id="cu" type="text" required minlength={3} bind:value={newUsername} placeholder="ex: maria.silva" class="w-full rounded-xl border border-[#233047] bg-[#0b101b] py-2 pr-3 pl-7 font-mono text-sm text-white outline-none focus:border-accent-500" />
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="cfn" class="mb-1 block text-xs text-slate-400">Nome</label>
					<input id="cfn" type="text" required minlength={2} bind:value={newFirstName} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500" />
				</div>
				<div>
					<label for="cln" class="mb-1 block text-xs text-slate-400">Sobrenome</label>
					<input id="cln" type="text" required minlength={2} bind:value={newLastName} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500" />
				</div>
			</div>

			<div>
				<label for="cp" class="mb-1 block text-xs text-slate-400">Senha inicial</label>
				<input id="cp" type="password" required minlength={6} bind:value={newPassword} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-accent-500" />
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="cr" class="mb-1 block text-xs text-slate-400">Cargo</label>
					<select id="cr" bind:value={newRole} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500">
						<option value="user">Usuário</option>
						<option value="admin">Administrador</option>
					</select>
				</div>
				<div>
					<label for="cq" class="mb-1 block text-xs text-slate-400">Cota (GB — mín. 10)</label>
					<input
						id="cq"
						type="number"
						min="10"
						disabled={newUnlimited}
						bind:value={newQuotaGb}
						class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500 disabled:opacity-40"
					/>
				</div>
			</div>

			<label class="flex items-center gap-2 text-xs text-slate-300">
				<input type="checkbox" bind:checked={newUnlimited} class="accent-accent-500" />
				Cota ilimitada
			</label>

			<div class="flex justify-end gap-2 pt-2">
				<button type="button" onclick={() => (showCreateModal = false)} class="rounded-xl border border-[#233047] px-4 py-2 text-xs text-slate-300">Cancelar</button>
				<button type="submit" class="rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500">Criar Conta</button>
			</div>
		</form>
	</div>
{/if}

<!-- Edit User Modal -->
{#if editUser}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
		<form
			onsubmit={saveUserEdit}
			class="w-full max-w-md space-y-4 rounded-2xl border border-[#233047] bg-[#131c2e] p-6 shadow-2xl"
		>
			<div class="flex items-center justify-between">
				<div>
					<h3 class="text-base font-semibold text-white">Editar @{editUser.username}</h3>
					<p class="text-xs text-slate-400">Usuário imutável • Nome e cotas editáveis</p>
				</div>
				<button type="button" onclick={() => (editUser = null)} class="text-slate-400 hover:text-white">
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="efn" class="mb-1 block text-xs text-slate-400">Nome</label>
					<input id="efn" type="text" required minlength={2} bind:value={editFirstName} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500" />
				</div>
				<div>
					<label for="eln" class="mb-1 block text-xs text-slate-400">Sobrenome</label>
					<input id="eln" type="text" required minlength={2} bind:value={editLastName} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500" />
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="er" class="mb-1 block text-xs text-slate-400">Cargo</label>
					<select id="er" bind:value={editRole} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500">
						<option value="user">Usuário</option>
						<option value="admin">Administrador</option>
					</select>
				</div>
				<div>
					<label for="eq" class="mb-1 block text-xs text-slate-400">Cota (GB — mín. 10)</label>
					<input
						id="eq"
						type="number"
						min="10"
						disabled={editUnlimited}
						bind:value={editQuotaGb}
						class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500 disabled:opacity-40"
					/>
				</div>
			</div>

			<div class="space-y-2 text-xs text-slate-300">
				<label class="flex items-center gap-2">
					<input type="checkbox" bind:checked={editUnlimited} class="accent-accent-500" />
					Cota ilimitada
				</label>
				<label class="flex items-center gap-2">
					<input type="checkbox" bind:checked={editActive} class="accent-accent-500" />
					Conta ativa (desmarque para suspender)
				</label>
				{#if editUser.totp_enabled}
					<label class="flex items-center gap-2 text-amber-300">
						<input type="checkbox" bind:checked={editReset2fa} class="accent-amber-500" />
						Resetar 2FA deste usuário (recuperação de conta)
					</label>
				{/if}
			</div>

			<div>
				<label for="epw" class="mb-1 block text-xs text-slate-400">Redefinir senha (opcional)</label>
				<input id="epw" type="password" minlength={6} bind:value={editNewPass} placeholder="Deixe em branco para manter" class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-accent-500" />
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<button type="button" onclick={() => (editUser = null)} class="rounded-xl border border-[#233047] px-4 py-2 text-xs text-slate-300">Cancelar</button>
				<button type="submit" class="rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500">Salvar</button>
			</div>
		</form>
	</div>
{/if}
