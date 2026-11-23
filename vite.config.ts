import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';

/**
 * Transforms barrel imports (`import { HardDrive, UserCheck } from 'lucide-svelte'`)
 * into direct icon file imports (`lucide-svelte/icons/hard-drive`), avoiding loading
 * all 1,600+ Svelte icon components during dev/SSR.
 */
function lucideDirectImportsPlugin(): Plugin {
	const toKebab = (name: string) =>
		name
			.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
			.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
			.replace(/([a-zA-Z])([0-9]+)/g, '$1-$2')
			.replace(/([0-9]+)([a-zA-Z])/g, '$1-$2')
			.toLowerCase();

	return {
		name: 'lizzart-lucide-direct-imports',
		enforce: 'pre',
		transform(code, id) {
			if (!code.includes('lucide-svelte')) return null;
			if (!id.endsWith('.svelte') && !id.endsWith('.ts') && !id.endsWith('.js')) return null;

			let changed = false;
			const transformed = code.replace(
				/import\s*\{([^}]+)\}\s*from\s*['"]lucide-svelte['"]\s*;?/g,
				(_full, inner: string) => {
					const lines: string[] = [];
					const specs = inner
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean);

					for (const spec of specs) {
						if (spec.startsWith('type ')) continue;
						const parts = spec.split(/\s+as\s+/);
						const orig = parts[0].trim();
						const local = (parts[1] || parts[0]).trim();
						const kebab = toKebab(orig);
						lines.push(`import ${local} from 'lucide-svelte/icons/${kebab}';`);
					}
					changed = true;
					return lines.join('\n');
				}
			);

			return changed ? { code: transformed, map: null } : null;
		}
	};
}

export default defineConfig({
	plugins: [lucideDirectImportsPlugin(), tailwindcss(), sveltekit()],
	server: {
		port: 5173,
		host: true
	}
});
