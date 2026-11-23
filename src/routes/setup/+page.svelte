<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { toast } from '$lib/stores/toast.svelte';
	import { i18n, SUPPORTED_COUNTRIES, SUPPORTED_LANGUAGES } from '$lib/stores/i18n.svelte';
	import type { AppLanguage } from '$lib/types';
	import { HardDrive, ShieldCheck, User, Lock, ArrowRight, Sparkles, Globe } from 'lucide-svelte';

	let username = $state('');
	let firstName = $state('');
	let lastName = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let loading = $state(false);
	let errorMsg = $state('');

	async function handleSetup(e: SubmitEvent) {
		e.preventDefault();
		errorMsg = '';

		if (password !== confirmPassword) {
			errorMsg = i18n.t('setup.password_mismatch');
			return;
		}

		loading = true;
		try {
			const res = await fetch('/api/auth/setup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					username,
					first_name: firstName,
					last_name: lastName,
					password,
					language: i18n.language,
					country: i18n.country
				})
			});
			const data = await res.json();
			if (!res.ok) {
				errorMsg = data.error || 'Failed to create administrator account.';
				return;
			}
			toast.success(`Admin @${data.username} configured!`);
			await invalidateAll();
			await goto('/');
		} catch {
			errorMsg = 'Connection error with the server.';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{i18n.t('setup.title')} — Lizzart Explorer</title>
</svelte:head>

<div class="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#0b101b] px-4 py-10">
	<div class="pointer-events-none absolute -top-40 left-1/2 h-96 w-full max-w-[42rem] -translate-x-1/2 rounded-full bg-accent-500/15 blur-3xl"></div>

	<div class="relative w-full max-w-lg">
		<div class="mb-8 flex flex-col items-center text-center">
			<div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-accent-700 shadow-lg shadow-accent-500/25">
				<HardDrive class="h-7 w-7 text-white" />
			</div>
			<span class="mb-2 inline-flex items-center gap-1.5 rounded-full border border-accent-500/30 bg-accent-500/10 px-3 py-1 text-xs font-semibold text-accent-300">
				<Sparkles class="h-3.5 w-3.5" /> {i18n.t('setup.badge')}
			</span>
			<h1 class="text-2xl font-bold tracking-tight text-white">{i18n.t('setup.title')}</h1>
			<p class="mt-1.5 max-w-md text-sm text-slate-400">
				{i18n.t('setup.subtitle')}
			</p>
		</div>

		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e]/95 p-5 shadow-2xl sm:p-7">
			{#if errorMsg}
				<div class="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
					{errorMsg}
				</div>
			{/if}

			<form onsubmit={handleSetup} class="space-y-4">
				<!-- Base Application Language & Country -->
				<div class="rounded-xl border border-[#233047] bg-[#0e1525] p-3.5">
					<div class="mb-2.5 flex items-center gap-2 text-xs font-semibold text-accent-300">
						<Globe class="h-4 w-4 text-accent-400" />
						<span>{i18n.t('setup.language')} & {i18n.t('setup.country')}</span>
					</div>
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<div>
							<label for="s-lang" class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
								{i18n.t('setup.language')}
							</label>
							<select
								id="s-lang"
								value={i18n.language}
								onchange={(e) => i18n.setLocale(e.currentTarget.value as AppLanguage, i18n.country)}
								class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
							>
								{#each SUPPORTED_LANGUAGES as lang (lang.code)}
									<option value={lang.code}>{lang.nativeName} ({lang.name})</option>
								{/each}
							</select>
						</div>
						<div>
							<label for="s-country" class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
								{i18n.t('setup.country')}
							</label>
							<select
								id="s-country"
								value={i18n.country}
								onchange={(e) => i18n.setLocale(i18n.language, e.currentTarget.value)}
								class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500"
							>
								{#each SUPPORTED_COUNTRIES as c (c.code)}
									<option value={c.code}>{c.name[i18n.language] || c.name.en} ({c.code})</option>
								{/each}
							</select>
						</div>
					</div>
					<p class="mt-2 text-[11px] text-slate-400">
						{i18n.t('setup.locale_hint')}
					</p>
				</div>

				<div>
					<label for="s-user" class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
						{i18n.t('setup.username_label')}
					</label>
					<div class="relative">
						<span class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 font-mono text-sm text-accent-400">@</span>
						<input
							id="s-user"
							type="text"
							required
							minlength={3}
							maxlength={32}
							bind:value={username}
							placeholder="admin"
							class="w-full rounded-xl border border-[#233047] bg-[#0b101b] py-2.5 pr-4 pl-8 font-mono text-sm text-white placeholder-slate-500 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
						/>
					</div>
					<p class="mt-1 text-[11px] text-slate-500">
						{i18n.t('setup.username_hint')}
					</p>
				</div>

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label for="s-fn" class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
							{i18n.t('setup.first_name')}
						</label>
						<div class="relative">
							<User class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
							<input
								id="s-fn"
								type="text"
								required
								minlength={2}
								bind:value={firstName}
								placeholder="João"
								class="w-full rounded-xl border border-[#233047] bg-[#0b101b] py-2.5 pr-4 pl-10 text-sm text-white placeholder-slate-500 outline-none focus:border-accent-500"
							/>
						</div>
					</div>
					<div>
						<label for="s-ln" class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
							{i18n.t('setup.last_name')}
						</label>
						<input
							id="s-ln"
							type="text"
							required
							minlength={2}
							bind:value={lastName}
							placeholder="Vitor"
							class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-accent-500"
						/>
					</div>
				</div>

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label for="s-pw" class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
							{i18n.t('setup.password')}
						</label>
						<div class="relative">
							<Lock class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
							<input
								id="s-pw"
								type="password"
								required
								minlength={8}
								bind:value={password}
								placeholder={i18n.t('setup.password_placeholder')}
								class="w-full rounded-xl border border-[#233047] bg-[#0b101b] py-2.5 pr-4 pl-10 text-sm text-white placeholder-slate-500 outline-none focus:border-accent-500"
							/>
						</div>
					</div>
					<div>
						<label for="s-pw2" class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
							{i18n.t('setup.confirm_password')}
						</label>
						<input
							id="s-pw2"
							type="password"
							required
							minlength={8}
							bind:value={confirmPassword}
							placeholder={i18n.t('setup.confirm_placeholder')}
							class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-accent-500"
						/>
					</div>
				</div>

				<div class="flex items-center gap-2 rounded-xl border border-accent-500/20 bg-accent-500/10 px-3.5 py-2.5 text-xs text-accent-200">
					<ShieldCheck class="h-4 w-4 shrink-0 text-accent-400" />
					<span>{i18n.t('setup.info_banner')}</span>
				</div>

				<button
					type="submit"
					disabled={loading}
					class="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-accent-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-accent-600/25 transition hover:bg-accent-500 disabled:opacity-50"
				>
					<span>{loading ? i18n.t('setup.submitting') : i18n.t('setup.submit')}</span>
					<ArrowRight class="h-4 w-4" />
				</button>
			</form>
		</div>
	</div>
</div>
