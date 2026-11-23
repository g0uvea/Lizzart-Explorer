<script lang="ts">
	import { untrack } from 'svelte';
	import '../app.css';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { i18n } from '$lib/stores/i18n.svelte';
	import { transferManager } from '$lib/stores/transfers.svelte';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import TransferQueue from '$lib/components/TransferQueue.svelte';

	let { data, children } = $props();

	$effect(() => {
		const accent = data.user?.accent_color ?? null;
		const density = data.user?.layout_density ?? null;
		const lang = data.user?.language ?? data.locale?.language ?? 'en';
		const country = data.user?.country ?? data.locale?.country ?? 'US';
		const perf = data.perf;

		untrack(() => {
			themeStore.init(accent, density);
			i18n.init(lang, country);
			if (perf) {
				transferManager.applyClientPerfConfig(perf);
				if (typeof document !== 'undefined') {
					document.documentElement.dataset.perf = perf.mode;
				}
			}
		});
	});
</script>

<!-- Disable native browser context menu globally across the entire application -->
<svelte:window oncontextmenu={(e) => e.preventDefault()} />

{@render children()}
<TransferQueue />
<ToastContainer />
