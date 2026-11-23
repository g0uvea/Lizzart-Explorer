/**
 * Lightweight, dependency-free, XSS-safe Markdown to HTML renderer
 * tailored for Notion / Obsidian style notes (headings, checklists, code blocks,
 * blockquotes, callouts, tables, bold, italic, strikethrough, inline code, links).
 */
function escapeHtml(raw: string): string {
	return raw
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function renderInline(line: string): string {
	let out = escapeHtml(line);

	// Inline code `code`
	out = out.replace(
		/`([^`]+)`/g,
		'<code class="rounded bg-[#19253c] px-1.5 py-0.5 font-mono text-[0.85em] text-accent-300">$1</code>'
	);

	// Bold **text**
	out = out.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-white">$1</strong>');

	// Italic *text*
	out = out.replace(/\*([^*]+)\*/g, '<em class="italic text-slate-200">$1</em>');

	// Strikethrough ~~text~~
	out = out.replace(/~~([^~]+)~~/g, '<del class="text-slate-500 line-through">$1</del>');

	// Highlight ==text== (Obsidian style)
	out = out.replace(
		/==([^=]+)==/g,
		'<mark class="rounded bg-accent-500/25 px-1 text-accent-200">$1</mark>'
	);

	// WikiLinks [[Note Name]] (Obsidian style badge)
	out = out.replace(
		/\[\[([^\]]+)\]\]/g,
		'<span class="inline-flex items-center gap-1 rounded bg-accent-500/15 px-1.5 py-0.5 text-xs font-medium text-accent-300 ring-1 ring-accent-500/30">📄 $1</span>'
	);

	// Standard links [label](https://...)
	out = out.replace(
		/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
		'<a href="$2" target="_blank" rel="noopener noreferrer" class="font-medium text-accent-400 underline hover:text-accent-300">$1</a>'
	);

	return out;
}

export function renderInlineMarkdown(line: string): string {
	return renderInline(line);
}

export function renderMarkdownToHtml(markdown: string): string {
	if (!markdown || !markdown.trim()) {
		return '<p class="text-sm italic text-slate-500">Anotação vazia...</p>';
	}

	const lines = markdown.replace(/\r\n/g, '\n').split('\n');
	const html: string[] = [];
	let inCodeBlock = false;
	let codeLang = '';
	let codeLines: string[] = [];
	let listMode: 'ul' | 'ol' | null = null;

	const closeList = () => {
		if (listMode === 'ul') html.push('</ul>');
		if (listMode === 'ol') html.push('</ol>');
		listMode = null;
	};

	for (let i = 0; i < lines.length; i++) {
		const rawLine = lines[i];

		// Fenced code blocks ```lang
		if (rawLine.trim().startsWith('```')) {
			closeList();
			if (!inCodeBlock) {
				inCodeBlock = true;
				codeLang = rawLine.trim().slice(3).trim();
				codeLines = [];
			} else {
				const langBadge = codeLang
					? `<div class="border-b border-[#1f2d45] bg-[#0e1525] px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-400">${escapeHtml(codeLang)}</div>`
					: '';
				html.push(
					`<div class="my-3 overflow-hidden rounded-xl border border-[#1f2d45] bg-[#080c14]">${langBadge}<pre class="overflow-x-auto p-3.5 font-mono text-xs leading-relaxed text-slate-200"><code>${escapeHtml(codeLines.join('\n'))}</code></pre></div>`
				);
				inCodeBlock = false;
				codeLang = '';
				codeLines = [];
			}
			continue;
		}

		if (inCodeBlock) {
			codeLines.push(rawLine);
			continue;
		}

		const trimmed = rawLine.trim();

		// Empty line
		if (!trimmed) {
			closeList();
			continue;
		}

		// Horizontal rule
		if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
			closeList();
			html.push('<hr class="my-5 border-[#1f2d45]" />');
			continue;
		}

		// Headings # H1 .. #### H4
		const hMatch = rawLine.match(/^(#{1,4})\s+(.+)$/);
		if (hMatch) {
			closeList();
			const level = hMatch[1].length;
			const content = renderInline(hMatch[2]);
			if (level === 1) {
				html.push(
					`<h1 class="mt-5 mb-3 border-b border-[#1f2d45] pb-2 text-2xl font-bold tracking-tight text-white first:mt-0">${content}</h1>`
				);
			} else if (level === 2) {
				html.push(
					`<h2 class="mt-4 mb-2 text-xl font-bold tracking-tight text-white">${content}</h2>`
				);
			} else if (level === 3) {
				html.push(`<h3 class="mt-3 mb-1.5 text-base font-semibold text-white">${content}</h3>`);
			} else {
				html.push(
					`<h4 class="mt-2.5 mb-1 text-sm font-semibold uppercase tracking-wider text-slate-300">${content}</h4>`
				);
			}
			continue;
		}

		// Blockquote > text
		if (trimmed.startsWith('>')) {
			closeList();
			const quoteText = renderInline(trimmed.replace(/^>\s?/, ''));
			html.push(
				`<blockquote class="my-3 rounded-r-xl border-l-4 border-accent-500 bg-accent-500/10 px-4 py-2.5 text-sm text-slate-200">${quoteText}</blockquote>`
			);
			continue;
		}

		// Task checklist - [ ] or - [x]
		const taskMatch = rawLine.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
		if (taskMatch) {
			if (listMode !== 'ul') {
				closeList();
				listMode = 'ul';
				html.push('<ul class="my-2.5 space-y-1.5">');
			}
			const checked = taskMatch[1].toLowerCase() === 'x';
			const text = renderInline(taskMatch[2]);
			const box = checked
				? '<span class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-accent-600 text-[10px] font-bold text-white">✓</span>'
				: '<span class="inline-block h-4 w-4 shrink-0 rounded border border-slate-500 bg-[#0b101b]"></span>';
			html.push(
				`<li class="flex items-center gap-2.5 text-sm leading-5 ${checked ? 'text-slate-500 line-through' : 'text-slate-200'}">${box}<span class="min-w-0 break-words [overflow-wrap:anywhere]">${text}</span></li>`
			);
			continue;
		}

		// Unordered list - item or * item
		const ulMatch = rawLine.match(/^\s*[-*]\s+(.+)$/);
		if (ulMatch) {
			if (listMode !== 'ul') {
				closeList();
				listMode = 'ul';
				html.push('<ul class="my-2.5 list-disc space-y-1 pl-5 text-sm text-slate-200">');
			}
			html.push(`<li>${renderInline(ulMatch[1])}</li>`);
			continue;
		}

		// Ordered list 1. item
		const olMatch = rawLine.match(/^\s*\d+\.\s+(.+)$/);
		if (olMatch) {
			if (listMode !== 'ol') {
				closeList();
				listMode = 'ol';
				html.push('<ol class="my-2.5 list-decimal space-y-1 pl-5 text-sm text-slate-200">');
			}
			html.push(`<li>${renderInline(olMatch[1])}</li>`);
			continue;
		}

		// Normal paragraph
		closeList();
		html.push(
			`<p class="my-2 break-words [overflow-wrap:anywhere] text-sm leading-relaxed text-slate-200">${renderInline(rawLine)}</p>`
		);
	}

	closeList();
	if (inCodeBlock && codeLines.length > 0) {
		html.push(
			`<pre class="my-3 overflow-x-auto rounded-xl border border-[#1f2d45] bg-[#080c14] p-3.5 font-mono text-xs text-slate-200"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`
		);
	}

	return html.join('\n');
}
