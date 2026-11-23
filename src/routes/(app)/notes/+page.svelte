<script lang="ts">
	import { tick } from 'svelte';
	import type { NoteRecord, StorageNode } from '$lib/types';
	import { workspaceStore } from '$lib/stores/workspace.svelte';
	import { quotaStore } from '$lib/stores/quota.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { i18n } from '$lib/stores/i18n.svelte';
	import { formatBytes, formatDate } from '$lib/utils';
	import { renderInlineMarkdown, renderMarkdownToHtml } from '$lib/markdown';
	import ShareModal from '$lib/components/explorer/ShareModal.svelte';
	import {
		FileText,
		Plus,
		Search,
		Star,
		Share2,
		Trash2,
		Save,
		Pencil,
		Bold,
		Italic,
		Code,
		List,
		CheckSquare,
		Quote,
		Heading1,
		Heading2,
		Link2,
		Layers,
		Lock,
		Users,
		Check,
		Download,
		X,
		Sparkles
	} from 'lucide-svelte';

	let { data } = $props();

	let activeWs = $derived(workspaceStore.active);
	let activeWsId = $derived(activeWs?.id ?? null);

	let myNotes = $state<NoteRecord[]>([]);
	let sharedNotes = $state<NoteRecord[]>([]);
	let loadingList = $state(true);
	let loadingNote = $state(false);
	let searchQuery = $state('');
	let activeSection = $state<'mine' | 'shared'>('mine');

	let selectedNote = $state<NoteRecord | null>(null);
	let editorTitle = $state('');
	let editorContent = $state('');
	let isDirty = $state(false);
	let saving = $state(false);
	let lastSavedAt = $state<string | null>(null);

	// Obsidian Live Preview block-by-block state + Multi-line range selection + Undo/Redo history stack
	let lines = $state<string[]>(['']);
	let activeLineIndex = $state<number | null>(null);
	let activeInputEl = $state<HTMLTextAreaElement | null>(null);
	let undoStack = $state<string[][]>([]);
	let redoStack = $state<string[][]>([]);
	let isPointerSelecting = $state(false);
	let selectionAnchorLine = $state<number | null>(null);
	let selectionFocusLine = $state<number | null>(null);

	let selectedLineRange = $derived.by(() => {
		if (selectionAnchorLine === null || selectionFocusLine === null) return null;
		const start = Math.min(selectionAnchorLine, selectionFocusLine);
		const end = Math.max(selectionAnchorLine, selectionFocusLine);
		return { start, end };
	});

	function isLineInSelection(idx: number): boolean {
		if (!selectedLineRange) return false;
		return idx >= selectedLineRange.start && idx <= selectedLineRange.end;
	}

	function clearLineRangeSelection() {
		selectionAnchorLine = null;
		selectionFocusLine = null;
		isPointerSelecting = false;
	}

	let shareTargetNode = $state<StorageNode | null>(null);
	let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

	// Create Note Modal
	let showCreateNoteModal = $state(false);
	let newNoteName = $state('');
	let creatingNote = $state(false);

	// Rename Note Modal
	let renameTargetNote = $state<NoteRecord | null>(null);
	let renameNoteValue = $state('');
	let renamingNote = $state(false);

	let canEditCurrent = $derived(
		Boolean(
			selectedNote &&
				(selectedNote.permission === 'owner' || selectedNote.permission === 'editor')
		)
	);

	// Group lines so fenced code blocks (``` ... ```) stay aware of their boundaries in Live Preview
	let lineStates = $derived.by(() => {
		let inFence = false;
		let fenceLang = '';
		return lines.map((line, idx) => {
			const trimmed = line.trim();
			if (trimmed.startsWith('```')) {
				if (!inFence) {
					inFence = true;
					fenceLang = trimmed.slice(3).trim();
					return { idx, line, kind: 'fence-start' as const, lang: fenceLang };
				} else {
					inFence = false;
					const prevLang = fenceLang;
					fenceLang = '';
					return { idx, line, kind: 'fence-end' as const, lang: prevLang };
				}
			}
			if (inFence) {
				return { idx, line, kind: 'fence-body' as const, lang: fenceLang };
			}
			return { idx, line, kind: 'normal' as const, lang: '' };
		});
	});

	let wordCount = $derived.by(() => {
		const trimmed = editorContent.trim();
		if (!trimmed) return 0;
		return trimmed.split(/\s+/).length;
	});

	let contentByteLength = $derived(new TextEncoder().encode(editorContent || '').byteLength);

	function pushUndoSnapshot() {
		const snap = [...lines];
		if (undoStack.length > 0) {
			const last = undoStack[undoStack.length - 1];
			if (last.length === snap.length && last.every((l, i) => l === snap[i])) return;
		}
		undoStack = [...undoStack.slice(-59), snap];
		redoStack = [];
	}

	function syncContentFromLines() {
		editorContent = lines.join('\n');
		scheduleAutoSave();
	}

	function setLinesFromContent(raw: string) {
		const normalized = (raw || '').replace(/\r\n/g, '\n');
		lines = normalized.length > 0 ? normalized.split('\n') : [''];
		undoStack = [[...lines]];
		redoStack = [];
		activeLineIndex = null;
		clearLineRangeSelection();
	}

	function selectAllNoteLines() {
		if (lines.length === 0) return;
		activeLineIndex = null;
		selectionAnchorLine = 0;
		selectionFocusLine = lines.length - 1;
	}

	function onLineMouseDown(idx: number, e: MouseEvent) {
		if (e.button !== 0 || !canEditCurrent) return;
		if (e.shiftKey && (selectionAnchorLine !== null || activeLineIndex !== null)) {
			e.preventDefault();
			const anchor = selectionAnchorLine ?? activeLineIndex ?? idx;
			activeLineIndex = null;
			selectionAnchorLine = anchor;
			selectionFocusLine = idx;
			return;
		}
		isPointerSelecting = true;
		selectionAnchorLine = idx;
		selectionFocusLine = idx;
	}

	function onLineMouseEnter(idx: number, e: MouseEvent) {
		if (!isPointerSelecting || (e.buttons & 1) === 0) return;
		if (selectionAnchorLine !== null && idx !== selectionAnchorLine) {
			// User dragged across multiple lines -> enter multi-line selection mode (blur single-line textarea so native drag ghost doesn't trigger)
			if (activeLineIndex !== null) {
				activeLineIndex = null;
				window.getSelection()?.removeAllRanges();
			}
			selectionFocusLine = idx;
		}
	}

	function onWindowMouseUp() {
		if (!isPointerSelecting) return;
		isPointerSelecting = false;
		// If pointer Down & Up happened on the same line, keep normal single-line editing
		if (
			selectionAnchorLine !== null &&
			selectionFocusLine !== null &&
			selectionAnchorLine === selectionFocusLine
		) {
			selectionAnchorLine = null;
			selectionFocusLine = null;
		}
	}

	function autoResizeActiveTextarea(el: HTMLTextAreaElement | null) {
		if (!el) return;
		el.style.height = '0px';
		el.style.height = `${Math.max(24, el.scrollHeight)}px`;
	}

	async function activateLine(idx: number, cursorPos?: 'start' | 'end' | number) {
		if (!canEditCurrent) return;
		// If the user just dragged to select multiple lines, don't collapse the multi-line selection on the trailing click
		if (
			selectedLineRange &&
			selectedLineRange.start !== selectedLineRange.end
		) {
			return;
		}
		const clamped = Math.max(0, Math.min(lines.length - 1, idx));
		activeLineIndex = clamped;
		await tick();
		if (activeInputEl) {
			autoResizeActiveTextarea(activeInputEl);
			activeInputEl.focus();
			const len = activeInputEl.value.length;
			if (cursorPos === 'start') {
				activeInputEl.setSelectionRange(0, 0);
			} else if (typeof cursorPos === 'number') {
				const p = Math.max(0, Math.min(len, cursorPos));
				activeInputEl.setSelectionRange(p, p);
			} else {
				activeInputEl.setSelectionRange(len, len);
			}
		}
	}

	function handleLineInput(idx: number, val: string) {
		pushUndoSnapshot();
		// If user pasted multi-line text into a single line, split it into lines cleanly
		if (val.includes('\n')) {
			const parts = val.replace(/\r\n/g, '\n').split('\n');
			const next = [...lines];
			next.splice(idx, 1, ...parts);
			lines = next;
			syncContentFromLines();
			const targetLine = idx + parts.length - 1;
			void activateLine(targetLine, 'end');
			return;
		}
		lines[idx] = val;
		autoResizeActiveTextarea(activeInputEl);
		syncContentFromLines();
	}

	async function wrapInlineAtLine(
		idx: number,
		selStart: number,
		selEnd: number,
		prefix: string,
		suffix: string,
		placeholder: string
	) {
		pushUndoSnapshot();
		const cur = lines[idx] ?? '';
		const selected = cur.slice(selStart, selEnd);

		// Toggle off if already wrapped with prefix/suffix
		if (
			selStart >= prefix.length &&
			cur.slice(selStart - prefix.length, selStart) === prefix &&
			cur.slice(selEnd, selEnd + suffix.length) === suffix
		) {
			lines[idx] =
				cur.slice(0, selStart - prefix.length) +
				selected +
				cur.slice(selEnd + suffix.length);
			syncContentFromLines();
			await tick();
			activeInputEl?.setSelectionRange(
				selStart - prefix.length,
				selEnd - prefix.length
			);
			return;
		}

		const inner = selected || placeholder;
		lines[idx] = cur.slice(0, selStart) + prefix + inner + suffix + cur.slice(selEnd);
		syncContentFromLines();
		await tick();
		autoResizeActiveTextarea(activeInputEl);
		activeInputEl?.setSelectionRange(
			selStart + prefix.length,
			selStart + prefix.length + inner.length
		);
	}

	async function handleLineKeyDown(e: KeyboardEvent, idx: number) {
		if (!activeInputEl) return;
		const currentLine = lines[idx] ?? '';
		const selStart = activeInputEl.selectionStart ?? currentLine.length;
		const selEnd = activeInputEl.selectionEnd ?? currentLine.length;
		const mod = e.ctrlKey || e.metaKey;

		// === KEYMAPS & SHORTCUTS ===
		if (mod) {
			const key = e.key.toLowerCase();

			// Select All: Ctrl+A (first selects current line text; if already selected or empty, selects ALL lines in note!)
			if (key === 'a') {
				const allLineSelected =
					currentLine.length === 0 || (selStart === 0 && selEnd === currentLine.length);
				if (allLineSelected && lines.length > 1) {
					e.preventDefault();
					selectAllNoteLines();
					return;
				}
				// Otherwise let browser select the current line's text; pressing Ctrl+A a second time selects the whole note
				return;
			}

			// Save: Ctrl+S
			if (key === 's') {
				e.preventDefault();
				await saveCurrentNote(false);
				return;
			}

			// Undo: Ctrl+Z
			if (key === 'z' && !e.shiftKey) {
				if (undoStack.length > 0) {
					e.preventDefault();
					const prev = undoStack[undoStack.length - 1];
					redoStack = [...redoStack, [...lines]];
					undoStack = undoStack.slice(0, -1);
					lines = [...prev];
					syncContentFromLines();
					await activateLine(Math.min(idx, lines.length - 1), selStart);
				}
				return;
			}

			// Redo: Ctrl+Y or Ctrl+Shift+Z
			if (key === 'y' || (key === 'z' && e.shiftKey)) {
				if (redoStack.length > 0) {
					e.preventDefault();
					const nextSnap = redoStack[redoStack.length - 1];
					undoStack = [...undoStack, [...lines]];
					redoStack = redoStack.slice(0, -1);
					lines = [...nextSnap];
					syncContentFromLines();
					await activateLine(Math.min(idx, lines.length - 1), selStart);
				}
				return;
			}

			// Bold: Ctrl+B
			if (key === 'b') {
				e.preventDefault();
				await wrapInlineAtLine(idx, selStart, selEnd, '**', '**', 'negrito');
				return;
			}

			// Italic: Ctrl+I
			if (key === 'i') {
				e.preventDefault();
				await wrapInlineAtLine(idx, selStart, selEnd, '*', '*', 'itálico');
				return;
			}

			// Inline Code: Ctrl+E or Ctrl+`
			if (key === 'e' || key === '`') {
				e.preventDefault();
				await wrapInlineAtLine(idx, selStart, selEnd, '`', '`', 'código');
				return;
			}

			// Link: Ctrl+K
			if (key === 'k') {
				e.preventDefault();
				await wrapInlineAtLine(idx, selStart, selEnd, '[', '](https://)', 'link');
				return;
			}

			// Strikethrough: Ctrl+Shift+S or Ctrl+Shift+X
			if (e.shiftKey && (key === 'x' || key === 's')) {
				e.preventDefault();
				await wrapInlineAtLine(idx, selStart, selEnd, '~~', '~~', 'tachado');
				return;
			}

			// Toggle checklist on current line: Ctrl+L or Ctrl+Enter
			if (key === 'l' || e.key === 'Enter') {
				e.preventDefault();
				pushUndoSnapshot();
				const taskMatch = currentLine.match(/^(\s*[-*]\s+\[)([ xX])(\]\s+)(.*)$/);
				if (taskMatch) {
					const nextChar = taskMatch[2].toLowerCase() === 'x' ? ' ' : 'x';
					lines[idx] = `${taskMatch[1]}${nextChar}${taskMatch[3]}${taskMatch[4]}`;
				} else {
					lines[idx] = `- [ ] ${currentLine.replace(/^\s*[-*]\s+/, '')}`;
				}
				syncContentFromLines();
				await activateLine(idx, 'end');
				return;
			}

			// Duplicate Line: Ctrl+D
			if (key === 'd' && !e.shiftKey) {
				e.preventDefault();
				pushUndoSnapshot();
				const next = [...lines];
				next.splice(idx + 1, 0, currentLine);
				lines = next;
				syncContentFromLines();
				await activateLine(idx + 1, selStart);
				return;
			}

			// Delete Entire Line: Ctrl+Shift+K
			if (e.shiftKey && key === 'k') {
				e.preventDefault();
				pushUndoSnapshot();
				if (lines.length <= 1) {
					lines = [''];
					syncContentFromLines();
					await activateLine(0, 0);
				} else {
					const next = [...lines];
					next.splice(idx, 1);
					lines = next;
					syncContentFromLines();
					await activateLine(Math.max(0, idx - 1), 'end');
				}
				return;
			}

			// Headings: Ctrl+1 .. Ctrl+4 (or Ctrl+0 to clear heading)
			if (['1', '2', '3', '4', '0'].includes(key)) {
				e.preventDefault();
				pushUndoSnapshot();
				const stripped = currentLine.replace(/^#{1,6}\s+/, '');
				if (key === '0') {
					lines[idx] = stripped;
				} else {
					const hashes = '#'.repeat(Number(key));
					lines[idx] = `${hashes} ${stripped}`;
				}
				syncContentFromLines();
				await activateLine(idx, 'end');
				return;
			}
		}

		// Move line Up / Down: Alt+ArrowUp / Alt+ArrowDown
		if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
			e.preventDefault();
			const targetIdx = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
			if (targetIdx >= 0 && targetIdx < lines.length) {
				pushUndoSnapshot();
				const next = [...lines];
				const temp = next[targetIdx];
				next[targetIdx] = next[idx];
				next[idx] = temp;
				lines = next;
				syncContentFromLines();
				await activateLine(targetIdx, selStart);
			}
			return;
		}

		// Auto-pair brackets/quotes/asterisks when text is selected
		if (selStart !== selEnd && ['*', '`', '~', '=', '[', '(', '"', "'"].includes(e.key)) {
			e.preventDefault();
			const closeMap: Record<string, string> = { '[': ']', '(': ')' };
			const closeChar = closeMap[e.key] || e.key;
			await wrapInlineAtLine(idx, selStart, selEnd, e.key, closeChar, '');
			return;
		}

		// Enter / Shift+Enter -> split line & continue lists
		if (e.key === 'Enter') {
			e.preventDefault();
			pushUndoSnapshot();
			const before = currentLine.slice(0, selStart);
			const after = currentLine.slice(selEnd);

			let nextPrefix = '';
			if (!e.shiftKey) {
				const taskMatch = before.match(/^(\s*[-*]\s+\[)[ xX](\]\s+)(.*)$/);
				const ulMatch = before.match(/^(\s*[-*]\s+)(.+)$/);
				const olMatch = before.match(/^(\s*)(\d+)(\.\s+)(.+)$/);

				if (taskMatch) {
					if (!taskMatch[3].trim() && !after.trim()) {
						lines[idx] = '';
						syncContentFromLines();
						return;
					}
					nextPrefix = `${taskMatch[1]} ${taskMatch[2]}`;
				} else if (ulMatch) {
					if (!ulMatch[2].trim() && !after.trim()) {
						lines[idx] = '';
						syncContentFromLines();
						return;
					}
					nextPrefix = ulMatch[1];
				} else if (olMatch) {
					if (!olMatch[4].trim() && !after.trim()) {
						lines[idx] = '';
						syncContentFromLines();
						return;
					}
					nextPrefix = `${olMatch[1]}${Number(olMatch[2]) + 1}${olMatch[3]}`;
				}
			}

			const next = [...lines];
			next[idx] = before;
			next.splice(idx + 1, 0, nextPrefix + after);
			lines = next;
			syncContentFromLines();
			await activateLine(idx + 1, nextPrefix.length);
			return;
		}

		// Backspace at column 0 -> merge with previous line
		if (e.key === 'Backspace' && selStart === 0 && selEnd === 0 && idx > 0) {
			e.preventDefault();
			pushUndoSnapshot();
			const prevLine = lines[idx - 1] ?? '';
			const joinCursor = prevLine.length;
			const next = [...lines];
			next[idx - 1] = prevLine + currentLine;
			next.splice(idx, 1);
			lines = next;
			syncContentFromLines();
			await activateLine(idx - 1, joinCursor);
			return;
		}

		// Delete at end of line -> merge with next line
		if (
			e.key === 'Delete' &&
			selStart === currentLine.length &&
			selEnd === currentLine.length &&
			idx < lines.length - 1
		) {
			e.preventDefault();
			pushUndoSnapshot();
			const nextLine = lines[idx + 1] ?? '';
			const next = [...lines];
			next[idx] = currentLine + nextLine;
			next.splice(idx + 1, 1);
			lines = next;
			syncContentFromLines();
			await activateLine(idx, selStart);
			return;
		}

		// Left arrow at start of line -> jump to end of previous line
		if (e.key === 'ArrowLeft' && !mod && !e.shiftKey && selStart === 0 && selEnd === 0 && idx > 0) {
			e.preventDefault();
			await activateLine(idx - 1, 'end');
			return;
		}

		// Right arrow at end of line -> jump to start of next line
		if (
			e.key === 'ArrowRight' &&
			!mod &&
			!e.shiftKey &&
			selStart === currentLine.length &&
			selEnd === currentLine.length &&
			idx < lines.length - 1
		) {
			e.preventDefault();
			await activateLine(idx + 1, 'start');
			return;
		}

		if (e.key === 'ArrowUp' && !e.altKey && idx > 0) {
			e.preventDefault();
			await activateLine(idx - 1, selStart);
			return;
		}

		if (e.key === 'ArrowDown' && !e.altKey && idx < lines.length - 1) {
			e.preventDefault();
			await activateLine(idx + 1, selStart);
			return;
		}

		if (e.key === 'Escape') {
			e.preventDefault();
			activeLineIndex = null;
			return;
		}

		// Tab / Shift+Tab indentation
		if (e.key === 'Tab') {
			e.preventDefault();
			pushUndoSnapshot();
			if (e.shiftKey) {
				if (currentLine.startsWith('  ')) {
					lines[idx] = currentLine.slice(2);
					syncContentFromLines();
					await activateLine(idx, Math.max(0, selStart - 2));
				} else if (currentLine.startsWith('\t')) {
					lines[idx] = currentLine.slice(1);
					syncContentFromLines();
					await activateLine(idx, Math.max(0, selStart - 1));
				}
			} else {
				const nextLine = currentLine.slice(0, selStart) + '  ' + currentLine.slice(selEnd);
				lines[idx] = nextLine;
				syncContentFromLines();
				await activateLine(idx, selStart + 2);
			}
		}
	}

	function toggleTaskCheckbox(idx: number, e: MouseEvent) {
		e.stopPropagation();
		if (!canEditCurrent) return;
		const line = lines[idx] ?? '';
		const updated = line.replace(/^(\s*[-*]\s+\[)([ xX])(\]\s+)/, (_m, p1, state, p3) => {
			const nextChar = state.toLowerCase() === 'x' ? ' ' : 'x';
			return `${p1}${nextChar}${p3}`;
		});
		if (updated !== line) {
			lines[idx] = updated;
			syncContentFromLines();
		}
	}

	function getLineInputTypographyClass(line: string, kind: string): string {
		if (kind === 'fence-start' || kind === 'fence-end') {
			return 'font-mono text-xs leading-6 font-normal text-slate-500';
		}
		if (kind === 'fence-body') {
			return 'font-mono text-xs leading-6 font-normal text-accent-300';
		}
		if (/^#\s+/.test(line)) return 'font-sans text-2xl leading-8 font-bold tracking-tight text-white';
		if (/^##\s+/.test(line)) return 'font-sans text-xl leading-7 font-bold tracking-tight text-white';
		if (/^###\s+/.test(line)) return 'font-sans text-base leading-6 font-semibold text-white';
		if (/^####\s+/.test(line)) return 'font-sans text-sm leading-6 font-semibold uppercase tracking-wider text-slate-300';
		if (/^>\s*/.test(line)) return 'font-sans border-l-4 border-accent-500 bg-accent-500/10 pl-3 text-sm leading-6 font-normal text-slate-200';
		return 'font-sans text-sm leading-6 font-normal tracking-normal text-slate-200';
	}

	async function loadNotesList(selectId?: string | null) {
		if (!activeWsId) {
			myNotes = [];
			sharedNotes = [];
			selectedNote = null;
			loadingList = false;
			return;
		}

		loadingList = true;
		try {
			const params = new URLSearchParams({ workspaceId: activeWsId });
			if (searchQuery.trim()) params.set('search', searchQuery.trim());
			const res = await fetch(`/api/notes?${params.toString()}`);
			const payload = await res.json();
			if (!res.ok) {
				toast.error(payload.error || 'Erro ao carregar anotações.');
				return;
			}
			myNotes = payload.myNotes || [];
			sharedNotes = payload.sharedNotes || [];

			const targetId = selectId ?? selectedNote?.id ?? null;
			const all = [...myNotes, ...sharedNotes];
			const match = targetId ? all.find((n) => n.id === targetId) : null;

			if (match) {
				if (selectedNote?.id !== match.id || !editorContent) {
					await openNote(match.id);
				} else {
					selectedNote = { ...selectedNote, ...match };
				}
			} else if (myNotes.length > 0 && activeSection === 'mine') {
				await openNote(myNotes[0].id);
			} else if (sharedNotes.length > 0 && activeSection === 'shared') {
				await openNote(sharedNotes[0].id);
			} else {
				selectedNote = null;
				editorTitle = '';
				editorContent = '';
				lines = [''];
				isDirty = false;
			}
		} catch {
			toast.error('Erro de conexão ao listar anotações.');
		} finally {
			loadingList = false;
		}
	}

	// Reload strictly when workspace changes
	let lastLoadedWsId: string | null = '__init__';
	$effect(() => {
		const wsId = activeWsId;
		if (wsId !== lastLoadedWsId) {
			lastLoadedWsId = wsId;
			selectedNote = null;
			editorTitle = '';
			editorContent = '';
			lines = [''];
			isDirty = false;
			void loadNotesList(null);
		}
	});

	async function openNote(noteId: string) {
		if (isDirty && selectedNote && canEditCurrent) {
			await saveCurrentNote(true);
		}
		loadingNote = true;
		try {
			const res = await fetch(`/api/notes/${noteId}`);
			const payload = await res.json();
			if (!res.ok) {
				toast.error(payload.error || 'Não foi possível abrir esta anotação.');
				return;
			}
			selectedNote = payload.note;
			editorTitle = payload.note.title;
			editorContent = payload.note.content || '';
			setLinesFromContent(editorContent);
			isDirty = false;
			lastSavedAt = payload.note.updated_at;
		} finally {
			loadingNote = false;
		}
	}

	function openCreateNoteModal() {
		if (!activeWsId) {
			toast.warning('Conecte-se a uma workspace primeiro.');
			return;
		}
		newNoteName = '';
		showCreateNoteModal = true;
	}

	async function submitCreateNote(e: SubmitEvent) {
		e.preventDefault();
		if (!activeWsId) return;
		const cleanName = newNoteName.trim().replace(/\.md$/i, '');
		if (!cleanName) {
			toast.warning('Digite um nome para a anotação.');
			return;
		}

		if (isDirty && selectedNote && canEditCurrent) {
			await saveCurrentNote(true);
		}

		creatingNote = true;
		try {
			const res = await fetch('/api/notes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					workspaceId: activeWsId,
					title: cleanName,
					content: `# ${cleanName}\n\nClique em qualquer linha para editar o **Markdown** ao vivo (estilo Obsidian)...\n\n- [ ] Tarefa de exemplo (clique na caixinha ou no texto)\n- [x] Arquivo privado na workspace **${activeWs?.name || ''}**`
				})
			});
			const payload = await res.json();
			if (!res.ok) {
				toast.error(payload.error || 'Erro ao criar anotação.');
				return;
			}
			if (payload.quota && activeWs) {
				quotaStore.sync(payload.quota.used_bytes, payload.quota.quota_bytes, activeWs.name);
				workspaceStore.updateActiveUsage(payload.quota.used_bytes, payload.quota.quota_bytes);
			}
			showCreateNoteModal = false;
			newNoteName = '';
			activeSection = 'mine';
			selectedNote = payload.note;
			editorTitle = payload.note.title;
			editorContent = payload.note.content || '';
			setLinesFromContent(editorContent);
			isDirty = false;
			lastSavedAt = payload.note.updated_at;
			await loadNotesList(payload.note.id);
			toast.success(`Anotação "${payload.note.title}" criada!`);
		} finally {
			creatingNote = false;
		}
	}

	function openRenameNoteModal(note: NoteRecord, e?: MouseEvent) {
		e?.stopPropagation();
		renameTargetNote = note;
		renameNoteValue = note.title;
	}

	async function submitRenameNote(e: SubmitEvent) {
		e.preventDefault();
		if (!renameTargetNote) return;
		const clean = renameNoteValue.trim().replace(/\.md$/i, '');
		if (!clean) return;
		renamingNote = true;
		try {
			const res = await fetch(`/api/notes/${renameTargetNote.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: clean })
			});
			const payload = await res.json();
			if (!res.ok) {
				toast.error(payload.error || 'Erro ao renomear anotação.');
				return;
			}
			if (selectedNote?.id === renameTargetNote.id) {
				selectedNote.title = payload.title;
				selectedNote.name = payload.name;
				editorTitle = payload.title;
			}
			myNotes = myNotes.map((n) =>
				n.id === renameTargetNote!.id ? { ...n, title: payload.title, name: payload.name } : n
			);
			sharedNotes = sharedNotes.map((n) =>
				n.id === renameTargetNote!.id ? { ...n, title: payload.title, name: payload.name } : n
			);
			renameTargetNote = null;
			toast.success('Nome da anotação atualizado!');
		} finally {
			renamingNote = false;
		}
	}

	function scheduleAutoSave() {
		isDirty = true;
		if (autoSaveTimer) clearTimeout(autoSaveTimer);
		autoSaveTimer = setTimeout(() => {
			if (isDirty && selectedNote && canEditCurrent) {
				void saveCurrentNote(true);
			}
		}, 1000);
	}

	async function saveCurrentNote(silent = false) {
		if (!selectedNote || !canEditCurrent) return;
		if (autoSaveTimer) {
			clearTimeout(autoSaveTimer);
			autoSaveTimer = null;
		}
		saving = true;
		try {
			const res = await fetch(`/api/notes/${selectedNote.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: editorTitle.trim() || 'Sem título',
					content: editorContent
				})
			});
			const payload = await res.json();
			if (!res.ok) {
				if (!silent) toast.error(payload.error || 'Erro ao salvar anotação.');
				return;
			}
			isDirty = false;
			lastSavedAt = payload.updated_at;
			selectedNote.title = payload.title;
			selectedNote.name = payload.name;
			selectedNote.size_bytes = payload.size_bytes;
			selectedNote.updated_at = payload.updated_at;

			myNotes = myNotes.map((n) =>
				n.id === selectedNote!.id
					? {
							...n,
							title: payload.title,
							name: payload.name,
							size_bytes: payload.size_bytes,
							updated_at: payload.updated_at
						}
					: n
			);
			sharedNotes = sharedNotes.map((n) =>
				n.id === selectedNote!.id
					? {
							...n,
							title: payload.title,
							name: payload.name,
							size_bytes: payload.size_bytes,
							updated_at: payload.updated_at
						}
					: n
			);

			if (typeof payload.used_bytes === 'number' && activeWs) {
				quotaStore.sync(payload.used_bytes, activeWs.quota_bytes, activeWs.name);
				workspaceStore.updateActiveUsage(payload.used_bytes, activeWs.quota_bytes);
			}
			if (!silent) toast.success('Anotação salva!');
		} finally {
			saving = false;
		}
	}

	async function toggleStarSelected() {
		if (!selectedNote || !canEditCurrent) return;
		const next = !selectedNote.is_starred;
		const res = await fetch(`/api/notes/${selectedNote.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ is_starred: next })
		});
		if (res.ok) {
			selectedNote.is_starred = next;
			myNotes = myNotes.map((n) => (n.id === selectedNote!.id ? { ...n, is_starred: next } : n));
		}
	}

	async function deleteSelectedNote() {
		if (!selectedNote || selectedNote.permission !== 'owner') return;
		if (!confirm(`Excluir permanentemente a anotação "${selectedNote.title}"?`)) return;

		const deletingId = selectedNote.id;
		const res = await fetch(`/api/notes/${deletingId}`, { method: 'DELETE' });
		const payload = await res.json();
		if (!res.ok) {
			toast.error(payload.error || 'Erro ao excluir anotação.');
			return;
		}
		if (typeof payload.used_bytes === 'number' && activeWs) {
			quotaStore.sync(payload.used_bytes, activeWs.quota_bytes, activeWs.name);
			workspaceStore.updateActiveUsage(payload.used_bytes, activeWs.quota_bytes);
		}
		toast.info('Anotação excluída.');
		selectedNote = null;
		await loadNotesList(null);
	}

	function openShareForCurrent() {
		if (!selectedNote || selectedNote.permission !== 'owner') return;
		shareTargetNode = {
			id: selectedNote.id,
			workspace_id: selectedNote.workspace_id,
			created_by: selectedNote.created_by,
			parent_id: null,
			type: 'file',
			name: selectedNote.name,
			mime_type: 'text/markdown',
			size_bytes: selectedNote.size_bytes,
			sha256: null,
			is_starred: selectedNote.is_starred,
			is_trashed: false,
			trashed_at: null,
			created_at: selectedNote.created_at,
			updated_at: selectedNote.updated_at,
			permission: 'owner'
		};
	}

	function downloadMarkdownFile() {
		if (!selectedNote) return;
		const blob = new Blob([editorContent], { type: 'text/markdown;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = selectedNote.name || `${editorTitle || 'note'}.md`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function insertMarkdownSyntax(prefix: string, suffix = '', placeholder = 'texto') {
		if (!canEditCurrent) return;

		// If a line is currently active in Live Preview, insert at cursor or wrap selection
		if (activeLineIndex !== null && activeInputEl) {
			const idx = activeLineIndex;
			const cur = lines[idx] ?? '';
			const start = activeInputEl.selectionStart ?? cur.length;
			const end = activeInputEl.selectionEnd ?? cur.length;
			const cleanPrefix = prefix.replace(/^\n/, '');
			const selected = cur.slice(start, end) || placeholder;
			const replacement = `${cleanPrefix}${selected}${suffix}`;
			lines[idx] = cur.slice(0, start) + replacement + cur.slice(end);
			syncContentFromLines();
			await tick();
			if (activeInputEl) {
				activeInputEl.focus();
				activeInputEl.setSelectionRange(
					start + cleanPrefix.length,
					start + cleanPrefix.length + selected.length
				);
			}
			return;
		}

		// Otherwise append a new line at the end and focus it immediately
		const cleanPrefix = prefix.replace(/^\n/, '');
		const newLine = `${cleanPrefix}${placeholder}${suffix}`;
		const lastIdx = lines.length - 1;
		if (lines.length === 1 && !lines[0].trim()) {
			lines = [newLine];
			syncContentFromLines();
			await activateLine(0, cleanPrefix.length);
		} else {
			lines = [...lines, newLine];
			syncContentFromLines();
			await activateLine(lastIdx + 1, cleanPrefix.length);
		}
	}

	async function handleKeyDown(e: KeyboardEvent) {
		const mod = e.ctrlKey || e.metaKey;
		const key = e.key.toLowerCase();
		const activeTag = (document.activeElement?.tagName || '').toLowerCase();
		const inOtherInput =
			['input', 'select'].includes(activeTag) ||
			(activeTag === 'textarea' && document.activeElement !== activeInputEl);

		if (mod && key === 's') {
			e.preventDefault();
			void saveCurrentNote(false);
			return;
		}

		if (inOtherInput || !selectedNote) return;

		// Ctrl+A outside active line (or when multi-line range is active) -> select all lines in the note
		if (mod && key === 'a' && activeLineIndex === null) {
			e.preventDefault();
			selectAllNoteLines();
			return;
		}

		// Operations when a multi-line range is selected (Ctrl+C, Ctrl+X, Delete/Backspace, Escape, or typing to replace)
		if (selectedLineRange) {
			const { start, end } = selectedLineRange;
			const selectedText = lines.slice(start, end + 1).join('\n');

			if (mod && key === 'c') {
				e.preventDefault();
				await navigator.clipboard.writeText(selectedText);
				toast.info(`${end - start + 1} linha(s) copiada(s)!`);
				return;
			}

			if (mod && key === 'x' && canEditCurrent) {
				e.preventDefault();
				await navigator.clipboard.writeText(selectedText);
				pushUndoSnapshot();
				const remaining = [...lines];
				remaining.splice(start, end - start + 1, '');
				lines = remaining.length > 0 ? remaining : [''];
				clearLineRangeSelection();
				syncContentFromLines();
				await activateLine(Math.min(start, lines.length - 1), 0);
				return;
			}

			if ((e.key === 'Backspace' || e.key === 'Delete') && canEditCurrent) {
				e.preventDefault();
				pushUndoSnapshot();
				const remaining = [...lines];
				remaining.splice(start, end - start + 1, '');
				lines = remaining.length > 0 ? remaining : [''];
				clearLineRangeSelection();
				syncContentFromLines();
				await activateLine(Math.min(start, lines.length - 1), 0);
				return;
			}

			if (e.key === 'Escape') {
				e.preventDefault();
				clearLineRangeSelection();
				return;
			}

			// Typing a printable character replaces the selected lines
			if (canEditCurrent && !mod && !e.altKey && e.key.length === 1) {
				e.preventDefault();
				pushUndoSnapshot();
				const remaining = [...lines];
				remaining.splice(start, end - start + 1, e.key);
				lines = remaining;
				clearLineRangeSelection();
				syncContentFromLines();
				await activateLine(start, 1);
				return;
			}
		}

		// Global Undo / Redo when no single line is focused
		if (mod && activeLineIndex === null && canEditCurrent) {
			if (key === 'z' && !e.shiftKey && undoStack.length > 0) {
				e.preventDefault();
				const prev = undoStack[undoStack.length - 1];
				redoStack = [...redoStack, [...lines]];
				undoStack = undoStack.slice(0, -1);
				lines = [...prev];
				clearLineRangeSelection();
				syncContentFromLines();
				return;
			}
			if ((key === 'y' || (key === 'z' && e.shiftKey)) && redoStack.length > 0) {
				e.preventDefault();
				const nextSnap = redoStack[redoStack.length - 1];
				undoStack = [...undoStack, [...lines]];
				redoStack = redoStack.slice(0, -1);
				lines = [...nextSnap];
				clearLineRangeSelection();
				syncContentFromLines();
				return;
			}
		}
	}
</script>

<svelte:window onkeydown={handleKeyDown} onmouseup={onWindowMouseUp} />

<svelte:head>
	<title>{i18n.t('nav.notes')} — {activeWs ? activeWs.name : 'Workspace'}</title>
</svelte:head>

{#if !activeWs}
	<div class="flex flex-1 flex-col items-center justify-center p-6 text-center">
		<div class="w-full max-w-md rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-7 shadow-xl">
			<div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-500/15 text-accent-400">
				<Layers class="h-7 w-7" />
			</div>
			<h1 class="text-lg font-bold text-white">{i18n.t('explorer.no_ws_title')}</h1>
			<p class="mt-2 text-xs text-slate-400 sm:text-sm">
				{data.user.role === 'admin' ? i18n.t('explorer.no_ws_admin') : i18n.t('explorer.no_ws_user')}
			</p>
		</div>
	</div>
{:else}
	<div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
		<!-- Left Vault Sidebar (Obsidian / Notion style note list) -->
		<div class="flex w-full shrink-0 flex-col border-b border-[#1a253a] bg-[#0d1422] lg:h-full lg:w-72 lg:border-r lg:border-b-0">
			<!-- Vault Header -->
			<div class="border-b border-[#1a253a] p-3.5">
				<div class="mb-2.5 flex items-center justify-between gap-2">
					<div class="flex min-w-0 items-center gap-2">
						<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-500/15 text-accent-400">
							<FileText class="h-4 w-4" />
						</span>
						<div class="min-w-0">
							<h2 class="truncate text-xs font-bold uppercase tracking-wider text-white">
								{i18n.t('nav.notes')}
							</h2>
							<p class="truncate text-[10px] text-slate-400">
								Vault: <strong class="text-slate-200">{activeWs.name}</strong>
							</p>
						</div>
					</div>

					<button
						type="button"
						onclick={openCreateNoteModal}
						class="inline-flex shrink-0 items-center gap-1 rounded-xl bg-accent-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow hover:bg-accent-500"
						title={i18n.t('notes.new_note')}
					>
						<Plus class="h-3.5 w-3.5" />
						<span>{i18n.t('notes.new_short')}</span>
					</button>
				</div>

				<!-- Search inside current workspace's notes -->
				<div class="relative">
					<Search class="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
					<input
						type="text"
						bind:value={searchQuery}
						oninput={() => loadNotesList(selectedNote?.id)}
						placeholder={i18n.t('notes.search_placeholder')}
						class="w-full rounded-xl border border-[#1f2d45] bg-[#0b101b] py-1.5 pr-3 pl-8 text-xs text-white placeholder-slate-500 outline-none focus:border-accent-500"
					/>
				</div>

				<!-- Scope Switcher: My Personal Notes vs Shared With Me in this Workspace -->
				<div class="mt-2.5 grid grid-cols-2 gap-1 rounded-xl bg-[#090e18] p-1">
					<button
						type="button"
						onclick={() => (activeSection = 'mine')}
						class="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-semibold transition {activeSection === 'mine'
							? 'bg-[#19253c] text-white'
							: 'text-slate-400 hover:text-slate-200'}"
					>
						<Lock class="h-3 w-3 text-accent-400" />
						<span>{i18n.t('notes.my_notes')} ({myNotes.length})</span>
					</button>
					<button
						type="button"
						onclick={() => (activeSection = 'shared')}
						class="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-semibold transition {activeSection === 'shared'
							? 'bg-[#19253c] text-white'
							: 'text-slate-400 hover:text-slate-200'}"
					>
						<Users class="h-3 w-3 text-sky-400" />
						<span>{i18n.t('nav.shared')} ({sharedNotes.length})</span>
					</button>
				</div>
			</div>

			<!-- Notes List -->
			<div class="max-h-52 flex-1 space-y-1 overflow-y-auto p-2 lg:max-h-none">
				{#if loadingList}
					<p class="py-8 text-center text-xs text-slate-500">Carregando anotações...</p>
				{:else if activeSection === 'mine'}
					{#if myNotes.length === 0}
						<div class="rounded-xl border border-dashed border-[#1f2d45] p-5 text-center">
							<FileText class="mx-auto mb-2 h-6 w-6 text-slate-500" />
							<p class="text-xs font-medium text-slate-300">{i18n.t('notes.empty_title')}</p>
							<p class="mt-1 text-[11px] text-slate-500">
								{i18n.t('notes.empty_subtitle')}
							</p>
							<button
								type="button"
								onclick={openCreateNoteModal}
								class="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-500"
							>
								<Plus class="h-3.5 w-3.5" />
								{i18n.t('notes.new_note')}
							</button>
						</div>
					{:else}
						{#each myNotes as n (n.id)}
							{@const isActive = selectedNote?.id === n.id}
							<div
								class="group flex w-full flex-col gap-1 rounded-xl border p-2.5 text-left transition {isActive
									? 'border-accent-500/40 bg-[#17233a] text-white'
									: 'border-transparent bg-transparent text-slate-300 hover:bg-[#131d31]'}"
							>
								<div class="flex items-center justify-between gap-2">
									<button
										type="button"
										onclick={() => openNote(n.id)}
										class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
									>
										<FileText class="h-3.5 w-3.5 shrink-0 {isActive ? 'text-accent-400' : 'text-slate-500'}" />
										<span class="truncate text-xs font-semibold">{n.title}</span>
									</button>
									<div class="flex shrink-0 items-center gap-1">
										<button
											type="button"
											onclick={(e) => openRenameNoteModal(n, e)}
											class="rounded p-1 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-[#233250] hover:text-white {isActive ? 'opacity-100' : ''}"
											title="Renomear anotação"
										>
											<Pencil class="h-3 w-3" />
										</button>
										{#if n.is_starred}
											<Star class="h-3 w-3 fill-amber-400 text-amber-400" />
										{/if}
										{#if n.share_count > 0 || n.link_count > 0}
											<Share2 class="h-3 w-3 text-accent-400" />
										{/if}
									</div>
								</div>
								<button
									type="button"
									onclick={() => openNote(n.id)}
									class="flex w-full items-center justify-between text-[10px] text-slate-500"
								>
									<span class="font-mono">.md • {formatBytes(n.size_bytes)}</span>
									<span>{formatDate(n.updated_at)}</span>
								</button>
							</div>
						{/each}
					{/if}
				{:else}
					{#if sharedNotes.length === 0}
						<div class="rounded-xl border border-dashed border-[#1f2d45] p-5 text-center text-xs text-slate-500">
							Nenhuma anotação foi compartilhada com você nesta workspace.
						</div>
					{:else}
						{#each sharedNotes as n (n.id)}
							{@const isActive = selectedNote?.id === n.id}
							<button
								type="button"
								onclick={() => openNote(n.id)}
								class="flex w-full flex-col gap-1 rounded-xl border p-2.5 text-left transition {isActive
									? 'border-accent-500/40 bg-[#17233a] text-white'
									: 'border-transparent bg-transparent text-slate-300 hover:bg-[#131d31]'}"
							>
								<div class="flex items-center justify-between gap-2">
									<span class="truncate text-xs font-semibold">{n.title}</span>
									<span class="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-sky-300">
										{n.permission === 'editor' ? i18n.t('role.editor') : i18n.t('role.viewer')}
									</span>
								</div>
								<div class="flex items-center justify-between text-[10px] text-slate-500">
									<span>por @{n.created_by_username || 'usuário'}</span>
									<span>{formatDate(n.updated_at)}</span>
								</div>
							</button>
						{/each}
					{/if}
				{/if}
			</div>

			<!-- Privacy Footer Badge -->
			<div class="border-t border-[#1a253a] bg-[#0a0f1a] px-3.5 py-2.5 text-[11px] text-slate-400">
				<div class="flex items-center gap-1.5">
					<Lock class="h-3.5 w-3.5 shrink-0 text-accent-400" />
					<span class="truncate">{i18n.t('notes.privacy_badge')}</span>
				</div>
			</div>
		</div>

		<!-- Right Workspace Unified Live-Preview Canvas (Obsidian Live Preview) -->
		<div class="flex min-h-0 min-w-0 flex-1 flex-col bg-[#0b101b]">
			{#if !selectedNote}
				<div class="flex flex-1 flex-col items-center justify-center p-8 text-center">
					<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#1f2d45] bg-[#131c2e] text-accent-400">
						<FileText class="h-8 w-8" />
					</div>
					<h2 class="text-base font-bold text-white">{i18n.t('notes.select_or_create')}</h2>
					<p class="mt-1 max-w-md text-xs text-slate-400">
						{i18n.t('notes.isolated_explanation')}
					</p>
					<button
						type="button"
						onclick={openCreateNoteModal}
						class="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-accent-600/20 hover:bg-accent-500"
					>
						<Plus class="h-4 w-4" />
						{i18n.t('notes.new_note')}
					</button>
				</div>
			{:else}
				<!-- Top Note Action Bar -->
				<div class="flex flex-wrap items-center justify-between gap-2 border-b border-[#1a253a] bg-[#0e1525] px-4 py-2.5">
					<div class="flex min-w-0 flex-1 items-center gap-2">
						<input
							type="text"
							disabled={!canEditCurrent}
							bind:value={editorTitle}
							oninput={scheduleAutoSave}
							placeholder="Título da anotação..."
							class="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-base font-bold text-white outline-none transition focus:border-[#233047] focus:bg-[#0b101b] disabled:opacity-75 sm:text-lg"
						/>
						<span class="hidden items-center gap-1 rounded-md bg-accent-500/15 px-2 py-0.5 text-[10px] font-semibold text-accent-300 sm:inline-flex">
							<Sparkles class="h-3 w-3" /> Live Preview .md
						</span>
					</div>

					<!-- Actions -->
					<div class="flex flex-wrap items-center gap-1.5">
						{#if canEditCurrent}
							<button
								type="button"
								onclick={toggleStarSelected}
								class="rounded-xl border border-[#1f2d45] bg-[#131c2e] p-2 text-slate-300 hover:text-amber-400"
								title="Favoritar anotação"
							>
								<Star class="h-4 w-4 {selectedNote.is_starred ? 'fill-amber-400 text-amber-400' : ''}" />
							</button>
						{/if}

						{#if selectedNote.permission === 'owner'}
							<button
								type="button"
								onclick={openShareForCurrent}
								class="inline-flex items-center gap-1.5 rounded-xl border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-semibold text-accent-300 hover:bg-accent-500/25"
								title="Compartilhar anotação ou gerar link público"
							>
								<Share2 class="h-3.5 w-3.5" />
								<span>{i18n.t('notes.share')}</span>
								{#if selectedNote.share_count > 0 || selectedNote.link_count > 0}
									<span class="rounded-full bg-accent-500/30 px-1.5 py-0.2 text-[10px]">
										{selectedNote.share_count + selectedNote.link_count}
									</span>
								{/if}
							</button>
						{/if}

						<button
							type="button"
							onclick={downloadMarkdownFile}
							class="rounded-xl border border-[#1f2d45] bg-[#131c2e] p-2 text-slate-300 hover:text-white"
							title="Baixar arquivo .md"
						>
							<Download class="h-4 w-4" />
						</button>

						{#if canEditCurrent}
							<button
								type="button"
								disabled={saving}
								onclick={() => saveCurrentNote(false)}
								class="inline-flex items-center gap-1.5 rounded-xl bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
							>
								{#if isDirty}
									<Save class="h-3.5 w-3.5" />
									<span>{saving ? '...' : i18n.t('notes.save')}</span>
								{:else}
									<Check class="h-3.5 w-3.5" />
									<span>{i18n.t('notes.saved')}</span>
								{/if}
							</button>
						{/if}

						{#if selectedNote.permission === 'owner'}
							<button
								type="button"
								onclick={deleteSelectedNote}
								class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2 text-rose-300 hover:bg-rose-500/20"
								title="Excluir anotação"
							>
								<Trash2 class="h-4 w-4" />
							</button>
						{/if}
					</div>
				</div>

				<!-- Markdown Quick Formatting Toolbar -->
				{#if canEditCurrent}
					<div class="flex flex-wrap items-center justify-between gap-2 border-b border-[#1a253a] bg-[#0c121f] px-4 py-1.5">
						<div class="flex flex-wrap items-center gap-1">
							<button
								type="button"
								onclick={() => insertMarkdownSyntax('# ', '', 'Título 1')}
								class="rounded-lg p-1.5 text-slate-400 hover:bg-[#19253c] hover:text-white"
								title="Título H1"
							>
								<Heading1 class="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								onclick={() => insertMarkdownSyntax('## ', '', 'Título 2')}
								class="rounded-lg p-1.5 text-slate-400 hover:bg-[#19253c] hover:text-white"
								title="Subtítulo H2"
							>
								<Heading2 class="h-3.5 w-3.5" />
							</button>
							<div class="mx-1 h-4 w-px bg-[#1f2d45]"></div>
							<button
								type="button"
								onclick={() => insertMarkdownSyntax('**', '**', 'negrito')}
								class="rounded-lg p-1.5 text-slate-400 hover:bg-[#19253c] hover:text-white"
								title="Negrito (**texto**)"
							>
								<Bold class="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								onclick={() => insertMarkdownSyntax('*', '*', 'itálico')}
								class="rounded-lg p-1.5 text-slate-400 hover:bg-[#19253c] hover:text-white"
								title="Itálico (*texto*)"
							>
								<Italic class="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								onclick={() => insertMarkdownSyntax('`', '`', 'código')}
								class="rounded-lg p-1.5 text-slate-400 hover:bg-[#19253c] hover:text-white"
								title="Código inline (`código`)"
							>
								<Code class="h-3.5 w-3.5" />
							</button>
							<div class="mx-1 h-4 w-px bg-[#1f2d45]"></div>
							<button
								type="button"
								onclick={() => insertMarkdownSyntax('- [ ] ', '', 'Nova tarefa')}
								class="rounded-lg p-1.5 text-slate-400 hover:bg-[#19253c] hover:text-white"
								title="Checklist (- [ ] tarefa)"
							>
								<CheckSquare class="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								onclick={() => insertMarkdownSyntax('- ', '', 'Item da lista')}
								class="rounded-lg p-1.5 text-slate-400 hover:bg-[#19253c] hover:text-white"
								title="Lista (- item)"
							>
								<List class="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								onclick={() => insertMarkdownSyntax('> ', '', 'Citação ou destaque')}
								class="rounded-lg p-1.5 text-slate-400 hover:bg-[#19253c] hover:text-white"
								title="Citação (> texto)"
							>
								<Quote class="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								onclick={() => insertMarkdownSyntax('[', '](https://)', 'link')}
								class="rounded-lg p-1.5 text-slate-400 hover:bg-[#19253c] hover:text-white"
								title="Link ([texto](url))"
							>
								<Link2 class="h-3.5 w-3.5" />
							</button>
						</div>

						<div class="flex items-center gap-3 font-mono text-[11px] text-slate-500">
							<span>{wordCount} palavras</span>
							<span>{formatBytes(contentByteLength)}</span>
							{#if lastSavedAt}
								<span class="hidden sm:inline">• {formatDate(lastSavedAt)}</span>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Unified Obsidian Live Preview Editor Canvas (with Left Line Numbers, Zero Border Jump & Word-Wrap) -->
				{#if loadingNote}
					<div class="flex flex-1 items-center justify-center text-xs text-slate-400">
						Carregando conteúdo...
					</div>
				{:else}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						ondragstart={(e) => e.preventDefault()}
						onclick={(e) => {
							if (e.target === e.currentTarget && canEditCurrent) {
								clearLineRangeSelection();
								void activateLine(lines.length - 1, 'end');
							}
						}}
						class="select-text flex-1 cursor-text overflow-x-hidden overflow-y-auto bg-[#0b101b] px-3 py-5 sm:px-6 sm:py-7"
					>
						<div class="mx-auto max-w-4xl pb-24">
							{#each lineStates as item (item.idx)}
								{@const isEditingLine = activeLineIndex === item.idx && canEditCurrent}
								{@const isMultiSelected =
									selectedLineRange !== null &&
									item.idx >= selectedLineRange.start &&
									item.idx <= selectedLineRange.end &&
									(selectedLineRange.start !== selectedLineRange.end || activeLineIndex === null)}
								{@const taskMatch = item.line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/)}
								{@const hMatch = item.line.match(/^(#{1,4})\s+(.+)$/)}
								{@const ulMatch = !taskMatch ? item.line.match(/^\s*[-*]\s+(.+)$/) : null}
								{@const olMatch = item.line.match(/^\s*(\d+)\.\s+(.+)$/)}
								{@const quoteMatch = item.line.match(/^>\s?(.*)$/)}
								{@const isHr = /^(-{3,}|\*{3,}|_{3,})$/.test(item.line.trim())}

								<div
									onmousedown={(e) => onLineMouseDown(item.idx, e)}
									onmouseenter={(e) => onLineMouseEnter(item.idx, e)}
									class="group -mx-2 flex min-h-6 w-full items-start gap-3 rounded-md px-2 transition-colors {isMultiSelected
										? 'bg-accent-500/20'
										: isEditingLine
											? 'bg-[#131d31]/75'
											: 'hover:bg-[#11192b]/55'}"
								>
									<!-- Left Line Number Gutter -->
									<span
										onclick={() => activateLine(item.idx, 'end')}
										class="flex h-6 w-8 shrink-0 select-none items-center justify-end pr-1 font-mono text-[11px] leading-6 transition {isEditingLine || isMultiSelected
											? 'font-semibold text-accent-400'
											: 'text-slate-600 group-hover:text-slate-400'}"
									>
										{item.idx + 1}
									</span>

									<!-- Line Content Column (Fixed 24px single-line height, expands ONLY when word-wrapped) -->
									<div class="min-w-0 flex-1">
										{#if isEditingLine}
											<textarea
												bind:this={activeInputEl}
												rows={1}
												draggable="false"
												ondragstart={(e) => e.preventDefault()}
												value={item.line}
												oninput={(e) => handleLineInput(item.idx, e.currentTarget.value)}
												onkeydown={(e) => handleLineKeyDown(e, item.idx)}
												onblur={() => {
													if (activeLineIndex === item.idx) activeLineIndex = null;
												}}
												placeholder={item.idx === 0 ? 'Digite # para título ou comece a escrever...' : ''}
												class="m-0 block min-h-6 w-full resize-none overflow-hidden border-0 bg-transparent p-0 break-words whitespace-pre-wrap [overflow-wrap:anywhere] outline-none ring-0 {getLineInputTypographyClass(item.line, item.kind)}"
											></textarea>
										{:else if taskMatch}
											{@const isChecked = taskMatch[1].toLowerCase() === 'x'}
											<div
												onclick={() => activateLine(item.idx, 'end')}
												class="flex min-h-6 cursor-text items-center gap-2.5"
											>
												<button
													type="button"
													onclick={(e) => toggleTaskCheckbox(item.idx, e)}
													class="flex h-4 w-4 shrink-0 items-center justify-center rounded transition {isChecked
														? 'bg-accent-600 text-white'
														: 'border border-slate-500 bg-[#0b101b] hover:border-accent-400'}"
													aria-label="Alternar tarefa"
												>
													{#if isChecked}
														<Check class="h-3 w-3" />
													{/if}
												</button>
												<span
													class="min-w-0 flex-1 break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6 {isChecked
														? 'text-slate-500 line-through'
														: 'text-slate-200'}"
												>
													{@html renderInlineMarkdown(taskMatch[2] || '')}
												</span>
											</div>
										{:else if hMatch}
											{@const lvl = hMatch[1].length}
											<div
												onclick={() => activateLine(item.idx, 'end')}
												class="cursor-text break-words whitespace-pre-wrap [overflow-wrap:anywhere] {lvl === 1
													? 'border-b border-[#1f2d45] pb-1 text-2xl leading-8 font-bold tracking-tight text-white'
													: lvl === 2
														? 'text-xl leading-7 font-bold tracking-tight text-white'
														: lvl === 3
															? 'text-base leading-6 font-semibold text-white'
															: 'text-sm leading-6 font-semibold uppercase tracking-wider text-slate-300'}"
											>
												{@html renderInlineMarkdown(hMatch[2])}
											</div>
										{:else if ulMatch}
											<div
												onclick={() => activateLine(item.idx, 'end')}
												class="flex min-h-6 cursor-text items-center gap-2.5"
											>
												<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400"></span>
												<span class="min-w-0 flex-1 break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6 text-slate-200">
													{@html renderInlineMarkdown(ulMatch[1])}
												</span>
											</div>
										{:else if olMatch}
											<div
												onclick={() => activateLine(item.idx, 'end')}
												class="flex min-h-6 cursor-text items-baseline gap-2"
											>
												<span class="shrink-0 font-mono text-xs leading-6 font-semibold text-accent-400">{olMatch[1]}.</span>
												<span class="min-w-0 flex-1 break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6 text-slate-200">
													{@html renderInlineMarkdown(olMatch[2])}
												</span>
											</div>
										{:else if quoteMatch}
											<div
												onclick={() => activateLine(item.idx, 'end')}
												class="min-h-6 cursor-text border-l-4 border-accent-500 bg-accent-500/10 pl-3 break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6 text-slate-200"
											>
												{@html renderInlineMarkdown(quoteMatch[1])}
											</div>
										{:else if isHr}
											<div
												onclick={() => activateLine(item.idx, 'end')}
												class="flex h-6 cursor-text items-center"
											>
												<hr class="w-full border-[#1f2d45]" />
											</div>
										{:else if item.kind === 'fence-start' || item.kind === 'fence-end'}
											<div
												onclick={() => activateLine(item.idx, 'end')}
												class="min-h-6 cursor-text font-mono text-xs leading-6 text-slate-500"
											>
												{item.line}
											</div>
										{:else if item.kind === 'fence-body'}
											<div
												onclick={() => activateLine(item.idx, 'end')}
												class="min-h-6 cursor-text bg-[#080c14] px-3 font-mono text-xs leading-6 break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-accent-300"
											>
												{item.line || ' '}
											</div>
										{:else if !item.line.trim()}
											<div
												onclick={() => activateLine(item.idx, 'start')}
												class="h-6 w-full cursor-text"
											></div>
										{:else}
											<div
												onclick={() => activateLine(item.idx, 'end')}
												class="min-h-6 cursor-text break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6 text-slate-200"
											>
												{@html renderInlineMarkdown(item.line)}
											</div>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}

{#if showCreateNoteModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
		<form
			onsubmit={submitCreateNote}
			class="w-full max-w-md rounded-2xl border border-[#233047] bg-[#131c2e] p-5 shadow-2xl sm:p-6"
		>
			<div class="mb-4 flex items-center justify-between border-b border-[#1f2d45] pb-3">
				<div class="flex items-center gap-2.5">
					<div class="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400">
						<FileText class="h-4 w-4" />
					</div>
					<div>
						<h3 class="text-sm font-bold text-white">Nova Anotação Pessoal</h3>
						<p class="text-[11px] text-slate-400">
							Será salva como <code class="font-mono text-accent-300">.md</code> em <strong>{activeWs?.name}</strong>
						</p>
					</div>
				</div>
				<button
					type="button"
					onclick={() => (showCreateNoteModal = false)}
					class="rounded-lg p-1.5 text-slate-400 hover:bg-[#19253c] hover:text-white"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<div>
				<label for="nn-name" class="mb-1.5 block text-xs font-medium text-slate-300">
					Nome da Anotação
				</label>
				<div class="relative">
					<input
						id="nn-name"
						type="text"
						required
						maxlength={160}
						bind:value={newNoteName}
						placeholder="Ex: Ideias do Projeto, Reunião, Tarefas..."
						class="w-full rounded-xl border border-[#233047] bg-[#0b101b] py-2.5 pr-12 pl-3.5 text-sm text-white placeholder-slate-500 outline-none focus:border-accent-500"
					/>
					<span class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded bg-[#19253c] px-1.5 py-0.5 font-mono text-[11px] text-slate-400">
						.md
					</span>
				</div>
				<p class="mt-1.5 text-[11px] text-slate-500">
					Visível apenas para você nesta workspace (oculta da aba Arquivos).
				</p>
			</div>

			<div class="mt-5 flex justify-end gap-2">
				<button
					type="button"
					onclick={() => (showCreateNoteModal = false)}
					class="rounded-xl border border-[#233047] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-[#19253c]"
				>
					Cancelar
				</button>
				<button
					type="submit"
					disabled={creatingNote}
					class="inline-flex items-center gap-1.5 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
				>
					<Plus class="h-3.5 w-3.5" />
					{creatingNote ? 'Criando...' : 'Criar e Abrir Editor'}
				</button>
			</div>
		</form>
	</div>
{/if}

{#if renameTargetNote}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
		<form
			onsubmit={submitRenameNote}
			class="w-full max-w-md rounded-2xl border border-[#233047] bg-[#131c2e] p-5 shadow-2xl sm:p-6"
		>
			<div class="mb-4 flex items-center justify-between border-b border-[#1f2d45] pb-3">
				<h3 class="text-sm font-bold text-white">Renomear Anotação</h3>
				<button
					type="button"
					onclick={() => (renameTargetNote = null)}
					class="rounded-lg p-1.5 text-slate-400 hover:bg-[#19253c] hover:text-white"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<div>
				<label for="rn-name" class="mb-1.5 block text-xs font-medium text-slate-300">
					Novo nome
				</label>
				<div class="relative">
					<input
						id="rn-name"
						type="text"
						required
						maxlength={160}
						bind:value={renameNoteValue}
						class="w-full rounded-xl border border-[#233047] bg-[#0b101b] py-2.5 pr-12 pl-3.5 text-sm text-white outline-none focus:border-accent-500"
					/>
					<span class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded bg-[#19253c] px-1.5 py-0.5 font-mono text-[11px] text-slate-400">
						.md
					</span>
				</div>
			</div>

			<div class="mt-5 flex justify-end gap-2">
				<button
					type="button"
					onclick={() => (renameTargetNote = null)}
					class="rounded-xl border border-[#233047] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-[#19253c]"
				>
					Cancelar
				</button>
				<button
					type="submit"
					disabled={renamingNote}
					class="inline-flex items-center gap-1.5 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
				>
					<Save class="h-3.5 w-3.5" />
					{renamingNote ? 'Salvando...' : 'Salvar Nome'}
				</button>
			</div>
		</form>
	</div>
{/if}

{#if shareTargetNode}
	<ShareModal
		node={shareTargetNode}
		onClose={() => (shareTargetNode = null)}
		onUpdated={() => {
			if (selectedNote) void loadNotesList(selectedNote.id);
		}}
	/>
{/if}

<style>
	:global(.obsidian-live-line p),
	:global(.obsidian-live-line h1),
	:global(.obsidian-live-line h2),
	:global(.obsidian-live-line h3),
	:global(.obsidian-live-line h4),
	:global(.obsidian-live-line ul),
	:global(.obsidian-live-line ol),
	:global(.obsidian-live-line blockquote) {
		margin-top: 0.15rem !important;
		margin-bottom: 0.15rem !important;
	}
</style>
