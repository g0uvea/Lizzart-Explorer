<script lang="ts">
	import { onMount } from 'svelte';
	import type { StorageNode } from '$lib/types';
	import { toast } from '$lib/stores/toast.svelte';
	import { Folder, HardDrive, X, Check } from 'lucide-svelte';

	interface Props {
		nodes: StorageNode[];
		onClose: () => void;
		onMoved: () => void;
	}

	let { nodes, onClose, onMoved }: Props = $props();

	interface FolderOption {
		id: string;
		parent_id: string | null;
		name: string;
	}

	let folders = $state<FolderOption[]>([]);
	let loading = $state(true);
	let selectedParent = $state<string | null>(null);
	let saving = $state(false);

	onMount(async () => {
		const excludedIds = new Set(nodes.map((n) => n.id));
		selectedParent = nodes.length === 1 ? nodes[0].parent_id : null;
		try {
			const res = await fetch('/api/files/folders');
			const data = await res.json();
			if (res.ok) {
				folders = (data.folders as FolderOption[]).filter((f) => !excludedIds.has(f.id));
			}
		} finally {
			loading = false;
		}
	});

	async function confirmMove() {
		saving = true;
		try {
			for (const node of nodes) {
				const res = await fetch(`/api/files/${node.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ parent_id: selectedParent })
				});
				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					toast.error(data.error || `Erro ao mover "${node.name}".`);
					return;
				}
			}
			toast.success(
				nodes.length === 1
					? `"${nodes[0].name}" movido com sucesso!`
					: `${nodes.length} itens movidos com sucesso!`
			);
			onMoved();
			onClose();
		} finally {
			saving = false;
		}
	}
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
	<div class="w-full max-w-md overflow-hidden rounded-2xl border border-[#233047] bg-[#131c2e] shadow-2xl">
		<div class="flex items-center justify-between border-b border-[#1f2d45] px-5 py-4">
			<h3 class="truncate text-sm font-semibold text-white">
				Mover {nodes.length === 1 ? `"${nodes[0].name}"` : `${nodes.length} itens`}
			</h3>
			<button type="button" onclick={onClose} class="rounded-lg p-1 text-slate-400 hover:text-white">
				<X class="h-4 w-4" />
			</button>
		</div>

		<div class="max-h-72 space-y-1.5 overflow-y-auto p-4">
			<button
				type="button"
				onclick={() => (selectedParent = null)}
				class="flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm transition {selectedParent === null
					? 'border-accent-500 bg-accent-500/15 text-white'
					: 'border-transparent bg-[#0e1525] text-slate-300 hover:border-[#233047]'}"
			>
				<span class="flex items-center gap-2.5">
					<HardDrive class="h-4 w-4 text-accent-400" />
					Meus Arquivos (Raiz)
				</span>
				{#if selectedParent === null}
					<Check class="h-4 w-4 text-accent-400" />
				{/if}
			</button>

			{#if loading}
				<p class="py-4 text-center text-xs text-slate-400">Carregando pastas...</p>
			{:else}
				{#each folders as f (f.id)}
					<button
						type="button"
						onclick={() => (selectedParent = f.id)}
						class="flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm transition {selectedParent === f.id
							? 'border-accent-500 bg-accent-500/15 text-white'
							: 'border-transparent bg-[#0e1525] text-slate-300 hover:border-[#233047]'}"
					>
						<span class="flex items-center gap-2.5 truncate">
							<Folder class="h-4 w-4 shrink-0 text-accent-400" />
							<span class="truncate">{f.name}</span>
						</span>
						{#if selectedParent === f.id}
							<Check class="h-4 w-4 shrink-0 text-accent-400" />
						{/if}
					</button>
				{/each}
			{/if}
		</div>

		<div class="flex justify-end gap-2 border-t border-[#1f2d45] bg-[#0e1525] px-5 py-3.5">
			<button
				type="button"
				onclick={onClose}
				class="rounded-xl border border-[#233047] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-[#19253b]"
			>
				Cancelar
			</button>
			<button
				type="button"
				disabled={saving}
				onclick={confirmMove}
				class="rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
			>
				{saving ? 'Movendo...' : 'Mover para cá'}
			</button>
		</div>
	</div>
</div>
