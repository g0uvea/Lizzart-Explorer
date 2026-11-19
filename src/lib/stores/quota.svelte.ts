class QuotaStore {
	usedBytes = $state(0);
	quotaBytes = $state(10 * 1024 * 1024 * 1024);

	sync(used: number, quota: number) {
		this.usedBytes = used;
		this.quotaBytes = quota;
	}
}

export const quotaStore = new QuotaStore();
