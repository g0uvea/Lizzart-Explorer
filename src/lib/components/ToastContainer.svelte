<script lang="ts">
	import { toast } from '$lib/stores/toast.svelte';
	import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-svelte';
</script>

<div class="pointer-events-none fixed right-4 bottom-4 z-[100] flex max-w-sm flex-col gap-2">
	{#each toast.items as item (item.id)}
		<div
			class="pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-md transition-all
			{item.type === 'success'
				? 'border-emerald-500/30 bg-[#0f1f1c]/95 text-emerald-100'
				: item.type === 'error'
					? 'border-rose-500/30 bg-[#231118]/95 text-rose-100'
					: item.type === 'warning'
						? 'border-amber-500/30 bg-[#241c0f]/95 text-amber-100'
						: 'border-indigo-500/30 bg-[#131c2e]/95 text-slate-100'}"
		>
			<div class="mt-0.5 shrink-0">
				{#if item.type === 'success'}
					<CheckCircle2 class="h-4 w-4 text-emerald-400" />
				{:else if item.type === 'error'}
					<AlertCircle class="h-4 w-4 text-rose-400" />
				{:else if item.type === 'warning'}
					<AlertTriangle class="h-4 w-4 text-amber-400" />
				{:else}
					<Info class="h-4 w-4 text-indigo-400" />
				{/if}
			</div>
			<p class="flex-1 leading-snug">{item.message}</p>
			<button
				type="button"
				onclick={() => toast.dismiss(item.id)}
				class="shrink-0 text-slate-400 hover:text-white"
				aria-label="Fechar"
			>
				<X class="h-4 w-4" />
			</button>
		</div>
	{/each}
</div>
