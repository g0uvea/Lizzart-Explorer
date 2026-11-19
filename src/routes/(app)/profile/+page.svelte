<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatBytes, formatDate, getInitials } from '$lib/utils';
	import { User, Lock, Save, ShieldCheck, HardDrive } from 'lucide-svelte';

	let { data } = $props();

	let name = $state('');
	let avatarColor = $state('#6366f1');
	let savingProfile = $state(false);

	$effect(() => {
		name = data.user.name;
		avatarColor = data.user.avatar_color;
	});

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let savingPassword = $state(false);

	const COLORS = ['#6366f1', '#10b981', '#0ea5e9', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6'];

	async function saveProfile(e: SubmitEvent) {
		e.preventDefault();
		savingProfile = true;
		try {
			const res = await fetch('/api/auth/profile', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, avatar_color: avatarColor })
			});
			const result = await res.json();
			if (!res.ok) {
				toast.error(result.error || 'Erro ao atualizar perfil.');
				return;
			}
			toast.success('Perfil atualizado!');
			await invalidateAll();
		} finally {
			savingProfile = false;
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
</script>

<svelte:head>
	<title>Meu Perfil — Lizzart Explorer</title>
</svelte:head>

<div class="mx-auto max-w-4xl p-6 lg:p-8">
	<div class="mb-6">
		<h1 class="text-2xl font-bold text-white">Meu Perfil</h1>
		<p class="mt-1 text-sm text-slate-400">Gerencie seus dados pessoais, segurança e cota de armazenamento.</p>
	</div>

	<!-- Account summary banner -->
	<div class="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5">
		<div class="flex items-center gap-4">
			<div
				class="flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-lg"
				style="background-color: {avatarColor}"
			>
				{getInitials(name || data.user.name)}
			</div>
			<div>
				<div class="flex items-center gap-2">
					<h2 class="text-lg font-semibold text-white">{data.user.name}</h2>
					<span
						class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold {data.user.role === 'admin'
							? 'bg-indigo-500/20 text-indigo-300'
							: 'bg-slate-700/50 text-slate-300'}"
					>
						<ShieldCheck class="h-3 w-3" />
						{data.user.role === 'admin' ? 'Administrador' : 'Usuário'}
					</span>
				</div>
				<p class="text-xs text-slate-400">{data.user.email} • Membro desde {formatDate(data.user.created_at)}</p>
			</div>
		</div>
		<div class="rounded-xl border border-[#233047] bg-[#0b101b] px-4 py-2.5 text-right">
			<p class="flex items-center justify-end gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
				<HardDrive class="h-3.5 w-3.5 text-indigo-400" />
				Cota Utilizada
			</p>
			<p class="mt-0.5 font-mono text-sm font-semibold text-white">
				{formatBytes(data.user.used_bytes)} <span class="text-slate-500">/ {formatBytes(data.user.quota_bytes)}</span>
			</p>
		</div>
	</div>

	<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
		<!-- Profile Info -->
		<form onsubmit={saveProfile} class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-6 space-y-4">
			<div class="flex items-center gap-2 border-b border-[#1f2d45] pb-3">
				<User class="h-4 w-4 text-indigo-400" />
				<h3 class="text-sm font-semibold text-white">Informações da Conta</h3>
			</div>

			<div>
				<label for="pname" class="mb-1.5 block text-xs font-medium text-slate-400">Nome de exibição</label>
				<input
					id="pname"
					type="text"
					required
					bind:value={name}
					class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
				/>
			</div>

			<div>
				<span class="mb-2 block text-xs font-medium text-slate-400">Cor do Avatar</span>
				<div class="flex flex-wrap gap-2">
					{#each COLORS as c (c)}
						<button
							type="button"
							onclick={() => (avatarColor = c)}
							class="h-8 w-8 rounded-full transition {avatarColor === c
								? 'ring-2 ring-white ring-offset-2 ring-offset-[#131c2e]'
								: 'opacity-70 hover:opacity-100'}"
							style="background-color: {c}"
							aria-label="Cor {c}"
						></button>
					{/each}
				</div>
			</div>

			<button
				type="submit"
				disabled={savingProfile}
				class="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
			>
				<Save class="h-4 w-4" />
				{savingProfile ? 'Salvando...' : 'Salvar Alterações'}
			</button>
		</form>

		<!-- Password Change -->
		<form onsubmit={changePassword} class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-6 space-y-4">
			<div class="flex items-center gap-2 border-b border-[#1f2d45] pb-3">
				<Lock class="h-4 w-4 text-emerald-400" />
				<h3 class="text-sm font-semibold text-white">Alterar Senha</h3>
			</div>

			<div>
				<label for="cpw" class="mb-1.5 block text-xs font-medium text-slate-400">Senha atual</label>
				<input
					id="cpw"
					type="password"
					required
					bind:value={currentPassword}
					class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
				/>
			</div>

			<div>
				<label for="npw" class="mb-1.5 block text-xs font-medium text-slate-400">Nova senha</label>
				<input
					id="npw"
					type="password"
					required
					minlength={6}
					bind:value={newPassword}
					class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
				/>
			</div>

			<div>
				<label for="rpw" class="mb-1.5 block text-xs font-medium text-slate-400">Confirmar nova senha</label>
				<input
					id="rpw"
					type="password"
					required
					minlength={6}
					bind:value={confirmPassword}
					class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
				/>
			</div>

			<button
				type="submit"
				disabled={savingPassword}
				class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
			>
				<Lock class="h-4 w-4" />
				{savingPassword ? 'Atualizando...' : 'Atualizar Senha'}
			</button>
		</form>
	</div>
</div>
