import type { WorkspaceSummary } from '$lib/types';

const STORAGE_KEY = 'lizzart_active_workspace_id';

class WorkspaceStore {
	workspaces = $state<WorkspaceSummary[]>([]);
	activeId = $state<string | null>(null);

	get active(): WorkspaceSummary | null {
		if (!this.activeId) return this.workspaces[0] ?? null;
		return this.workspaces.find((w) => w.id === this.activeId) ?? this.workspaces[0] ?? null;
	}

	sync(list: WorkspaceSummary[], preferredId?: string | null) {
		this.workspaces = list;
		if (list.length === 0) {
			this.activeId = null;
			return;
		}

		if (preferredId && list.some((w) => w.id === preferredId)) {
			this.setActive(preferredId);
			return;
		}

		if (this.activeId && list.some((w) => w.id === this.activeId)) {
			return;
		}

		let saved: string | null = null;
		try {
			saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
		} catch {
			saved = null;
		}

		if (saved && list.some((w) => w.id === saved)) {
			this.activeId = saved;
		} else {
			this.activeId = list[0].id;
		}
	}

	setActive(id: string | null) {
		this.activeId = id;
		try {
			if (typeof localStorage !== 'undefined') {
				if (id) localStorage.setItem(STORAGE_KEY, id);
				else localStorage.removeItem(STORAGE_KEY);
			}
		} catch {
			// ignore storage errors
		}
	}

	updateActiveUsage(usedBytes: number, quotaBytes?: number) {
		const id = this.active?.id;
		if (!id) return;
		this.workspaces = this.workspaces.map((w) =>
			w.id === id
				? {
						...w,
						used_bytes: usedBytes,
						quota_bytes: quotaBytes !== undefined ? quotaBytes : w.quota_bytes
					}
				: w
		);
	}
}

export const workspaceStore = new WorkspaceStore();
