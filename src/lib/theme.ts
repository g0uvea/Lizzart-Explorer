export interface AccentPreset {
	name: string;
	hex: string;
}

export const DEFAULT_ACCENT = '#10b981';

export const ACCENT_PRESETS: AccentPreset[] = [
	{ name: 'Verde Esmeralda', hex: '#10b981' },
	{ name: 'Verde Lima', hex: '#22c55e' },
	{ name: 'Turquesa', hex: '#14b8a6' },
	{ name: 'Ciano', hex: '#06b6d4' },
	{ name: 'Azul Céu', hex: '#0ea5e9' },
	{ name: 'Índigo', hex: '#6366f1' },
	{ name: 'Violeta', hex: '#8b5cf6' },
	{ name: 'Rosa', hex: '#ec4899' },
	{ name: 'Âmbar', hex: '#f59e0b' },
	{ name: 'Vermelho', hex: '#ef4444' }
];

function hexToRgb(hex: string): [number, number, number] {
	const clean = hex.replace('#', '');
	const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
	const num = parseInt(full, 16);
	if (Number.isNaN(num)) return [16, 185, 129];
	return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
	const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
	return (
		'#' +
		[clamp(r), clamp(g), clamp(b)]
			.map((v) => v.toString(16).padStart(2, '0'))
			.join('')
	);
}

function mix(rgb: [number, number, number], target: [number, number, number], weight: number): string {
	return rgbToHex(
		rgb[0] + (target[0] - rgb[0]) * weight,
		rgb[1] + (target[1] - rgb[1]) * weight,
		rgb[2] + (target[2] - rgb[2]) * weight
	);
}

export function applyAccentTheme(hex: string) {
	if (typeof document === 'undefined') return;
	const validHex = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : DEFAULT_ACCENT;
	const rgb = hexToRgb(validHex);

	const root = document.documentElement;
	root.style.setProperty('--accent-300', mix(rgb, [255, 255, 255], 0.48));
	root.style.setProperty('--accent-400', mix(rgb, [255, 255, 255], 0.22));
	root.style.setProperty('--accent-500', validHex);
	root.style.setProperty('--accent-600', mix(rgb, [0, 0, 0], 0.14));
	root.style.setProperty('--accent-700', mix(rgb, [0, 0, 0], 0.28));
	root.style.setProperty('--accent-rgb', `${rgb[0]} ${rgb[1]} ${rgb[2]}`);

	try {
		localStorage.setItem('lizzart_accent', validHex);
	} catch {
		// ignore storage errors
	}
}
