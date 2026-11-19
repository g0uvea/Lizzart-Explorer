<script lang="ts">
	import '../app.css';
	import { themeStore } from '$lib/stores/theme.svelte';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import TransferQueue from '$lib/components/TransferQueue.svelte';

	let { data, children } = $props();

	$effect(() => {
		themeStore.init(data.user?.accent_color ?? null, data.user?.layout_density ?? null);
	});
</script>

<!-- Disable native browser context menu globally across the entire application -->
<svelte:window oncontextmenu={(e) => e.preventDefault()} />

{@render children()}
<TransferQueue />
<ToastContainer />
