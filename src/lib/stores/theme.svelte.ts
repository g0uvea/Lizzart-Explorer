import { applyAccentTheme, DEFAULT_ACCENT } from '$lib/theme';
import type { LayoutDensity } from '$lib/types';

class ThemeStore {
	accent = $state(DEFAULT_ACCENT);
	density = $state<LayoutDensity>('normal');

	init(serverColor?: string | null, serverDensity?: LayoutDensity | null) {
		let color = serverColor || DEFAULT_ACCENT;
		if (!serverColor && typeof localStorage !== 'undefined') {
			const saved = localStorage.getItem('lizzart_accent');
			if (saved) color = saved;
		}
		this.setAccent(color);

		let dens: LayoutDensity = serverDensity || 'normal';
		if (!serverDensity && typeof localStorage !== 'undefined') {
			const savedDens = localStorage.getItem('lizzart_density');
			if (savedDens === 'compact' || savedDens === 'normal') dens = savedDens;
		}
		this.setDensity(dens);
	}

	setAccent(hex: string) {
		this.accent = hex;
		applyAccentTheme(hex);
	}

	setDensity(mode: LayoutDensity) {
		this.density = mode;
		if (typeof document !== 'undefined') {
			document.documentElement.dataset.density = mode;
		}
		try {
			localStorage.setItem('lizzart_density', mode);
		} catch {
			// ignore storage errors
		}
	}
}

export const themeStore = new ThemeStore();
