<script lang="ts">
	import {
		Folder,
		Image,
		Film,
		Music,
		FileText,
		FileCode2,
		FileArchive,
		FileSpreadsheet,
		File
	} from 'lucide-svelte';
	import { getFileCategory } from '$lib/utils';

	interface Props {
		type: 'folder' | 'file';
		mime: string | null;
		name: string;
		size?: 'sm' | 'md' | 'lg';
	}

	let { type, mime, name, size = 'md' }: Props = $props();

	let category = $derived(getFileCategory(type, mime, name));
	let sizeClass = $derived(
		size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-9 w-9' : 'h-5 w-5'
	);
</script>

{#if category === 'folder'}
	<Folder class="{sizeClass} fill-indigo-500/20 text-indigo-400" />
{:else if category === 'image'}
	<Image class="{sizeClass} text-emerald-400" />
{:else if category === 'video'}
	<Film class="{sizeClass} text-purple-400" />
{:else if category === 'audio'}
	<Music class="{sizeClass} text-pink-400" />
{:else if category === 'pdf'}
	<FileText class="{sizeClass} text-rose-400" />
{:else if category === 'code'}
	<FileCode2 class="{sizeClass} text-sky-400" />
{:else if category === 'archive'}
	<FileArchive class="{sizeClass} text-amber-400" />
{:else if category === 'document'}
	<FileSpreadsheet class="{sizeClass} text-blue-400" />
{:else}
	<File class="{sizeClass} text-slate-400" />
{/if}
