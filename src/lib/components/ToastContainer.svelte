<script lang="ts">
	import { toast } from '$lib/stores/toast.svelte';
	import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-svelte';
</script>

<!-- Anchored top-right (never collides with TransferQueue at bottom-right; safe width on mobile) -->
<div
	class="pointer-events-none fixed inset-x-3 top-3 z-[100] flex flex-col gap-2 sm:inset-x-auto sm:top-4 sm:right-4 sm:w-96"
>
	{#each toast.items as item (item.id)}
		<div
			class="pointer-events-auto flex items-start gap-3 rounded-xl border px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur-md transition-all sm:px-4 sm:py-3 sm:text-sm
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
			<p class="min-w-0 flex-1 break-words leading-snug">{item.message}</p>
			<button
				type="button"
				onclick={() => toast.dismiss(item.id)}
				class="shrink-0 rounded p-0.5 text-slate-400 hover:text-white"
				aria-label="Fechar"
			>
				<X class="h-4 w-4" />
			</button>
		</div>
	{/each}
</div>
