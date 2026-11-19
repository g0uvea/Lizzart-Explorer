<script lang="ts">
	import { onMount } from 'svelte';
	import type { NodePermissionRecord, ShareLinkRecord, StorageNode } from '$lib/types';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatDate, getInitials } from '$lib/utils';
	import { X, Users, Link2, Trash2, Copy, Lock, Plus } from 'lucide-svelte';

	interface Props {
		node: StorageNode;
		onClose: () => void;
		onUpdated: () => void;
	}

	let { node, onClose, onUpdated }: Props = $props();

	let tab = $state<'users' | 'links'>('users');
	let loading = $state(true);
	let permissions = $state<NodePermissionRecord[]>([]);
	let links = $state<ShareLinkRecord[]>([]);

	// User search autocomplete
	interface UserSuggestion {
		id: string;
		username: string;
		full_name: string;
		avatar_color: string;
		avatar_url: string | null;
	}
	let usernameInput = $state('');
	let suggestions = $state<UserSuggestion[]>([]);
	let userPerm = $state<'viewer' | 'editor'>('viewer');
	let addingUser = $state(false);

	// Link share form
	let linkPassword = $state('');
	let expiresInHours = $state(0);
	let maxDownloads = $state('');
	let creatingLink = $state(false);

	async function loadShares() {
		loading = true;
		try {
			const res = await fetch(`/api/files/${node.id}/share`);
			const data = await res.json();
			if (res.ok) {
				permissions = data.permissions;
				links = data.links;
			} else {
				toast.error(data.error || 'Erro ao carregar compartilhamentos');
			}
		} finally {
			loading = false;
		}
	}

	async function searchUsers(q: string) {
		const res = await fetch(`/api/users/search?q=${encodeURIComponent(q.replace(/^@/, ''))}`);
		if (res.ok) {
			const data = await res.json();
			suggestions = data.users;
		}
	}

	onMount(async () => {
		await Promise.all([loadShares(), searchUsers('')]);
	});

	async function grantUser(e: SubmitEvent) {
		e.preventDefault();
		addingUser = true;
		try {
			const clean = usernameInput.trim().replace(/^@/, '');
			const res = await fetch(`/api/files/${node.id}/share`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mode: 'user', username: clean, permission: userPerm })
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error || 'Não foi possível compartilhar.');
				return;
			}
			toast.success(`Compartilhado com @${clean}!`);
			usernameInput = '';
			await loadShares();
			onUpdated();
		} finally {
			addingUser = false;
		}
	}

	async function revokePermission(permissionId: string) {
		const res = await fetch(`/api/files/${node.id}/share?permissionId=${permissionId}`, {
			method: 'DELETE'
		});
		if (res.ok) {
			toast.info('Acesso revogado.');
			await loadShares();
			onUpdated();
		}
	}

	async function createLink(e: SubmitEvent) {
		e.preventDefault();
		creatingLink = true;
		try {
			const res = await fetch(`/api/files/${node.id}/share`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mode: 'link',
					password: linkPassword || null,
					expiresInHours: Number(expiresInHours) || 0,
					maxDownloads: maxDownloads ? Number(maxDownloads) : null
				})
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error || 'Falha ao gerar link.');
				return;
			}
			linkPassword = '';
			expiresInHours = 0;
			maxDownloads = '';
			const fullUrl = `${window.location.origin}/s/${data.token}`;
			await navigator.clipboard.writeText(fullUrl).catch(() => {});
			toast.success('Link público criado e copiado!');
			await loadShares();
			onUpdated();
		} finally {
			creatingLink = false;
		}
	}

	async function revokeLink(linkId: string) {
		const res = await fetch(`/api/files/${node.id}/share?linkId=${linkId}`, {
			method: 'DELETE'
		});
		if (res.ok) {
			toast.info('Link público revogado.');
			await loadShares();
			onUpdated();
		}
	}

	async function copyLink(token: string) {
		const url = `${window.location.origin}/s/${token}`;
		await navigator.clipboard.writeText(url);
		toast.success('Link copiado para a área de transferência!');
	}
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
	<div class="w-full max-w-xl overflow-hidden rounded-2xl border border-[#233047] bg-[#131c2e] shadow-2xl">
		<div class="flex items-center justify-between border-b border-[#1f2d45] px-5 py-4">
			<div class="min-w-0">
				<h3 class="truncate text-base font-semibold text-white">Compartilhar "{node.name}"</h3>
				<p class="text-xs text-slate-400">Compartilhe com usuários pelo @usuário ou gere links externos</p>
			</div>
			<button
				type="button"
				onclick={onClose}
				class="rounded-lg p-1.5 text-slate-400 hover:bg-[#1e2c44] hover:text-white"
			>
				<X class="h-4 w-4" />
			</button>
		</div>

		<!-- Tabs -->
		<div class="grid grid-cols-2 border-b border-[#1f2d45] bg-[#0e1525]">
			<button
				type="button"
				onclick={() => (tab = 'users')}
				class="flex items-center justify-center gap-2 py-3 text-xs font-semibold transition {tab === 'users'
					? 'border-b-2 border-accent-500 text-accent-300'
					: 'text-slate-400 hover:text-slate-200'}"
			>
				<Users class="h-4 w-4" />
				Usuários ({permissions.length})
			</button>
			<button
				type="button"
				onclick={() => (tab = 'links')}
				class="flex items-center justify-center gap-2 py-3 text-xs font-semibold transition {tab === 'links'
					? 'border-b-2 border-accent-500 text-accent-300'
					: 'text-slate-400 hover:text-slate-200'}"
			>
				<Link2 class="h-4 w-4" />
				Links Públicos ({links.length})
			</button>
		</div>

		<div class="max-h-[65vh] overflow-y-auto p-5">
			{#if tab === 'users'}
				<form onsubmit={grantUser} class="mb-3 flex flex-wrap gap-2">
					<input
						type="text"
						required
						bind:value={usernameInput}
						oninput={(e) => searchUsers(e.currentTarget.value)}
						placeholder="@usuario..."
						class="min-w-0 flex-1 rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-accent-500"
					/>
					<select
						bind:value={userPerm}
						class="rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-slate-200 outline-none focus:border-accent-500"
					>
						<option value="viewer">Leitor</option>
						<option value="editor">Editor</option>
					</select>
					<button
						type="submit"
						disabled={addingUser}
						class="inline-flex items-center gap-1.5 rounded-xl bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
					>
						<Plus class="h-4 w-4" />
						Adicionar
					</button>
				</form>

				{#if suggestions.length > 0}
					<div class="mb-4 flex flex-wrap gap-1.5">
						{#each suggestions as s (s.id)}
							<button
								type="button"
								onclick={() => (usernameInput = s.username)}
								class="inline-flex items-center gap-1.5 rounded-full border border-[#233047] bg-[#0e1525] px-2.5 py-1 text-[11px] text-slate-300 hover:border-accent-500/50 hover:text-white"
							>
								<span class="font-mono text-accent-400">@{s.username}</span>
								<span class="text-slate-500">({s.full_name})</span>
							</button>
						{/each}
					</div>
				{/if}

				{#if loading}
					<p class="py-6 text-center text-xs text-slate-400">Carregando...</p>
				{:else if permissions.length === 0}
					<div class="rounded-xl border border-dashed border-[#233047] py-8 text-center text-xs text-slate-500">
						Nenhum usuário possui acesso compartilhado a este item ainda.
					</div>
				{:else}
					<div class="space-y-2">
						{#each permissions as perm (perm.id)}
							<div class="flex items-center justify-between gap-3 rounded-xl border border-[#1f2d45] bg-[#0e1525] px-3.5 py-2.5">
								<div class="flex min-w-0 items-center gap-3">
									{#if perm.avatar_url}
										<img src={perm.avatar_url} alt={perm.full_name} class="h-8 w-8 shrink-0 rounded-full object-cover" />
									{:else}
										<div
											class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
											style="background-color: {perm.avatar_color}"
										>
											{getInitials(perm.full_name)}
										</div>
									{/if}
									<div class="min-w-0">
										<p class="truncate text-sm font-medium text-white">{perm.full_name}</p>
										<p class="truncate font-mono text-xs text-slate-400">@{perm.username}</p>
									</div>
								</div>
								<div class="flex items-center gap-2">
									<span
										class="rounded-full px-2.5 py-0.5 text-[11px] font-medium {perm.permission === 'editor'
											? 'bg-accent-500/15 text-accent-300'
											: 'bg-sky-500/15 text-sky-300'}"
									>
										{perm.permission === 'editor' ? 'Editor' : 'Leitor'}
									</span>
									<button
										type="button"
										onclick={() => revokePermission(perm.id)}
										class="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
										title="Remover acesso"
									>
										<Trash2 class="h-4 w-4" />
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{:else if node.type === 'folder'}
				<div class="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-200">
					Links públicos diretos estão disponíveis apenas para arquivos individuais. Para compartilhar esta pasta com outras pessoas, use a aba <strong>Usuários</strong>.
				</div>
			{:else}
				<form onsubmit={createLink} class="mb-5 space-y-3 rounded-xl border border-[#1f2d45] bg-[#0e1525] p-4">
					<p class="text-xs font-semibold text-slate-200">Novo Link Público</p>
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
						<div>
							<label class="mb-1 block text-[11px] text-slate-400" for="lpw">Senha (opcional)</label>
							<input
								id="lpw"
								type="password"
								bind:value={linkPassword}
								placeholder="Sem senha"
								class="w-full rounded-lg border border-[#233047] bg-[#0b101b] px-3 py-1.5 text-xs text-white outline-none focus:border-accent-500"
							/>
						</div>
						<div>
							<label class="mb-1 block text-[11px] text-slate-400" for="lexp">Expiração</label>
							<select
								id="lexp"
								bind:value={expiresInHours}
								class="w-full rounded-lg border border-[#233047] bg-[#0b101b] px-3 py-1.5 text-xs text-white outline-none focus:border-accent-500"
							>
								<option value={0}>Nunca expira</option>
								<option value={1}>1 hora</option>
								<option value={24}>24 horas</option>
								<option value={168}>7 dias</option>
								<option value={720}>30 dias</option>
							</select>
						</div>
						<div>
							<label class="mb-1 block text-[11px] text-slate-400" for="lmax">Máx. downloads</label>
							<input
								id="lmax"
								type="number"
								min="1"
								bind:value={maxDownloads}
								placeholder="Ilimitado"
								class="w-full rounded-lg border border-[#233047] bg-[#0b101b] px-3 py-1.5 text-xs text-white outline-none focus:border-accent-500"
							/>
						</div>
					</div>
					<button
						type="submit"
						disabled={creatingLink}
						class="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
					>
						<Link2 class="h-3.5 w-3.5" />
						{creatingLink ? 'Gerando...' : 'Gerar Link Público'}
					</button>
				</form>

				{#if links.length === 0}
					<div class="rounded-xl border border-dashed border-[#233047] py-8 text-center text-xs text-slate-500">
						Nenhum link público criado para este arquivo.
					</div>
				{:else}
					<div class="space-y-2.5">
						{#each links as link (link.id)}
							<div class="flex items-center justify-between gap-3 rounded-xl border border-[#1f2d45] bg-[#0e1525] px-3.5 py-2.5">
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<code class="truncate font-mono text-xs text-accent-300">/s/{link.token}</code>
										{#if link.has_password}
											<span class="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
												<Lock class="h-2.5 w-2.5" /> Senha
											</span>
										{/if}
									</div>
									<p class="mt-0.5 text-[11px] text-slate-500">
										{link.download_count}{link.max_downloads ? `/${link.max_downloads}` : ''} downloads
										{#if link.expires_at}
											• Expira: {formatDate(link.expires_at)}
										{/if}
									</p>
								</div>
								<div class="flex items-center gap-1.5">
									<button
										type="button"
										onclick={() => copyLink(link.token)}
										class="rounded-lg bg-[#19253b] p-1.5 text-slate-300 hover:bg-accent-600 hover:text-white"
										title="Copiar link"
									>
										<Copy class="h-3.5 w-3.5" />
									</button>
									<button
										type="button"
										onclick={() => revokeLink(link.id)}
										class="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
										title="Revogar link"
									>
										<Trash2 class="h-3.5 w-3.5" />
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	</div>
</div>
