<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { toast } from '$lib/stores/toast.svelte';
	import { HardDrive, Lock, Mail, User, ArrowRight, ShieldCheck } from 'lucide-svelte';

	let { data } = $props();

	let mode = $state<'login' | 'register'>('login');
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let errorMsg = $state('');

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		errorMsg = '';
		loading = true;

		try {
			const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
			const payload =
				mode === 'login' ? { email, password } : { name, email, password };

			const res = await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			const result = await res.json();
			if (!res.ok) {
				errorMsg = result.error || 'Falha na autenticação.';
				return;
			}

			toast.success(
				mode === 'login'
					? `Bem-vindo de volta, ${result.user.name}!`
					: `Conta criada! Bem-vindo, ${result.user.name}!`
			);
			await invalidateAll();
			await goto('/');
		} catch {
			errorMsg = 'Erro de conexão com o servidor.';
		} finally {
			loading = false;
		}
	}

	function fillDemoAdmin() {
		mode = 'login';
		email = 'admin@lizzart.local';
		password = 'admin123';
	}
</script>

<svelte:head>
	<title>{mode === 'login' ? 'Entrar' : 'Criar Conta'} — Lizzart Explorer</title>
</svelte:head>

<div class="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b101b] px-4 py-12">
	<!-- Ambient glow -->
	<div class="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-indigo-600/15 blur-3xl"></div>
	<div class="pointer-events-none absolute -bottom-32 right-10 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl"></div>

	<div class="relative w-full max-w-md">
		<!-- Brand -->
		<div class="mb-8 flex flex-col items-center text-center">
			<div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/25">
				<HardDrive class="h-7 w-7 text-white" />
			</div>
			<h1 class="text-2xl font-bold tracking-tight text-white">Lizzart Explorer</h1>
			<p class="mt-1 text-sm text-slate-400">
				Armazenamento em nuvem privado & painel de servidores
			</p>
		</div>

		<!-- Card -->
		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e]/90 p-7 shadow-2xl backdrop-blur-xl">
			{#if data.allowRegistration}
				<div class="mb-6 grid grid-cols-2 rounded-xl bg-[#0b101b] p-1">
					<button
						type="button"
						onclick={() => {
							mode = 'login';
							errorMsg = '';
						}}
						class="rounded-lg py-2 text-sm font-medium transition-all {mode === 'login'
							? 'bg-indigo-600 text-white shadow'
							: 'text-slate-400 hover:text-slate-200'}"
					>
						Entrar
					</button>
					<button
						type="button"
						onclick={() => {
							mode = 'register';
							errorMsg = '';
						}}
						class="rounded-lg py-2 text-sm font-medium transition-all {mode === 'register'
							? 'bg-indigo-600 text-white shadow'
							: 'text-slate-400 hover:text-slate-200'}"
					>
						Criar conta
					</button>
				</div>
			{/if}

			{#if errorMsg}
				<div class="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
					{errorMsg}
				</div>
			{/if}

			<form onsubmit={handleSubmit} class="space-y-4">
				{#if mode === 'register'}
					<div>
						<label for="name" class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
							Nome completo
						</label>
						<div class="relative">
							<User class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
							<input
								id="name"
								type="text"
								required
								bind:value={name}
								placeholder="Seu nome"
								class="w-full rounded-xl border border-[#233047] bg-[#0b101b] py-2.5 pr-4 pl-10 text-sm text-white placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
							/>
						</div>
					</div>
				{/if}

				<div>
					<label for="email" class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
						E-mail
					</label>
					<div class="relative">
						<Mail class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
						<input
							id="email"
							type="email"
							required
							bind:value={email}
							placeholder="voce@exemplo.com"
							class="w-full rounded-xl border border-[#233047] bg-[#0b101b] py-2.5 pr-4 pl-10 text-sm text-white placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
						/>
					</div>
				</div>

				<div>
					<label for="password" class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
						Senha
					</label>
					<div class="relative">
						<Lock class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
						<input
							id="password"
							type="password"
							required
							minlength={6}
							bind:value={password}
							placeholder="••••••••"
							class="w-full rounded-xl border border-[#233047] bg-[#0b101b] py-2.5 pr-4 pl-10 text-sm text-white placeholder-slate-500 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
						/>
					</div>
				</div>

				<button
					type="submit"
					disabled={loading}
					class="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-500 disabled:opacity-50"
				>
					<span>{loading ? 'Processando...' : mode === 'login' ? 'Acessar Nuvem' : 'Criar minha conta'}</span>
					<ArrowRight class="h-4 w-4" />
				</button>
			</form>

			<!-- Helpful default admin hint for local setup -->
			<div class="mt-6 rounded-xl border border-[#233047] bg-[#0b101b]/70 p-3.5">
				<div class="flex items-center justify-between gap-2">
					<div class="flex items-center gap-2 text-xs text-slate-400">
						<ShieldCheck class="h-4 w-4 text-emerald-400" />
						<span>Admin padrão: <code class="font-mono text-slate-200">admin@lizzart.local</code></span>
					</div>
					<button
						type="button"
						onclick={fillDemoAdmin}
						class="rounded-lg bg-[#192438] px-2.5 py-1 text-xs font-medium text-indigo-300 transition hover:bg-indigo-600/20 hover:text-indigo-200"
					>
						Preencher
					</button>
				</div>
			</div>
		</div>
	</div>
</div>
