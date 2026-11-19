export interface ToastItem {
	id: string;
	type: 'success' | 'error' | 'info' | 'warning';
	message: string;
}

class ToastStore {
	items = $state<ToastItem[]>([]);

	push(message: string, type: ToastItem['type'] = 'info', duration = 3800) {
		const id = Math.random().toString(36).slice(2);
		this.items = [...this.items, { id, type, message }];
		setTimeout(() => {
			this.dismiss(id);
		}, duration);
	}

	success(message: string) {
		this.push(message, 'success');
	}

	error(message: string) {
		this.push(message, 'error', 5000);
	}

	info(message: string) {
		this.push(message, 'info');
	}

	warning(message: string) {
		this.push(message, 'warning', 4500);
	}

	dismiss(id: string) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toast = new ToastStore();
