class QuotaStore {
	usedBytes = $state(0);
	quotaBytes = $state(0);
	hasWorkspace = $state(false);
	workspaceName = $state('');

	sync(used: number, quota: number, workspaceName = '') {
		this.usedBytes = used;
		this.quotaBytes = quota;
		this.hasWorkspace = true;
		this.workspaceName = workspaceName;
	}

	clear() {
		this.usedBytes = 0;
		this.quotaBytes = 0;
		this.hasWorkspace = false;
		this.workspaceName = '';
	}
}

export const quotaStore = new QuotaStore();
