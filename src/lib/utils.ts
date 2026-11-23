import { i18n } from '$lib/stores/i18n.svelte';

export function formatBytes(bytes: number): string {
	if (bytes < 0) return i18n.t('explorer.unlimited');
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const val = bytes / Math.pow(1024, i);
	return `${val >= 100 || i === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[i]}`;
}

export function formatDate(iso: string | null | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '—';
	const localeTag = i18n.bcp47 || 'en-US';
	try {
		return new Intl.DateTimeFormat(localeTag, {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		}).format(d);
	} catch {
		return new Intl.DateTimeFormat('en-US', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		}).format(d);
	}
}

export type FileCategory =
	| 'folder'
	| 'image'
	| 'video'
	| 'audio'
	| 'pdf'
	| 'code'
	| 'archive'
	| 'document'
	| 'other';

export function getFileCategory(type: 'folder' | 'file', mime: string | null, name: string): FileCategory {
	if (type === 'folder') return 'folder';
	const m = (mime || '').toLowerCase();
	const ext = name.split('.').pop()?.toLowerCase() || '';

	if (m.startsWith('image/')) return 'image';
	if (m.startsWith('video/')) return 'video';
	if (m.startsWith('audio/')) return 'audio';
	if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
	if (
		['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'jar'].includes(ext) ||
		m.includes('zip') ||
		m.includes('compressed') ||
		m.includes('archive')
	) {
		return 'archive';
	}
	if (
		[
			'js',
			'ts',
			'svelte',
			'html',
			'css',
			'json',
			'xml',
			'yaml',
			'yml',
			'toml',
			'sql',
			'py',
			'java',
			'rs',
			'go',
			'sh',
			'ps1',
			'properties',
			'ini',
			'env',
			'md',
			'txt',
			'log',
			'csv'
		].includes(ext) ||
		m.startsWith('text/') ||
		m === 'application/json'
	) {
		return 'code';
	}
	if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'rtf'].includes(ext)) {
		return 'document';
	}
	return 'other';
}

export function isPreviewable(mime: string | null, name: string): boolean {
	const cat = getFileCategory('file', mime, name);
	return ['image', 'video', 'audio', 'pdf', 'code'].includes(cat);
}

export function getInitials(name: string): string {
	return name
		.trim()
		.split(/\s+/)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() || '')
		.join('');
}
