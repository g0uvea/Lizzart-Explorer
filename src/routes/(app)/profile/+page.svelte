<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { toast } from '$lib/stores/toast.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { ACCENT_PRESETS } from '$lib/theme';
	import type { LayoutDensity, SortBy, SortDir, ViewMode } from '$lib/types';
	import { formatBytes, formatDate, getInitials } from '$lib/utils';
	import {
		User,
		Lock,
		Save,
		ShieldCheck,
		HardDrive,
		Camera,
		Trash2,
		Palette,
		Smartphone,
		KeyRound,
		Copy,
		LayoutGrid,
		List,
		Minimize2,
		Check,
		MonitorSmartphone,
		LogOut
	} from 'lucide-svelte';

	let { data } = $props();

	let activeTab = $state<'account' | 'appearance'>('account');

	let firstName = $state('');
	let lastName = $state('');
	let avatarColor = $state('#10b981');
	let accentColor = $state('#10b981');
	let layoutDensity = $state<LayoutDensity>('normal');
	let defaultViewMode = $state<ViewMode>('grid');
	let defaultSortBy = $state<SortBy>('name');
	let defaultSortDir = $state<SortDir>('asc');

	let savingAccount = $state(false);
	let savingAppearance = $state(false);
	let uploadingAvatar = $state(false);
	let avatarInputEl = $state<HTMLInputElement | null>(null);

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let savingPassword = $state(false);

	// Local 2FA TOTP state
	let totpSetup = $state<{ secret: string; qrDataUrl: string } | null>(null);
	let totpCode = $state('');
	let totpDisablePass = $state('');
	let totpBusy = $state(false);

	// Active JWT/Refresh sessions
	interface SessionItem {
		id: string;
		ip_address: string;
		user_agent: string;
		last_used_at: string;
		created_at: string;
		expires_at: string;
		is_current: boolean;
	}
	let activeSessions = $state<SessionItem[]>([]);
	let loadingSessions = $state(false);

	async function loadSessions() {
		loadingSessions = true;
		try {
			const res = await fetch('/api/auth/sessions');
			if (res.ok) {
				const d = await res.json();
				activeSessions = d.sessions;
			}
		} finally {
			loadingSessions = false;
		}
	}

	async function revokeSession(id: string) {
		const res = await fetch(`/api/auth/sessions?id=${encodeURIComponent(id)}`, {
			method: 'DELETE'
		});
		if (res.ok) {
			toast.info('Sessão encerrada.');
			await loadSessions();
		}
	}

	async function revokeOtherSessions() {
		const res = await fetch('/api/auth/sessions?others=1', { method: 'DELETE' });
		if (res.ok) {
			toast.success('Todos os outros dispositivos foram desconectados.');
			await loadSessions();
		}
	}

	onMount(loadSessions);

	$effect(() => {
		firstName = data.user.first_name;
		lastName = data.user.last_name;
		avatarColor = data.user.avatar_color;
		accentColor = data.user.accent_color;
		layoutDensity = data.user.layout_density;
		defaultViewMode = data.user.default_view_mode;
		defaultSortBy = data.user.default_sort_by;
		defaultSortDir = data.user.default_sort_dir;
	});

	async function saveAccount(e: SubmitEvent) {
		e.preventDefault();
		savingAccount = true;
		try {
			const res = await fetch('/api/auth/profile', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					first_name: firstName,
					last_name: lastName,
					avatar_color: avatarColor
				})
			});
			const result = await res.json();
			if (!res.ok) {
				toast.error(result.error || 'Erro ao atualizar conta.');
				return;
			}
			toast.success('Dados da conta atualizados!');
			await invalidateAll();
		} finally {
			savingAccount = false;
		}
	}

	async function saveAppearance(e?: SubmitEvent) {
		e?.preventDefault();
		savingAppearance = true;
		try {
			const res = await fetch('/api/auth/profile', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					accent_color: accentColor,
					layout_density: layoutDensity,
					default_view_mode: defaultViewMode,
					default_sort_by: defaultSortBy,
					default_sort_dir: defaultSortDir
				})
			});
			const result = await res.json();
			if (!res.ok) {
				toast.error(result.error || 'Erro ao salvar aparência.');
				return;
			}
			themeStore.setAccent(accentColor);
			themeStore.setDensity(layoutDensity);
			toast.success('Preferências de aparência salvas!');
			await invalidateAll();
		} finally {
			savingAppearance = false;
		}
	}

	async function handleAvatarUpload(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		uploadingAvatar = true;
		try {
			const form = new FormData();
			form.append('avatar', file);
			const res = await fetch('/api/auth/avatar', { method: 'POST', body: form });
			const result = await res.json();
			if (!res.ok) {
				toast.error(result.error || 'Erro ao enviar foto de perfil.');
				return;
			}
			toast.success('Foto de perfil atualizada!');
			await invalidateAll();
		} finally {
			uploadingAvatar = false;
			input.value = '';
		}
	}

	async function removeAvatar() {
		const res = await fetch('/api/auth/avatar', { method: 'DELETE' });
		if (res.ok) {
			toast.info('Foto de perfil removida.');
			await invalidateAll();
		}
	}

	async function changePassword(e: SubmitEvent) {
		e.preventDefault();
		if (newPassword !== confirmPassword) {
			toast.error('As senhas novas não coincidem.');
			return;
		}
		savingPassword = true;
		try {
			const res = await fetch('/api/auth/profile', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ currentPassword, newPassword })
			});
			const result = await res.json();
			if (!res.ok) {
				toast.error(result.error || 'Não foi possível alterar a senha.');
				return;
			}
			toast.success('Senha alterada com sucesso!');
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
		} finally {
			savingPassword = false;
		}
	}

	async function start2faSetup() {
		totpBusy = true;
		try {
			const res = await fetch('/api/auth/2fa');
			const result = await res.json();
			if (!res.ok) {
				toast.error(result.error || 'Erro ao gerar chave 2FA.');
				return;
			}
			totpSetup = { secret: result.secret, qrDataUrl: result.qrDataUrl };
			totpCode = '';
		} finally {
			totpBusy = false;
		}
	}

	async function confirm2fa(e: SubmitEvent) {
		e.preventDefault();
		totpBusy = true;
		try {
			const res = await fetch('/api/auth/2fa', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code: totpCode })
			});
			const result = await res.json();
			if (!res.ok) {
				toast.error(result.error || 'Código 2FA inválido.');
				return;
			}
			totpSetup = null;
			totpCode = '';
			toast.success('Autenticação em 2 Etapas (2FA) ativada!');
			await invalidateAll();
		} finally {
			totpBusy = false;
		}
	}

	async function disable2fa(e: SubmitEvent) {
		e.preventDefault();
		totpBusy = true;
		try {
			const res = await fetch('/api/auth/2fa', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password: totpDisablePass })
			});
			const result = await res.json();
			if (!res.ok) {
				toast.error(result.error || 'Senha incorreta.');
				return;
			}
			totpDisablePass = '';
			toast.info('2FA desativado.');
			await invalidateAll();
		} finally {
			totpBusy = false;
		}
	}
