import type { StorageNode } from '$lib/types';

export const LIZZART_DRAG_MIME = 'application/x-lizzart-nodes';

class DragStore {
	draggingNodes = $state<StorageNode[]>([]);
	version = $state(0);

	get active(): boolean {
		return this.draggingNodes.length > 0;
	}

	get draggingIds(): Set<string> {
		return new Set(this.draggingNodes.map((n) => n.id));
	}

	start(nodes: StorageNode[]) {
		this.draggingNodes = nodes;
	}

	end() {
		this.draggingNodes = [];
	}

	notifyChanged() {
		this.version += 1;
	}
}

export const dragStore = new DragStore();
