<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { formatBytes, formatDate, getFileCategory, isPreviewable } from '$lib/utils';
	import FileIcon from '$lib/components/explorer/FileIcon.svelte';
	import { Download, HardDrive, Lock, ShieldAlert, Eye } from 'lucide-svelte';

	let token = $derived($page.params.token);

	interface PublicShare {
		token: string;
		name: string;
		mime_type: string;
		size_bytes: number;
		owner_name: string;
		has_password: boolean;
		expires_at: string | null;
		max_downloads: number | null;
		download_count: number;
	}

	let share = $state<PublicShare | null>(null);
	let loading = $state(true);
	let errorMsg = $state('');
	let password = $state('');
	let unlocked = $state(false);
	let verifying = $state(false);
	let passwordError = $state('');

	onMount(async () => {
		try {
			const res = await fetch(`/api/share/${token}`);
			const data = await res.json();
			if (!res.ok) {
				errorMsg = data.error || 'Link indisponível.';
			} else {
				share = data.share;
				if (!data.share.has_password) {
					unlocked = true;
				}
			}
		} catch {
			errorMsg = 'Falha ao carregar compartilhamento.';
		} finally {
			loading = false;
		}
	});

	async function unlock(e: SubmitEvent) {
		e.preventDefault();
		passwordError = '';
		verifying = true;
		try {
			const res = await fetch(`/api/share/${token}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password })
			});
			const data = await res.json();
			if (!res.ok) {
				passwordError = data.error || 'Senha incorreta.';
			} else {
				unlocked = true;
			}
		} finally {
			verifying = false;
		}
	}

	let downloadUrl = $derived(
		`/api/share/${token}/download${password ? `?password=${encodeURIComponent(password)}` : ''}`
	);
	let inlineUrl = $derived(
		`/api/share/${token}/download?inline=1${password ? `&password=${encodeURIComponent(password)}` : ''}`
	);
	let category = $derived(
		share ? getFileCategory('file', share.mime_type, share.name) : 'other'
	);
</script>

<svelte:head>
	<title>{share ? share.name : 'Arquivo Compartilhado'} — Lizzart Explorer</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center bg-[#0b101b] px-4 py-10">
	<a href="/" class="mb-6 flex items-center gap-2.5 text-slate-200 hover:text-white">
		<div class="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-600">
			<HardDrive class="h-5 w-5 text-white" />
		</div>
		<span class="text-lg font-bold tracking-tight">Lizzart Explorer</span>
	</a>

	<div class="w-full max-w-2xl rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-6 shadow-2xl">
		{#if loading}
			<div class="py-16 text-center text-sm text-slate-400">Carregando arquivo compartilhado...</div>
		{:else if errorMsg}
			<div class="flex flex-col items-center py-12 text-center">
				<ShieldAlert class="mb-3 h-12 w-12 text-rose-400" />
				<h2 class="text-lg font-semibold text-white">Link Indisponível</h2>
				<p class="mt-1 text-sm text-slate-400">{errorMsg}</p>
			</div>
		{:else if share}
			<div class="flex flex-wrap items-center justify-between gap-4 border-b border-[#1f2d45] pb-5">
				<div class="flex items-center gap-3.5">
					<div class="flex h-12 w-12 items-center justify-center rounded-xl bg-[#0b101b] border border-[#233047]">
						<FileIcon type="file" mime={share.mime_type} name={share.name} size="md" />
					</div>
					<div>
						<h1 class="text-base font-semibold text-white break-all">{share.name}</h1>
						<p class="text-xs text-slate-400">
							{formatBytes(share.size_bytes)} • Compartilhado por <span class="text-slate-200">{share.owner_name}</span>
						</p>
					</div>
				</div>

				{#if unlocked}
					<a
						href={downloadUrl}
						class="inline-flex items-center gap-2 rounded-xl bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent-600/20 transition hover:bg-accent-500"
					>
						<Download class="h-4 w-4" />
						Baixar Arquivo
					</a>
				{/if}
			</div>

			{#if !unlocked}
				<form onsubmit={unlock} class="mx-auto my-8 max-w-sm space-y-4">
					<div class="flex flex-col items-center text-center">
						<div class="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-400">
							<Lock class="h-6 w-6" />
						</div>
						<h2 class="text-base font-semibold text-white">Arquivo Protegido por Senha</h2>
						<p class="mt-1 text-xs text-slate-400">Digite a senha fornecida para visualizar ou baixar.</p>
					</div>
					{#if passwordError}
						<p class="rounded-lg bg-rose-500/10 px-3 py-2 text-center text-xs text-rose-300">{passwordError}</p>
					{/if}
					<input
						type="password"
						required
						bind:value={password}
						placeholder="Senha de acesso"
						class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-4 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
					/>
					<button
						type="submit"
						disabled={verifying}
						class="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
					>
						{verifying ? 'Verificando...' : 'Desbloquear Arquivo'}
					</button>
				</form>
			{:else}
				<div class="mt-5">
					{#if isPreviewable(share.mime_type, share.name)}
						<div class="overflow-hidden rounded-xl border border-[#233047] bg-[#0b101b]">
							{#if category === 'image'}
								<img src={inlineUrl} alt={share.name} class="mx-auto max-h-[480px] object-contain" />
							{:else if category === 'video'}
								<video src={inlineUrl} controls class="mx-auto max-h-[480px] w-full">
									<track kind="captions" />
								</video>
							{:else if category === 'audio'}
								<div class="p-8">
									<audio src={inlineUrl} controls class="w-full"></audio>
								</div>
							{:else if category === 'pdf'}
								<iframe src={inlineUrl} title={share.name} class="h-[520px] w-full"></iframe>
							{:else}
								<div class="flex flex-col items-center justify-center py-10 text-center text-sm text-slate-400">
									<Eye class="mb-2 h-8 w-8 text-indigo-400" />
									<p>Pré-visualização disponível ao abrir ou baixar o arquivo.</p>
									<a
										href={inlineUrl}
										target="_blank"
										class="mt-3 text-xs font-medium text-indigo-400 hover:underline"
									>
										Abrir conteúdo em nova aba →
									</a>
								</div>
							{/if}
						</div>
					{/if}

					<div class="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
						<span>Downloads: {share.download_count}{share.max_downloads ? ` / ${share.max_downloads}` : ''}</span>
						{#if share.expires_at}
							<span>Expira em: {formatDate(share.expires_at)}</span>
						{/if}
					</div>
				</div>
			{/if}
		{/if}
	</div>
</div>