</script>

<svelte:head>
	<title>Configurações — Lizzart Explorer</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
	<div class="mb-5">
		<h1 class="text-2xl font-bold text-white">Configurações</h1>
		<p class="mt-1 text-sm text-slate-400">
			Gerencie os dados da sua conta, segurança 2FA e aparência do sistema.
		</p>
	</div>

	<!-- Settings Tabs -->
	<div class="mb-6 flex gap-2 border-b border-[#1a253a]">
		<button
			type="button"
			onclick={() => (activeTab = 'account')}
			class="inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition {activeTab === 'account'
				? 'border-accent-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<User class="h-4 w-4 {activeTab === 'account' ? 'text-accent-400' : ''}" />
			Conta
		</button>
		<button
			type="button"
			onclick={() => (activeTab = 'appearance')}
			class="inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition {activeTab === 'appearance'
				? 'border-accent-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<Palette class="h-4 w-4 {activeTab === 'appearance' ? 'text-accent-400' : ''}" />
			Aparência
		</button>
	</div>

	<input
		bind:this={avatarInputEl}
		type="file"
		accept="image/png,image/jpeg,image/webp,image/gif"
		class="hidden"
		onchange={handleAvatarUpload}
	/>

	{#if activeTab === 'account'}
		<!-- Account Summary Banner -->
		<div class="mb-6 flex flex-col gap-4 rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 sm:flex-row sm:items-center sm:justify-between">
			<div class="flex items-center gap-4">
				<div class="relative shrink-0">
					{#if data.user.avatar_url}
						<img
							src={data.user.avatar_url}
							alt={data.user.full_name}
							class="h-16 w-16 rounded-2xl object-cover shadow-lg ring-2 ring-accent-500/40"
						/>
					{:else}
						<div
							class="flex h-16 w-16 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-lg"
							style="background-color: {avatarColor}"
						>
							{getInitials(`${firstName} ${lastName}` || data.user.full_name)}
						</div>
					{/if}
					<button
						type="button"
						disabled={uploadingAvatar}
						onclick={() => avatarInputEl?.click()}
						class="absolute -right-1.5 -bottom-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-accent-600 text-white shadow hover:bg-accent-500"
						title="Alterar foto de perfil"
					>
						<Camera class="h-3.5 w-3.5" />
					</button>
				</div>

				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-2">
						<h2 class="truncate text-lg font-semibold text-white">{data.user.full_name}</h2>
						<span class="rounded-full bg-accent-500/15 px-2.5 py-0.5 font-mono text-xs font-semibold text-accent-300">
							@{data.user.username}
						</span>
						<span class="inline-flex items-center gap-1 rounded-full bg-slate-700/50 px-2.5 py-0.5 text-[11px] font-medium text-slate-200">
							<ShieldCheck class="h-3 w-3 text-accent-400" />
							{data.user.role === 'admin' ? 'Administrador' : 'Usuário'}
						</span>
					</div>
					<div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
						<span>Membro desde {formatDate(data.user.created_at)}</span>
						{#if data.user.avatar_url}
							<button
								type="button"
								onclick={removeAvatar}
								class="inline-flex items-center gap-1 text-rose-400 hover:underline"
							>
								<Trash2 class="h-3 w-3" /> Remover foto
							</button>
						{/if}
					</div>
				</div>
			</div>

			<div class="rounded-xl border border-[#233047] bg-[#0b101b] px-4 py-2.5 sm:text-right">
				<p class="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500 sm:justify-end">
					<HardDrive class="h-3.5 w-3.5 text-accent-400" />
					Cota Utilizada
				</p>
				<p class="mt-0.5 font-mono text-sm font-semibold text-white">
					{formatBytes(data.user.used_bytes)}
					<span class="text-slate-500">/ {formatBytes(data.user.quota_bytes)}</span>
				</p>
			</div>
		</div>

		<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
			<!-- Personal Data -->
			<form onsubmit={saveAccount} class="space-y-4 rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 sm:p-6">
				<div class="flex items-center gap-2 border-b border-[#1f2d45] pb-3">
					<User class="h-4 w-4 text-accent-400" />
					<h3 class="text-sm font-semibold text-white">Dados da Conta</h3>
				</div>

				<div>
					<span class="mb-1 block text-xs text-slate-400">Usuário (imutável)</span>
					<input
						type="text"
						disabled
						value="@{data.user.username}"
						class="w-full cursor-not-allowed rounded-xl border border-[#1f2d45] bg-[#0b101b]/60 px-3.5 py-2.5 font-mono text-sm text-slate-400"
					/>
				</div>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div>
						<label for="pfn" class="mb-1 block text-xs text-slate-400">Nome</label>
						<input
							id="pfn"
							type="text"
							required
							minlength={2}
							bind:value={firstName}
							class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 text-sm text-white outline-none focus:border-accent-500"
						/>
					</div>
					<div>
						<label for="pln" class="mb-1 block text-xs text-slate-400">Sobrenome</label>
						<input
							id="pln"
							type="text"
							required
							minlength={2}
							bind:value={lastName}
							class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 text-sm text-white outline-none focus:border-accent-500"
						/>
					</div>
				</div>

				<div>
					<span class="mb-2 block text-xs text-slate-400">Foto de Perfil</span>
					<div class="flex flex-wrap items-center gap-2">
						<button
							type="button"
							disabled={uploadingAvatar}
							onclick={() => avatarInputEl?.click()}
							class="inline-flex items-center gap-1.5 rounded-xl border border-[#233047] bg-[#0e1525] px-3.5 py-2 text-xs font-medium text-slate-200 hover:border-accent-500/40 hover:bg-[#19253c]"
						>
							<Camera class="h-3.5 w-3.5 text-accent-400" />
							{uploadingAvatar ? 'Enviando...' : 'Enviar Nova Imagem'}
						</button>
						{#if data.user.avatar_url}
							<button
								type="button"
								onclick={removeAvatar}
								class="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
							>
								<Trash2 class="h-3.5 w-3.5" /> Remover
							</button>
						{/if}
					</div>
				</div>

				<button
					type="submit"
					disabled={savingAccount}
					class="inline-flex items-center gap-2 rounded-xl bg-accent-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
				>
					<Save class="h-4 w-4" />
					{savingAccount ? 'Salvando...' : 'Salvar Dados da Conta'}
				</button>
			</form>

			<!-- Password & Local 2FA -->
			<div class="space-y-6">
				<!-- Change Password -->
				<form onsubmit={changePassword} class="space-y-4 rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 sm:p-6">
					<div class="flex items-center gap-2 border-b border-[#1f2d45] pb-3">
						<Lock class="h-4 w-4 text-accent-400" />
						<h3 class="text-sm font-semibold text-white">Alterar Senha</h3>
					</div>

					<div>
						<label for="cpw" class="mb-1 block text-xs text-slate-400">Senha atual</label>
						<input id="cpw" type="password" required bind:value={currentPassword} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-accent-500" />
					</div>
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<div>
							<label for="npw" class="mb-1 block text-xs text-slate-400">Nova senha</label>
							<input id="npw" type="password" required minlength={6} bind:value={newPassword} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-accent-500" />
						</div>
						<div>
							<label for="rpw" class="mb-1 block text-xs text-slate-400">Confirmar senha</label>
							<input id="rpw" type="password" required minlength={6} bind:value={confirmPassword} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-accent-500" />
						</div>
					</div>

					<button
						type="submit"
						disabled={savingPassword}
						class="inline-flex items-center gap-2 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
					>
						<Lock class="h-3.5 w-3.5" />
						{savingPassword ? 'Atualizando...' : 'Atualizar Senha'}
					</button>
				</form>

				<!-- Local 2FA TOTP -->
				<div class="space-y-4 rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 sm:p-6">
					<div class="flex items-center justify-between border-b border-[#1f2d45] pb-3">
						<div class="flex items-center gap-2">
							<Smartphone class="h-4 w-4 text-accent-400" />
							<h3 class="text-sm font-semibold text-white">Autenticação em 2 Etapas (2FA Local)</h3>
						</div>
						<span
							class="rounded-full px-2.5 py-0.5 text-[11px] font-semibold {data.user.totp_enabled
								? 'bg-accent-500/20 text-accent-300'
								: 'bg-slate-700/50 text-slate-400'}"
						>
							{data.user.totp_enabled ? 'Ativo' : 'Desativado'}
						</span>
					</div>

					{#if data.user.totp_enabled}
						<p class="text-xs text-slate-300">
							Sua conta está protegida com TOTP local (compatível com Google Authenticator, Authy, Aegis e 1Password).
						</p>
						<form onsubmit={disable2fa} class="flex flex-col gap-2 sm:flex-row">
							<input
								type="password"
								required
								bind:value={totpDisablePass}
								placeholder="Digite sua senha para desativar..."
								class="min-w-0 flex-1 rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-xs text-white outline-none focus:border-rose-500"
							/>
							<button
								type="submit"
								disabled={totpBusy}
								class="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
							>
								Desativar 2FA
							</button>
						</form>
					{:else if totpSetup}
						<div class="space-y-4">
							<div class="flex flex-col items-center gap-3 rounded-xl border border-[#233047] bg-[#0b101b] p-4 text-center">
								<img src={totpSetup.qrDataUrl} alt="QR Code 2FA" class="h-44 w-44 rounded-lg bg-white p-1.5" />
								<div class="flex items-center gap-2">
									<code class="select-text rounded bg-[#131c2e] px-2.5 py-1 font-mono text-xs text-accent-300">
										{totpSetup.secret}
									</code>
									<button
										type="button"
										onclick={() => {
											navigator.clipboard.writeText(totpSetup!.secret);
											toast.success('Chave copiada!');
										}}
										class="rounded-lg bg-[#19253c] p-1.5 text-slate-300 hover:text-white"
										title="Copiar chave secreta"
									>
										<Copy class="h-3.5 w-3.5" />
									</button>
								</div>
								<p class="text-[11px] text-slate-400">
									Escaneie o QR Code no seu app autenticador e digite o código de 6 dígitos abaixo.
								</p>
							</div>

							<form onsubmit={confirm2fa} class="flex flex-wrap gap-2">
								<input
									type="text"
									inputmode="numeric"
									maxlength={6}
									required
									bind:value={totpCode}
									placeholder="000000"
									class="w-36 rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-center font-mono text-base tracking-widest text-white outline-none focus:border-accent-500"
								/>
								<button
									type="submit"
									disabled={totpBusy}
									class="flex-1 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
								>
									Confirmar e Ativar
								</button>
								<button
									type="button"
									onclick={() => (totpSetup = null)}
									class="rounded-xl border border-[#233047] px-3 py-2 text-xs text-slate-400 hover:text-white"
								>
									Cancelar
								</button>
							</form>
						</div>
					{:else}
						<p class="text-xs text-slate-400">
							Proteja sua conta com verificação em 2 etapas TOTP gerada 100% localmente.
						</p>
						<button
							type="button"
							disabled={totpBusy}
							onclick={start2faSetup}
							class="inline-flex items-center gap-2 rounded-xl border border-accent-500/40 bg-accent-500/15 px-4 py-2 text-xs font-semibold text-accent-300 hover:bg-accent-500/25"
						>
							<KeyRound class="h-4 w-4" />
							Configurar 2FA Local
						</button>
					{/if}
				</div>
			</div>
		</div>

		<!-- Active JWT & Refresh Sessions -->
		<div class="mt-6 rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 sm:p-6">
			<div class="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#1f2d45] pb-3.5">
				<div class="flex items-center gap-2">
					<MonitorSmartphone class="h-4 w-4 text-accent-400" />
					<div>
						<h3 class="text-sm font-semibold text-white">Sessões Ativas (JWT + Refresh Rotation)</h3>
						<p class="text-xs text-slate-400">
							Tokens JWT HS256 (15 min) com rotação de refresh token em hash SHA-256 no MariaDB.
						</p>
					</div>
				</div>
				{#if activeSessions.filter((s) => !s.is_current).length > 0}
					<button
						type="button"
						onclick={revokeOtherSessions}
						class="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
					>
						<LogOut class="h-3.5 w-3.5" />
						Encerrar outros dispositivos
					</button>
				{/if}
			</div>

			{#if loadingSessions}
				<p class="py-4 text-center text-xs text-slate-400">Carregando sessões...</p>
			{:else if activeSessions.length === 0}
				<p class="py-4 text-center text-xs text-slate-500">Nenhuma sessão ativa encontrada.</p>
			{:else}
				<div class="space-y-2.5">
					{#each activeSessions as sess (sess.id)}
						<div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#1f2d45] bg-[#0e1525] px-4 py-3 text-xs">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-mono font-semibold text-slate-200">{sess.ip_address}</span>
									{#if sess.is_current}
										<span class="rounded-full bg-accent-500/20 px-2 py-0.5 text-[10px] font-semibold text-accent-300">
											Dispositivo atual
										</span>
									{/if}
								</div>
								<p class="mt-0.5 truncate text-[11px] text-slate-400" title={sess.user_agent}>
									{sess.user_agent}
								</p>
								<p class="mt-0.5 text-[10px] text-slate-500">
									Iniciada em {formatDate(sess.created_at)} • Última atividade: {formatDate(sess.last_used_at)}
								</p>
							</div>
							{#if !sess.is_current}
								<button
									type="button"
									onclick={() => revokeSession(sess.id)}
									class="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] font-medium text-rose-300 hover:bg-rose-500/20"
								>
									Revogar
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<!-- APPEARANCE TAB -->
		<form onsubmit={saveAppearance} class="space-y-6">
			<!-- Accent Color Card -->
			<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 sm:p-6">
				<div class="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#1f2d45] pb-3.5">
					<div class="flex items-center gap-2">
						<Palette class="h-4 w-4 text-accent-400" />
						<div>
							<h3 class="text-sm font-semibold text-white">Cor Principal da Aplicação</h3>
							<p class="text-xs text-slate-400">
								Aplica-se a botões, caixas ativas, seleções, barras e destaques (o fundo escuro permanece fixo).
							</p>
						</div>
					</div>
					<label class="flex items-center gap-2 rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-1.5 text-xs text-slate-300">
						<span>Personalizada</span>
						<input
							type="color"
							value={accentColor}
							oninput={(e) => {
								accentColor = e.currentTarget.value;
								themeStore.setAccent(accentColor);
							}}
							class="h-6 w-8 cursor-pointer rounded border-0 bg-transparent"
						/>
					</label>
				</div>

				<div class="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
					{#each ACCENT_PRESETS as preset (preset.hex)}
						{@const isSelected = accentColor.toLowerCase() === preset.hex.toLowerCase()}
						<button
							type="button"
							onclick={() => {
								accentColor = preset.hex;
								themeStore.setAccent(preset.hex);
							}}
							class="flex items-center gap-2.5 rounded-xl border p-2.5 text-left text-xs transition {isSelected
								? 'border-accent-400 bg-accent-500/15 text-white'
								: 'border-[#1f2d45] bg-[#0e1525] text-slate-300 hover:border-[#2e4060]'}"
						>
							<span
								class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white shadow"
								style="background-color: {preset.hex}"
							>
								{#if isSelected}
									<Check class="h-3.5 w-3.5" />
								{/if}
							</span>
							<span class="truncate font-medium">{preset.name}</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- Layout Density Card -->
			<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 sm:p-6">
				<div class="mb-4 border-b border-[#1f2d45] pb-3.5">
					<h3 class="text-sm font-semibold text-white">Densidade do Layout</h3>
					<p class="text-xs text-slate-400">
						Escolha o tamanho dos elementos da interface de acordo com o seu monitor ou celular.
					</p>
				</div>

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<button
						type="button"
						onclick={() => {
							layoutDensity = 'normal';
							themeStore.setDensity('normal');
						}}
						class="flex flex-col items-start gap-3 rounded-2xl border p-5 text-left transition {layoutDensity === 'normal'
							? 'border-accent-400 bg-accent-500/10 ring-1 ring-accent-500/30'
							: 'border-[#1f2d45] bg-[#0e1525] hover:border-[#2e4060]'}"
					>
						<div class="flex w-full items-center justify-between">
							<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400">
								<LayoutGrid class="h-5 w-5" />
							</div>
							{#if layoutDensity === 'normal'}
								<span class="rounded-full bg-accent-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
									Selecionado
								</span>
							{/if}
						</div>
						<div>
							<p class="text-sm font-bold text-white">Normal</p>
							<p class="mt-1 text-xs text-slate-400">
								Tamanho padrão espaçoso e confortável para telas médias e grandes.
							</p>
						</div>
					</button>

					<button
						type="button"
						onclick={() => {
							layoutDensity = 'compact';
							themeStore.setDensity('compact');
						}}
						class="flex flex-col items-start gap-3 rounded-2xl border p-5 text-left transition {layoutDensity === 'compact'
							? 'border-accent-400 bg-accent-500/10 ring-1 ring-accent-500/30'
							: 'border-[#1f2d45] bg-[#0e1525] hover:border-[#2e4060]'}"
					>
						<div class="flex w-full items-center justify-between">
							<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400">
								<Minimize2 class="h-5 w-5" />
							</div>
							{#if layoutDensity === 'compact'}
								<span class="rounded-full bg-accent-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
									Selecionado
								</span>
							{/if}
						</div>
						<div>
							<p class="text-sm font-bold text-white">Compacto</p>
							<p class="mt-1 text-xs text-slate-400">
								Reduz proporcionalmente cards, fontes e espaçamentos para exibir mais arquivos em telas menores.
							</p>
						</div>
					</button>
				</div>
			</div>

			<!-- Explorer Default Preferences (synced across devices) -->
			<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 sm:p-6">
				<div class="mb-4 border-b border-[#1f2d45] pb-3.5">
					<h3 class="text-sm font-semibold text-white">Preferências do Explorador (Sincronizadas na Conta)</h3>
					<p class="text-xs text-slate-400">
						Todas as escolhas de aparência, cor, densidade e visualização ficam salvas no seu perfil para você ter a mesma interface em qualquer dispositivo.
					</p>
				</div>

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
					<div>
						<span class="mb-1.5 block text-xs text-slate-400">Visualização Padrão</span>
						<div class="grid grid-cols-2 gap-2">
							<button
								type="button"
								onclick={() => (defaultViewMode = 'grid')}
								class="flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-medium transition {defaultViewMode === 'grid'
									? 'border-accent-400 bg-accent-500/15 text-white'
									: 'border-[#233047] bg-[#0b101b] text-slate-400 hover:text-slate-200'}"
							>
								<LayoutGrid class="h-3.5 w-3.5" /> Grade
							</button>
							<button
								type="button"
								onclick={() => (defaultViewMode = 'list')}
								class="flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-medium transition {defaultViewMode === 'list'
									? 'border-accent-400 bg-accent-500/15 text-white'
									: 'border-[#233047] bg-[#0b101b] text-slate-400 hover:text-slate-200'}"
							>
								<List class="h-3.5 w-3.5" /> Lista
							</button>
						</div>
					</div>
					<div>
						<label for="dsort" class="mb-1.5 block text-xs text-slate-400">Ordenar por</label>
						<select
							id="dsort"
							bind:value={defaultSortBy}
							class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-xs text-white outline-none focus:border-accent-500"
						>
							<option value="name">Nome</option>
							<option value="date">Data de modificação</option>
							<option value="size">Tamanho</option>
						</select>
					</div>
					<div>
						<label for="ddir" class="mb-1.5 block text-xs text-slate-400">Direção</label>
						<select
							id="ddir"
							bind:value={defaultSortDir}
							class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-xs text-white outline-none focus:border-accent-500"
						>
							<option value="asc">Crescente (A→Z / Menor)</option>
							<option value="desc">Decrescente (Z→A / Mais recente)</option>
						</select>
					</div>
				</div>
			</div>

			<div class="flex justify-end">
				<button
					type="submit"
					disabled={savingAppearance}
					class="inline-flex items-center gap-2 rounded-xl bg-accent-600 px-6 py-2.5 text-xs font-semibold text-white shadow-lg shadow-accent-600/20 hover:bg-accent-500 disabled:opacity-50"
				>
					<Save class="h-4 w-4" />
					{savingAppearance ? 'Salvando...' : 'Salvar Aparência'}
				</button>
			</div>
		</form>
	{/if}
</div>
