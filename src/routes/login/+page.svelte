<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { toast } from '$lib/stores/toast.svelte';
	import { i18n } from '$lib/stores/i18n.svelte';
	import { HardDrive, Lock, ArrowRight, ShieldCheck, KeyRound } from 'lucide-svelte';

	let username = $state('');
	let password = $state('');
	let totpCode = $state('');
	let challengeToken = $state('');
	let requires2fa = $state(false);
	let loading = $state(false);
	let errorMsg = $state('');

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		errorMsg = '';
		loading = true;

		try {
			const payload =
				requires2fa && challengeToken
					? { challengeToken, totpCode }
					: { username, password, totpCode: requires2fa ? totpCode : undefined };

			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			const result = await res.json();
			if (result.requires2fa && !requires2fa) {
				requires2fa = true;
				challengeToken = result.challengeToken || '';
				password = ''; // Clear password from memory once Ed25519 2FA challenge is issued
				loading = false;
				return;
			}

			if (!res.ok) {
				errorMsg = result.error || 'Falha na autenticação.';
				return;
			}

			toast.success(`Bem-vindo, ${result.user.first_name}!`);
			await invalidateAll();
			await goto('/');
		} catch {
			errorMsg = 'Erro de conexão com o servidor.';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Entrar — Lizzart Explorer</title>
</svelte:head>

<div class="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#0b101b] px-4 py-10">
	<div class="pointer-events-none absolute -top-40 left-1/2 h-96 w-full max-w-[42rem] -translate-x-1/2 rounded-full bg-accent-500/15 blur-3xl"></div>

	<div class="relative w-full max-w-md">
		<div class="mb-6 flex flex-col items-center text-center sm:mb-8">
			<div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-accent-700 shadow-lg shadow-accent-500/25">
				<HardDrive class="h-7 w-7 text-white" />
			</div>
			<h1 class="text-2xl font-bold tracking-tight text-white">Lizzart Explorer</h1>
			<p class="mt-1 text-xs text-slate-400 sm:text-sm">
				{i18n.t('login.subtitle')}
			</p>
		</div>

		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e]/90 p-5 shadow-2xl sm:p-7">
			{#if errorMsg}
				<div class="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200 sm:text-sm">
					{errorMsg}
				</div>
			{/if}

			<form onsubmit={handleSubmit} class="space-y-4">
				{#if !requires2fa}
					<div>
						<label for="username" class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
							{i18n.t('login.username')}
						</label>
						<div class="relative">
							<span class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 font-mono text-sm text-accent-400">@</span>
							<input
								id="username"
								type="text"
								required
								autocomplete="username"
								bind:value={username}
								placeholder="username"
								class="w-full rounded-xl border border-[#233047] bg-[#0b101b] py-2.5 pr-4 pl-8 font-mono text-sm text-white placeholder-slate-500 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
							/>
						</div>
					</div>

					<div>
						<label for="password" class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
							{i18n.t('login.password')}
						</label>
						<div class="relative">
							<Lock class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
							<input
								id="password"
								type="password"
								required
								autocomplete="current-password"
								bind:value={password}
								placeholder="••••••••"
								class="w-full rounded-xl border border-[#233047] bg-[#0b101b] py-2.5 pr-4 pl-10 text-sm text-white placeholder-slate-500 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
							/>
						</div>
					</div>
				{:else}
					<div class="rounded-xl border border-accent-500/30 bg-accent-500/10 p-4 text-center">
						<KeyRound class="mx-auto mb-2 h-8 w-8 text-accent-400" />
						<h2 class="text-sm font-semibold text-white">{i18n.t('login.2fa_title')}</h2>
						<p class="mt-1 text-xs text-slate-300">
							{i18n.t('login.2fa_subtitle')} <strong class="font-mono">@{username}</strong>.
						</p>
					</div>

					<div>
						<label for="totp" class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
							{i18n.t('login.2fa_code')}
						</label>
						<input
							id="totp"
							type="text"
							inputmode="numeric"
							maxlength={6}
							required
							bind:value={totpCode}
							placeholder="000000"
							class="w-full rounded-xl border border-[#233047] bg-[#0b101b] py-3 text-center font-mono text-2xl tracking-[0.35em] text-white outline-none focus:border-accent-500"
						/>
					</div>

					<button
						type="button"
						onclick={() => {
							requires2fa = false;
							challengeToken = '';
							totpCode = '';
							errorMsg = '';
						}}
						class="text-xs text-slate-400 hover:text-white"
					>
						{i18n.t('login.back')}
					</button>
				{/if}

				<button
					type="submit"
					disabled={loading}
					class="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent-600/25 transition hover:bg-accent-500 disabled:opacity-50"
				>
					<span>{loading ? i18n.t('login.submitting') : requires2fa ? i18n.t('login.confirm_2fa') : i18n.t('login.submit')}</span>
					<ArrowRight class="h-4 w-4" />
				</button>
			</form>

			<div class="mt-6 flex items-center gap-2 rounded-xl border border-[#233047] bg-[#0b101b]/70 px-3.5 py-2.5 text-xs text-slate-400">
				<ShieldCheck class="h-4 w-4 shrink-0 text-accent-400" />
				<span>{i18n.t('login.security_footer')}</span>
			</div>
		</div>
	</div>
</div>
