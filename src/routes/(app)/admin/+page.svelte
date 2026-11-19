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
		RefreshCw
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
		allow_registration: true,
		default_quota_gb: 10,
		max_upload_mb: 512
	});

	// Create user modal
	let showCreateModal = $state(false);
	let newName = $state('');
	let newEmail = $state('');
	let newPassword = $state('');
	let newRole = $state<'user' | 'admin'>('user');
	let newQuotaGb = $state(10);

	// Edit user modal
	let editUser = $state<SafeUser | null>(null);
	let editRole = $state<'user' | 'admin'>('user');
	let editQuotaGb = $state(10);
	let editUnlimited = $state(false);
	let editActive = $state(true);
	let editNewPass = $state('');

	let savingSettings = $state(false);

	async function loadOverview() {
		loading = true;
		try {
			const res = await fetch('/api/admin/overview');
			const payload = await res.json();
			if (!res.ok) {
				toast.error(payload.error || 'Erro ao carregar painel administrativo.');
				return;
			}
			stats = payload.stats;
			users = payload.users;
			auditLogs = payload.auditLogs;
			settings = payload.settings;
		} finally {
			loading = false;
		}
	}

	onMount(loadOverview);

	async function createUser(e: SubmitEvent) {
		e.preventDefault();
		const res = await fetch('/api/admin/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: newName,
				email: newEmail,
				password: newPassword,
				role: newRole,
				quota_gb: newQuotaGb
			})
		});
		const payload = await res.json();
		if (!res.ok) {
			toast.error(payload.error || 'Falha ao criar usuário.');
			return;
		}
		toast.success(`Usuário "${newName}" criado!`);
		showCreateModal = false;
		newName = '';
		newEmail = '';
		newPassword = '';
		newRole = 'user';
		newQuotaGb = settings.default_quota_gb;
		await loadOverview();
	}

	function openEdit(u: SafeUser) {
		editUser = u;
		editRole = u.role;
		editUnlimited = u.quota_bytes < 0;
		editQuotaGb = u.quota_bytes < 0 ? 50 : Math.max(1, Math.round(u.quota_bytes / (1024 * 1024 * 1024)));
		editActive = u.is_active;
		editNewPass = '';
	}

	async function saveUserEdit(e: SubmitEvent) {
		e.preventDefault();
		if (!editUser) return;
		const res = await fetch(`/api/admin/users/${editUser.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				role: editRole,
				quota_gb: editUnlimited ? -1 : editQuotaGb,
				is_active: editActive,
				new_password: editNewPass.trim() ? editNewPass.trim() : undefined
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
		if (!confirm(`Excluir permanentemente a conta "${u.name}" (${u.email}) e todos os seus arquivos?`)) {
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
		savingSettings = true;
		try {
			const res = await fetch('/api/admin/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(settings)
			});
			if (res.ok) {
				toast.success('Configurações do sistema salvas!');
				await loadOverview();
			} else {
				toast.error('Erro ao salvar configurações.');
			}
		} finally {
			savingSettings = false;
		}
	}
</script>

<svelte:head>
	<title>Painel Admin — Lizzart Explorer</title>
</svelte:head>

<div class="mx-auto max-w-7xl p-6 lg:p-8">
	<!-- Header -->
	<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold text-white">Painel Administrativo</h1>
			<p class="mt-1 text-sm text-slate-400">
				Gestão de contas, permissões, cotas, auditoria MariaDB e configurações do armazenamento.
			</p>
		</div>
		<div class="flex items-center gap-2.5">
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
				class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500"
			>
				<UserPlus class="h-4 w-4" />
				Novo Usuário
			</button>
		</div>
	</div>

	<!-- KPI Cards -->
	<div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-slate-400">Contas Cadastradas</span>
				<div class="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400">
					<Users class="h-4 w-4" />
				</div>
			</div>
			<p class="mt-3 text-2xl font-bold text-white">{stats.total_users}</p>
			<p class="mt-1 text-xs text-slate-500">{stats.admin_count} admins • {stats.active_count} ativas</p>
		</div>

		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-slate-400">Espaço em Disco</span>
				<div class="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
					<HardDrive class="h-4 w-4" />
				</div>
			</div>
			<p class="mt-3 text-2xl font-bold text-white">{formatBytes(stats.total_used_bytes)}</p>
			<p class="mt-1 truncate font-mono text-[11px] text-slate-500" title={stats.storage_root}>
				{stats.storage_root || './storage'}
			</p>
		</div>

		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-slate-400">Indexados no MariaDB</span>
				<div class="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
					<FileStack class="h-4 w-4" />
				</div>
			</div>
			<p class="mt-3 text-2xl font-bold text-white">{stats.total_files}</p>
			<p class="mt-1 text-xs text-slate-500">{stats.total_folders} pastas • {stats.trashed_items} na lixeira</p>
		</div>

		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-slate-400">Links Públicos</span>
				<div class="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
					<Link2 class="h-4 w-4" />
				</div>
			</div>
			<p class="mt-3 text-2xl font-bold text-white">{stats.active_links}</p>
			<p class="mt-1 text-xs text-slate-500">{stats.total_downloads} downloads externos</p>
		</div>
	</div>

	<!-- Tabs -->
	<div class="mb-5 flex gap-2 border-b border-[#1a253a]">
		<button
			type="button"
			onclick={() => (tab = 'users')}
			class="inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition {tab === 'users'
				? 'border-indigo-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<Shield class="h-4 w-4" />
			Usuários & Cargos
		</button>
		<button
			type="button"
			onclick={() => (tab = 'audit')}
			class="inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition {tab === 'audit'
				? 'border-indigo-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<Activity class="h-4 w-4" />
			Logs de Auditoria
		</button>
		<button
			type="button"
			onclick={() => (tab = 'settings')}
			class="inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition {tab === 'settings'
				? 'border-indigo-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<Settings class="h-4 w-4" />
			Configurações
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
						<th class="px-5 py-3.5">Usuário</th>
						<th class="px-5 py-3.5">Cargo</th>
						<th class="px-5 py-3.5">Uso / Cota</th>
						<th class="px-5 py-3.5">Status</th>
						<th class="px-5 py-3.5">Criado em</th>
						<th class="px-5 py-3.5 text-right">Ações</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[#1a253a]">
					{#each users as u (u.id)}
						<tr class="hover:bg-[#182338]">
							<td class="px-5 py-3.5">
								<div class="flex items-center gap-3">
									<div
										class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
										style="background-color: {u.avatar_color}"
									>
										{getInitials(u.name)}
									</div>
									<div>
										<p class="font-medium text-white">{u.name}</p>
										<p class="text-xs text-slate-400">{u.email}</p>
									</div>
								</div>
							</td>
							<td class="px-5 py-3.5">
								<span
									class="rounded-full px-2.5 py-0.5 text-xs font-semibold {u.role === 'admin'
										? 'bg-indigo-500/20 text-indigo-300'
										: 'bg-slate-700/50 text-slate-300'}"
								>
									{u.role === 'admin' ? 'Admin' : 'Usuário'}
								</span>
							</td>
							<td class="px-5 py-3.5 font-mono text-xs text-slate-300">
								{formatBytes(u.used_bytes)} / {formatBytes(u.quota_bytes)}
							</td>
							<td class="px-5 py-3.5">
								<span
									class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium {u.is_active
										? 'bg-emerald-500/15 text-emerald-300'
										: 'bg-rose-500/15 text-rose-300'}"
								>
									<span class="h-1.5 w-1.5 rounded-full {u.is_active ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
									{u.is_active ? 'Ativo' : 'Suspenso'}
								</span>
							</td>
							<td class="px-5 py-3.5 text-xs text-slate-400">{formatDate(u.created_at)}</td>
							<td class="px-5 py-3.5">
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
						<th class="px-4 py-3">IP</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[#1a253a]">
					{#each auditLogs as log (log.id)}
						<tr class="hover:bg-[#182338]">
							<td class="whitespace-nowrap px-4 py-3 text-slate-400">{formatDate(log.created_at)}</td>
							<td class="px-4 py-3 text-slate-200">{log.user_name || 'Sistema'}</td>
							<td class="px-4 py-3">
								<code class="rounded bg-[#0b101b] px-2 py-0.5 font-mono text-[11px] text-indigo-300">
									{log.action}
								</code>
							</td>
							<td class="px-4 py-3 text-slate-300">{log.details || '—'}</td>
							<td class="px-4 py-3 font-mono text-slate-500">{log.ip_address || '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<form onsubmit={saveSettings} class="max-w-xl space-y-5 rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-6">
			<div class="flex items-center justify-between gap-4 rounded-xl border border-[#233047] bg-[#0e1525] p-4">
				<div>
					<p class="text-sm font-semibold text-white">Permitir Registro Público</p>
					<p class="text-xs text-slate-400">Permite que novos usuários criem contas na tela de login.</p>
				</div>
				<input
					type="checkbox"
					bind:checked={settings.allow_registration}
					class="h-5 w-5 accent-indigo-600"
				/>
			</div>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div>
					<label for="defq" class="mb-1.5 block text-xs font-medium text-slate-400">
						Cota padrão para novos usuários (GB)
					</label>
					<input
						id="defq"
						type="number"
						min="1"
						bind:value={settings.default_quota_gb}
						class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
					/>
				</div>
				<div>
					<label for="maxup" class="mb-1.5 block text-xs font-medium text-slate-400">
						Tamanho máximo por arquivo (MB)
					</label>
					<input
						id="maxup"
						type="number"
						min="1"
						bind:value={settings.max_upload_mb}
						class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
					/>
				</div>
			</div>

			<button
				type="submit"
				disabled={savingSettings}
				class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
			>
				<Save class="h-4 w-4" />
				{savingSettings ? 'Salvando...' : 'Salvar Configurações'}
			</button>
		</form>
	{/if}
</div>

<!-- Create User Modal -->
{#if showCreateModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
		<form
			onsubmit={createUser}
			class="w-full max-w-md rounded-2xl border border-[#233047] bg-[#131c2e] p-6 shadow-2xl space-y-4"
		>
			<div class="flex items-center justify-between">
				<h3 class="text-base font-semibold text-white">Criar Novo Usuário</h3>
				<button type="button" onclick={() => (showCreateModal = false)} class="text-slate-400 hover:text-white">
					<X class="h-4 w-4" />
				</button>
			</div>

			<div>
				<label for="cn" class="mb-1 block text-xs text-slate-400">Nome</label>
				<input id="cn" type="text" required bind:value={newName} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-indigo-500" />
			</div>
			<div>
				<label for="ce" class="mb-1 block text-xs text-slate-400">E-mail</label>
				<input id="ce" type="email" required bind:value={newEmail} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-indigo-500" />
			</div>
			<div>
				<label for="cp" class="mb-1 block text-xs text-slate-400">Senha inicial</label>
				<input id="cp" type="password" required minlength={6} bind:value={newPassword} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-indigo-500" />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="cr" class="mb-1 block text-xs text-slate-400">Cargo</label>
					<select id="cr" bind:value={newRole} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-indigo-500">
						<option value="user">Usuário</option>
						<option value="admin">Administrador</option>
					</select>
				</div>
				<div>
					<label for="cq" class="mb-1 block text-xs text-slate-400">Cota (GB)</label>
					<input id="cq" type="number" min="-1" bind:value={newQuotaGb} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
				</div>
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<button type="button" onclick={() => (showCreateModal = false)} class="rounded-xl border border-[#233047] px-4 py-2 text-xs text-slate-300">Cancelar</button>
				<button type="submit" class="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500">Criar Conta</button>
			</div>
		</form>
	</div>
{/if}

<!-- Edit User Modal -->
{#if editUser}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
		<form
			onsubmit={saveUserEdit}
			class="w-full max-w-md rounded-2xl border border-[#233047] bg-[#131c2e] p-6 shadow-2xl space-y-4"
		>
			<div class="flex items-center justify-between">
				<div>
					<h3 class="text-base font-semibold text-white">Editar {editUser.name}</h3>
					<p class="text-xs text-slate-400">{editUser.email}</p>
				</div>
				<button type="button" onclick={() => (editUser = null)} class="text-slate-400 hover:text-white">
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="er" class="mb-1 block text-xs text-slate-400">Cargo</label>
					<select id="er" bind:value={editRole} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-indigo-500">
						<option value="user">Usuário</option>
						<option value="admin">Administrador</option>
					</select>
				</div>
				<div>
					<label for="eq" class="mb-1 block text-xs text-slate-400">Cota (GB)</label>
					<input
						id="eq"
						type="number"
						min="1"
						disabled={editUnlimited}
						bind:value={editQuotaGb}
						class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 disabled:opacity-40"
					/>
				</div>
			</div>

			<label class="flex items-center gap-2 text-xs text-slate-300">
				<input type="checkbox" bind:checked={editUnlimited} class="accent-indigo-600" />
				Cota ilimitada
			</label>

			<label class="flex items-center gap-2 text-xs text-slate-300">
				<input type="checkbox" bind:checked={editActive} class="accent-emerald-600" />
				Conta ativa (desmarque para suspender acesso)
			</label>

			<div>
				<label for="epw" class="mb-1 block text-xs text-slate-400">Redefinir senha (deixe em branco para manter)</label>
				<input
					id="epw"
					type="password"
					minlength={6}
					bind:value={editNewPass}
					placeholder="Nova senha opcional"
					class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-indigo-500"
				/>
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<button type="button" onclick={() => (editUser = null)} class="rounded-xl border border-[#233047] px-4 py-2 text-xs text-slate-300">Cancelar</button>
				<button type="submit" class="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500">Salvar</button>
			</div>
		</form>
	</div>
{/if}
