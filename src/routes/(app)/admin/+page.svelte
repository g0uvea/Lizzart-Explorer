<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import type {
		AuditLogRecord,
		BackupRecord,
		PerformanceMode,
		PerformanceProfileInfo,
		PerformanceTelemetry,
		SafeUser,
		SystemSettings,
		WorkspaceAdminRecord,
		WorkspaceRole
	} from '$lib/types';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatBytes, formatDate, getInitials } from '$lib/utils';
	import {
		Users,
		HardDrive,
		FileStack,
		Link2,
		UserPlus,
		Shield,
		Activity,
		Settings,
		Pencil,
		Trash2,
		X,
		Save,
		RefreshCw,
		Smartphone,
		Database,
		FolderCog,
		CheckCircle2,
		Layers,
		Plus,
		UserCheck,
		Gauge,
		Cpu,
		MemoryStick,
		Zap,
		Archive,
		Download,
		Upload,
		RotateCcw
	} from 'lucide-svelte';

	let { data } = $props();

	type AdminTab = 'workspaces' | 'users' | 'performance' | 'backups' | 'settings' | 'audit';
	let tab = $state<AdminTab>('workspaces');
	let loading = $state(true);

	let stats = $state({
		total_users: 0,
		admin_count: 0,
		active_count: 0,
		total_workspaces: 0,
		active_workspaces: 0,
		total_used_bytes: 0,
		total_files: 0,
		total_folders: 0,
		trashed_items: 0,
		active_links: 0,
		total_downloads: 0,
		storage_root: ''
	});
	let users = $state<SafeUser[]>([]);
	let workspaces = $state<WorkspaceAdminRecord[]>([]);
	let auditLogs = $state<AuditLogRecord[]>([]);
	let settings = $state<SystemSettings>({
		default_quota_gb: 10,
		max_upload_mb: 10240,
		performance_mode: 'optimized',
		auto_backup_interval: 'off',
		backup_retention_count: 10
	});

	// Performance profiles & telemetry
	let perfProfiles = $state<PerformanceProfileInfo[]>([]);
	let perfTelemetry = $state<PerformanceTelemetry | null>(null);
	let perfBusy = $state(false);

	// Backups state
	let backups = $state<BackupRecord[]>([]);
	let backupsBusy = $state(false);
	let restoringBackup = $state(false);
	let backupFileInput = $state<HTMLInputElement | null>(null);

	// Disk & MariaDB storage configuration
	let diskPath = $state('./storage');
	let diskResolved = $state('');
	let diskFreeBytes = $state<number | null>(null);
	let diskTotalBytes = $state<number | null>(null);
	let migrateFiles = $state(true);
	let diskBusy = $state(false);

	let dbHost = $state('127.0.0.1');
	let dbPort = $state(3306);
	let dbUser = $state('root');
	let dbPassword = $state('');
	let dbHasPassword = $state(false);
	let dbKeepPassword = $state(true);
	let dbName = $state('lizzart_explorer');
	let dbBusy = $state(false);
	let dbTestVersion = $state<string | null>(null);

	// Create user modal (decoupled from quota & workspaces)
	let showCreateUserModal = $state(false);
	let newUsername = $state('');
	let newFirstName = $state('');
	let newLastName = $state('');
	let newPassword = $state('');
	let newRole = $state<'user' | 'admin'>('user');

	// Edit user modal
	let editUser = $state<SafeUser | null>(null);
	let editFirstName = $state('');
	let editLastName = $state('');
	let editRole = $state<'user' | 'admin'>('user');
	let editActive = $state(true);
	let editNewPass = $state('');
	let editReset2fa = $state(false);

	// Create workspace modal
	const WS_COLORS = ['#10b981', '#0ea5e9', '#6366f1', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444'];
	let showCreateWsModal = $state(false);
	let wsName = $state('');
	let wsDesc = $state('');
	let wsColor = $state('#10b981');
	let wsQuotaGb = $state(25);
	let wsUnlimited = $state(false);

	// Edit workspace modal
	let editWs = $state<WorkspaceAdminRecord | null>(null);
	let editWsName = $state('');
	let editWsDesc = $state('');
	let editWsColor = $state('#10b981');
	let editWsQuotaGb = $state(25);
	let editWsUnlimited = $state(false);
	let editWsActive = $state(true);

	// Manage Workspace Members modal
	let membersWs = $state<WorkspaceAdminRecord | null>(null);
	let connectUserId = $state('');
	let connectRole = $state<WorkspaceRole>('editor');
	let memberBusy = $state(false);

	let savingSettings = $state(false);

	function roleLabel(role: WorkspaceRole): string {
		if (role === 'manager') return 'Gestor';
		if (role === 'editor') return 'Editor';
		return 'Leitor';
	}

	async function loadOverview() {
		loading = true;
		try {
			const [ovRes, cfgRes, bkRes] = await Promise.all([
				fetch('/api/admin/overview'),
				fetch('/api/admin/storage-config'),
				fetch('/api/admin/backups')
			]);
			const payload = await ovRes.json();
			if (!ovRes.ok) {
				toast.error(payload.error || 'Erro ao carregar painel administrativo.');
				return;
			}
			stats = payload.stats;
			users = payload.users;
			workspaces = payload.workspaces || [];
			auditLogs = payload.auditLogs;
			settings = payload.settings;
			wsQuotaGb = Math.max(10, payload.settings.default_quota_gb);
			if (payload.performance) {
				perfProfiles = payload.performance.profiles || [];
				perfTelemetry = payload.performance.telemetry || null;
			}

			// Refresh open members modal reference if currently open
			if (membersWs) {
				membersWs = workspaces.find((w) => w.id === membersWs!.id) ?? null;
			}

			if (cfgRes.ok) {
				const cfg = await cfgRes.json();
				diskPath = cfg.disk.raw_path;
				diskResolved = cfg.disk.resolved_path;
				diskFreeBytes = cfg.disk.free_bytes;
				diskTotalBytes = cfg.disk.total_bytes;

				dbHost = cfg.database.host;
				dbPort = cfg.database.port;
				dbUser = cfg.database.user;
				dbName = cfg.database.database;
				dbHasPassword = cfg.database.has_password;
				dbKeepPassword = cfg.database.has_password;
				dbPassword = '';
			}

			if (bkRes.ok) {
				const bk = await bkRes.json();
				backups = bk.backups || [];
			}
		} finally {
			loading = false;
		}
	}

	onMount(loadOverview);

	// === WORKSPACES ===
	async function createWorkspace(e: SubmitEvent) {
		e.preventDefault();
		if (!wsUnlimited && wsQuotaGb < 10) {
			toast.error('A cota mínima de uma workspace é de 10 GB.');
			return;
		}
		const res = await fetch('/api/admin/workspaces', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: wsName,
				description: wsDesc,
				color: wsColor,
				quota_gb: wsQuotaGb,
				unlimited: wsUnlimited
			})
		});
		const payload = await res.json();
		if (!res.ok) {
			toast.error(payload.error || 'Falha ao criar workspace.');
			return;
		}
		toast.success(`Workspace "${payload.workspace.name}" criada! Agora conecte os usuários desejados.`);
		showCreateWsModal = false;
		wsName = '';
		wsDesc = '';
		wsColor = '#10b981';
		wsUnlimited = false;
		wsQuotaGb = Math.max(10, settings.default_quota_gb);
		await loadOverview();
		await invalidateAll();
	}

	function openEditWs(w: WorkspaceAdminRecord) {
		editWs = w;
		editWsName = w.name;
		editWsDesc = w.description || '';
		editWsColor = w.color;
		editWsUnlimited = w.quota_bytes < 0;
		editWsQuotaGb =
			w.quota_bytes < 0 ? 50 : Math.max(10, Math.round(w.quota_bytes / (1024 * 1024 * 1024)));
		editWsActive = w.is_active;
	}

	async function saveWsEdit(e: SubmitEvent) {
		e.preventDefault();
		if (!editWs) return;
		if (!editWsUnlimited && editWsQuotaGb < 10) {
			toast.error('A cota mínima permitida é de 10 GB.');
			return;
		}
		const res = await fetch(`/api/admin/workspaces/${editWs.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: editWsName,
				description: editWsDesc,
				color: editWsColor,
				quota_gb: editWsUnlimited ? -1 : editWsQuotaGb,
				is_active: editWsActive
			})
		});
		const payload = await res.json();
		if (!res.ok) {
			toast.error(payload.error || 'Falha ao atualizar workspace.');
			return;
		}
		toast.success('Workspace atualizada!');
		editWs = null;
		await loadOverview();
		await invalidateAll();
	}

	async function deleteWorkspace(w: WorkspaceAdminRecord) {
		if (
			!confirm(
				`EXCLUIR permanentemente a workspace "${w.name}" e seus ${w.file_count} arquivo(s) (${formatBytes(w.used_bytes)})? Esta ação não pode ser desfeita.`
			)
		) {
			return;
		}
		const res = await fetch(`/api/admin/workspaces/${w.id}`, { method: 'DELETE' });
		const payload = await res.json();
		if (!res.ok) {
			toast.error(payload.error || 'Falha ao excluir workspace.');
			return;
		}
		toast.success(`Workspace "${w.name}" excluída.`);
		await loadOverview();
		await invalidateAll();
	}

	function openMembersModal(w: WorkspaceAdminRecord) {
		membersWs = w;
		connectUserId = '';
		connectRole = 'editor';
	}

	async function connectMember(e: SubmitEvent) {
		e.preventDefault();
		if (!membersWs || !connectUserId) return;
		memberBusy = true;
		try {
			const res = await fetch(`/api/admin/workspaces/${membersWs.id}/members`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ user_id: connectUserId, role: connectRole })
			});
			const payload = await res.json();
			if (!res.ok) {
				toast.error(payload.error || 'Erro ao conectar usuário.');
				return;
			}
			toast.success('Usuário conectado à workspace!');
			connectUserId = '';
			await loadOverview();
			await invalidateAll();
		} finally {
			memberBusy = false;
		}
	}

	async function updateMemberRole(wsId: string, userId: string, role: WorkspaceRole) {
		const res = await fetch(`/api/admin/workspaces/${wsId}/members`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ user_id: userId, role })
		});
		if (res.ok) {
			toast.success('Permissão na workspace atualizada!');
			await loadOverview();
			await invalidateAll();
		}
	}

	async function disconnectMember(wsId: string, userId: string, username: string) {
		if (
			!confirm(
				`Desconectar @${username} desta workspace? Nenhum arquivo será excluído.`
			)
		) {
			return;
		}
		const res = await fetch(
			`/api/admin/workspaces/${wsId}/members?userId=${encodeURIComponent(userId)}`,
			{ method: 'DELETE' }
		);
		if (res.ok) {
			toast.info(`@${username} desconectado da workspace.`);
			await loadOverview();
			await invalidateAll();
		}
	}

	// === USERS ===
	async function createUser(e: SubmitEvent) {
		e.preventDefault();
		const res = await fetch('/api/admin/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: newUsername,
				first_name: newFirstName,
				last_name: newLastName,
				password: newPassword,
				role: newRole
			})
		});
		const payload = await res.json();
		if (!res.ok) {
			toast.error(payload.error || 'Falha ao criar usuário.');
			return;
		}
		toast.success(`Usuário @${payload.username} criado (sem workspace conectada)!`);
		showCreateUserModal = false;
		newUsername = '';
		newFirstName = '';
		newLastName = '';
		newPassword = '';
		newRole = 'user';
		await loadOverview();
	}

	function openEditUser(u: SafeUser) {
		editUser = u;
		editFirstName = u.first_name;
		editLastName = u.last_name;
		editRole = u.role;
		editActive = u.is_active;
		editNewPass = '';
		editReset2fa = false;
	}

	async function saveUserEdit(e: SubmitEvent) {
		e.preventDefault();
		if (!editUser) return;
		const res = await fetch(`/api/admin/users/${editUser.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				first_name: editFirstName,
				last_name: editLastName,
				role: editRole,
				is_active: editActive,
				new_password: editNewPass.trim() ? editNewPass.trim() : undefined,
				reset_2fa: editReset2fa || undefined
			})
		});
		const payload = await res.json();
		if (!res.ok) {
			toast.error(payload.error || 'Falha ao atualizar usuário.');
			return;
		}
		toast.success('Usuário atualizado!');
		editUser = null;
		await loadOverview();
	}

	async function deleteUser(u: SafeUser) {
		if (
			!confirm(
				`Excluir a conta @${u.username} (${u.full_name})?\n\nTodas as workspaces e arquivos permanecerão 100% preservados.`
			)
		) {
			return;
		}
		const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
		const payload = await res.json();
		if (!res.ok) {
			toast.error(payload.error || 'Não foi possível excluir usuário.');
			return;
		}
		toast.success('Usuário excluído. Workspaces e arquivos mantidos intactos!');
		await loadOverview();
	}

	// === PERFORMANCE ===
	async function selectPerformanceMode(mode: PerformanceMode) {
		perfBusy = true;
		try {
			const res = await fetch('/api/admin/performance', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mode })
			});
			const payload = await res.json();
			if (!res.ok) {
				toast.error(payload.error || 'Erro ao aplicar perfil de desempenho.');
				return;
			}
			settings.performance_mode = mode;
			perfTelemetry = payload.telemetry;
			toast.success(`Perfil alterado para "${payload.profile.label}" com aplicação imediata!`);
			await invalidateAll();
		} finally {
			perfBusy = false;
		}
	}

	async function refreshTelemetry() {
		const res = await fetch('/api/admin/performance');
		if (res.ok) {
			const d = await res.json();
			perfProfiles = d.profiles;
			perfTelemetry = d.telemetry;
		}
	}

	// === BACKUPS ===
	async function createBackup(compress: boolean) {
		backupsBusy = true;
		try {
			const res = await fetch('/api/admin/backups', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ compress })
			});
			const payload = await res.json();
			if (!res.ok) {
				toast.error(payload.error || 'Falha ao gerar backup.');
				return;
			}
			toast.success(`Backup criado: ${payload.backup.file_name} (${formatBytes(payload.backup.size_bytes)})`);
			await loadOverview();
		} finally {
			backupsBusy = false;
		}
	}

	async function deleteBackup(b: BackupRecord) {
		if (!confirm(`Remover o arquivo de backup "${b.file_name}"?`)) return;
		const res = await fetch(`/api/admin/backups/${b.id}`, { method: 'DELETE' });
		if (res.ok) {
			toast.info('Backup removido.');
			await loadOverview();
		}
	}

	async function restoreBackupById(b: BackupRecord) {
		if (
			!confirm(
				`Restaurar o banco de dados a partir de "${b.file_name}"?\n\nUm snapshot automático de segurança será criado antes da restauração.`
			)
		) {
			return;
		}
		restoringBackup = true;
		try {
			const res = await fetch('/api/admin/backups/restore', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ backupId: b.id })
			});
			const payload = await res.json();
			if (!res.ok) {
				toast.error(payload.error || 'Erro ao restaurar backup.');
				return;
			}
			toast.success(`Banco restaurado! Snapshot de segurança salvo: ${payload.safetyBackupFile}`);
			await loadOverview();
			await invalidateAll();
		} finally {
			restoringBackup = false;
		}
	}

	async function handleBackupUploadRestore(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		input.value = '';
		if (
			!confirm(
				`Restaurar o banco MariaDB usando o arquivo enviado "${file.name}"?\n\nUm snapshot de segurança será criado automaticamente antes.`
			)
		) {
			return;
		}
		restoringBackup = true;
		try {
			const form = new FormData();
			form.append('backup', file);
			const res = await fetch('/api/admin/backups/restore', { method: 'POST', body: form });
			const payload = await res.json();
			if (!res.ok) {
				toast.error(payload.error || 'Erro ao restaurar arquivo.');
				return;
			}
			toast.success(`Banco restaurado com sucesso! Segurança: ${payload.safetyBackupFile}`);
			await loadOverview();
			await invalidateAll();
		} finally {
			restoringBackup = false;
		}
	}

	async function saveBackupPolicy(e: SubmitEvent) {
		e.preventDefault();
		savingSettings = true;
		try {
			const res = await fetch('/api/admin/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					auto_backup_interval: settings.auto_backup_interval,
					backup_retention_count: settings.backup_retention_count
				})
			});
			if (res.ok) {
				toast.success('Política de backup automático salva!');
			} else {
				const d = await res.json();
				toast.error(d.error || 'Erro ao salvar política.');
			}
		} finally {
			savingSettings = false;
		}
	}

	// === STORAGE & DB ===
	async function testDiskPath() {
		diskBusy = true;
		try {
			const res = await fetch('/api/admin/storage-config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'test-disk', storage_root: diskPath })
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error || 'Diretório inválido.');
				return;
			}
			diskResolved = data.resolved_path;
			diskFreeBytes = data.free_bytes;
			diskTotalBytes = data.total_bytes;
			toast.success(`Diretório gravável: ${data.resolved_path}`);
		} finally {
			diskBusy = false;
		}
	}

	async function saveDiskPath(e: SubmitEvent) {
		e.preventDefault();
		diskBusy = true;
		try {
			const res = await fetch('/api/admin/storage-config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'save-disk',
					storage_root: diskPath,
					migrate: migrateFiles
				})
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error || 'Erro ao aplicar diretório.');
				return;
			}
			diskResolved = data.resolved_path;
			diskFreeBytes = data.free_bytes;
			diskTotalBytes = data.total_bytes;
			toast.success(
				migrateFiles && data.migrated_count > 0
					? `Diretório alterado e ${data.migrated_count} arquivo(s) migrado(s)!`
					: 'Local de armazenamento atualizado!'
			);
			await loadOverview();
		} finally {
			diskBusy = false;
		}
	}

	async function testDbConn() {
		dbBusy = true;
		dbTestVersion = null;
		try {
			const res = await fetch('/api/admin/storage-config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'test-db',
					host: dbHost,
					port: dbPort,
					user: dbUser,
					password: dbPassword,
					keep_existing_password: dbKeepPassword
				})
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error || 'Falha ao conectar no MariaDB.');
				return;
			}
			dbTestVersion = data.version;
			toast.success(`Conexão bem-sucedida: ${data.version}`);
		} finally {
			dbBusy = false;
		}
	}

	async function saveDbConn(e: SubmitEvent) {
		e.preventDefault();
		if (!confirm(`Aplicar nova conexão MariaDB (${dbUser}@${dbHost}:${dbPort}/${dbName})?`)) {
			return;
		}
		dbBusy = true;
		try {
			const res = await fetch('/api/admin/storage-config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'save-db',
					host: dbHost,
					port: dbPort,
					user: dbUser,
					password: dbPassword,
					keep_existing_password: dbKeepPassword,
					database: dbName
				})
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data.error || 'Erro ao salvar conexão.');
				return;
			}
			toast.success(`Banco MariaDB atualizado (${data.version})!`);
			await loadOverview();
		} finally {
			dbBusy = false;
		}
	}

	async function saveSettings(e: SubmitEvent) {
		e.preventDefault();
		if (settings.default_quota_gb < 10) {
			toast.error('A cota padrão mínima para workspaces é de 10 GB.');
			return;
		}
		savingSettings = true;
		try {
			const res = await fetch('/api/admin/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					default_quota_gb: settings.default_quota_gb,
					max_upload_mb: settings.max_upload_mb
				})
			});
			const d = await res.json();
			if (res.ok) {
				toast.success('Políticas globais salvas!');
				await loadOverview();
			} else {
				toast.error(d.error || 'Erro ao salvar configurações.');
			}
		} finally {
			savingSettings = false;
		}
	}
</script>

<svelte:head>
	<title>Painel Admin — Lizzart Explorer</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl p-3.5 sm:p-6 lg:p-8">
	<!-- Header -->
	<div class="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between">
		<div class="min-w-0">
			<h1 class="text-xl font-bold text-white sm:text-2xl">Painel Administrativo</h1>
			<p class="mt-1 text-xs text-slate-400 sm:text-sm">
				Workspaces independentes, usuários, perfis de desempenho, backups do MariaDB e infraestrutura.
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<button
				type="button"
				onclick={loadOverview}
				class="inline-flex items-center gap-1.5 rounded-xl border border-[#233047] bg-[#131c2e] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-[#19253c]"
			>
				<RefreshCw class="h-3.5 w-3.5" />
				Atualizar
			</button>
			<button
				type="button"
				onclick={() => (showCreateWsModal = true)}
				class="inline-flex items-center gap-1.5 rounded-xl border border-accent-500/40 bg-accent-500/15 px-3.5 py-2 text-xs font-semibold text-accent-300 hover:bg-accent-500/25"
			>
				<Layers class="h-3.5 w-3.5" />
				Nova Workspace
			</button>
			<button
				type="button"
				onclick={() => (showCreateUserModal = true)}
				class="inline-flex items-center gap-1.5 rounded-xl bg-accent-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-accent-600/25 hover:bg-accent-500"
			>
				<UserPlus class="h-3.5 w-3.5" />
				Novo Usuário
			</button>
		</div>
	</div>

	<!-- KPI Cards -->
	<div class="mb-5 grid grid-cols-2 gap-2.5 sm:mb-6 sm:gap-4 lg:grid-cols-4">
		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-3.5 sm:p-5">
			<div class="flex items-center justify-between gap-2">
				<span class="truncate text-xs font-medium text-slate-400">Workspaces</span>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400">
					<Layers class="h-4 w-4" />
				</div>
			</div>
			<p class="mt-2 text-xl font-bold text-white sm:text-2xl">{stats.total_workspaces}</p>
			<p class="mt-0.5 truncate text-[11px] text-slate-500">{stats.active_workspaces} ativas • {stats.total_users} contas</p>
		</div>

		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-3.5 sm:p-5">
			<div class="flex items-center justify-between gap-2">
				<span class="truncate text-xs font-medium text-slate-400">Em Disco</span>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400">
					<HardDrive class="h-4 w-4" />
				</div>
			</div>
			<p class="mt-2 text-xl font-bold text-white sm:text-2xl">{formatBytes(stats.total_used_bytes)}</p>
			<p class="mt-0.5 truncate font-mono text-[10px] text-slate-500" title={stats.storage_root}>
				{stats.storage_root || './storage'}
			</p>
		</div>

		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-3.5 sm:p-5">
			<div class="flex items-center justify-between gap-2">
				<span class="truncate text-xs font-medium text-slate-400">Arquivos</span>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
					<FileStack class="h-4 w-4" />
				</div>
			</div>
			<p class="mt-2 text-xl font-bold text-white sm:text-2xl">{stats.total_files}</p>
			<p class="mt-0.5 truncate text-[11px] text-slate-500">{stats.total_folders} pastas • {stats.trashed_items} lixeira</p>
		</div>

		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-3.5 sm:p-5">
			<div class="flex items-center justify-between gap-2">
				<span class="truncate text-xs font-medium text-slate-400">Links Públicos</span>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
					<Link2 class="h-4 w-4" />
				</div>
			</div>
			<p class="mt-2 text-xl font-bold text-white sm:text-2xl">{stats.active_links}</p>
			<p class="mt-0.5 truncate text-[11px] text-slate-500">{stats.total_downloads} downloads</p>
		</div>
	</div>

	<!-- Scrollable Tabs Bar -->
	<div class="no-scrollbar mb-5 flex gap-1 overflow-x-auto border-b border-[#1a253a]">
		<button
			type="button"
			onclick={() => (tab = 'workspaces')}
			class="inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition sm:px-4 sm:py-3 sm:text-sm {tab === 'workspaces'
				? 'border-accent-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<Layers class="h-4 w-4" />
			Workspaces ({workspaces.length})
		</button>
		<button
			type="button"
			onclick={() => (tab = 'users')}
			class="inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition sm:px-4 sm:py-3 sm:text-sm {tab === 'users'
				? 'border-accent-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<Users class="h-4 w-4" />
			Usuários ({users.length})
		</button>
		<button
			type="button"
			onclick={() => {
				tab = 'performance';
				refreshTelemetry();
			}}
			class="inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition sm:px-4 sm:py-3 sm:text-sm {tab === 'performance'
				? 'border-accent-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<Gauge class="h-4 w-4" />
			Desempenho
		</button>
		<button
			type="button"
			onclick={() => (tab = 'backups')}
			class="inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition sm:px-4 sm:py-3 sm:text-sm {tab === 'backups'
				? 'border-accent-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<Archive class="h-4 w-4" />
			Backups DB ({backups.length})
		</button>
		<button
			type="button"
			onclick={() => (tab = 'settings')}
			class="inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition sm:px-4 sm:py-3 sm:text-sm {tab === 'settings'
				? 'border-accent-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<Settings class="h-4 w-4" />
			Infra & Banco
		</button>
		<button
			type="button"
			onclick={() => (tab = 'audit')}
			class="inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition sm:px-4 sm:py-3 sm:text-sm {tab === 'audit'
				? 'border-accent-500 text-white'
				: 'border-transparent text-slate-400 hover:text-slate-200'}"
		>
			<Activity class="h-4 w-4" />
			Auditoria
		</button>
	</div>

	{#if loading}
		<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-12 text-center text-sm text-slate-400">
			Carregando dados do MariaDB...
		</div>

	<!-- ==================== TAB 1: WORKSPACES ==================== -->
	{:else if tab === 'workspaces'}
		{#if workspaces.length === 0}
			<div class="rounded-2xl border border-dashed border-[#233047] bg-[#0e1525] px-4 py-14 text-center">
				<Layers class="mx-auto mb-3 h-10 w-10 text-accent-400" />
				<h2 class="text-base font-semibold text-white">Nenhuma Workspace criada ainda</h2>
				<p class="mx-auto mt-1 max-w-md text-xs text-slate-400">
					Workspaces armazenam arquivos e cotas separadamente das contas de usuário. Você pode conectar 1 ou vários usuários à mesma workspace e remover contas sem nunca perder arquivos.
				</p>
				<button
					type="button"
					onclick={() => (showCreateWsModal = true)}
					class="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-accent-500"
				>
					<Plus class="h-4 w-4" />
					Criar Primeira Workspace
				</button>
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				{#each workspaces as ws (ws.id)}
					{@const pct =
						ws.quota_bytes < 0
							? ws.used_bytes > 0
								? 15
								: 0
							: ws.quota_bytes > 0
								? Math.min(100, Math.round((ws.used_bytes / ws.quota_bytes) * 100))
								: 0}
					<div class="flex flex-col justify-between rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-4 sm:p-5">
						<div>
							<div class="flex items-start justify-between gap-2">
								<div class="flex min-w-0 items-center gap-3">
									<div
										class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow"
										style="background-color: {ws.color}"
									>
										<Layers class="h-5 w-5" />
									</div>
									<div class="min-w-0">
										<div class="flex flex-wrap items-center gap-2">
											<h3 class="truncate text-sm font-bold text-white sm:text-base">{ws.name}</h3>
											{#if !ws.is_active}
												<span class="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
													Suspensa
												</span>
											{/if}
										</div>
										<p class="truncate text-xs text-slate-400">
											{ws.description || `/${ws.slug}`}
										</p>
									</div>
								</div>

								<div class="flex shrink-0 items-center gap-1">
									<button
										type="button"
										onclick={() => openEditWs(ws)}
										class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white"
										title="Editar workspace e cota"
									>
										<Pencil class="h-4 w-4" />
									</button>
									<button
										type="button"
										onclick={() => deleteWorkspace(ws)}
										class="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
										title="Excluir workspace"
									>
										<Trash2 class="h-4 w-4" />
									</button>
								</div>
							</div>

							<!-- Quota Bar -->
							<div class="mt-4 rounded-xl border border-[#1d2a42] bg-[#0b101b] p-3">
								<div class="mb-1.5 flex items-center justify-between text-xs">
									<span class="text-slate-400">Cota da Workspace</span>
									<span class="font-mono text-[11px] font-semibold text-slate-200">
										{formatBytes(ws.used_bytes)} / {formatBytes(ws.quota_bytes)}
									</span>
								</div>
								<div class="h-1.5 w-full overflow-hidden rounded-full bg-[#131c2e]">
									<div
										class="h-full rounded-full transition-all"
										style="width: {pct}%; background-color: {ws.color}"
									></div>
								</div>
								<p class="mt-1.5 text-[11px] text-slate-500">
									{ws.file_count} arquivo(s) • {ws.folder_count} pasta(s) • {ws.member_count} usuário(s) conectado(s)
								</p>
							</div>

							<!-- Connected Members Chips -->
							<div class="mt-3">
								<p class="mb-1.5 text-[11px] font-medium text-slate-400">Usuários conectados:</p>
								{#if ws.members.length === 0}
									<p class="text-xs italic text-slate-500">Nenhum usuário conectado ainda.</p>
								{:else}
									<div class="flex flex-wrap gap-1.5">
										{#each ws.members as m (m.id)}
											<span class="inline-flex items-center gap-1.5 rounded-full border border-[#233047] bg-[#0e1525] px-2.5 py-1 text-[11px] text-slate-200">
												<span class="font-mono text-accent-300">@{m.username}</span>
												<span class="rounded bg-[#1a263e] px-1.5 py-0.2 text-[10px] text-slate-400">
													{roleLabel(m.role)}
												</span>
											</span>
										{/each}
									</div>
								{/if}
							</div>
						</div>

						<div class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#1f2d45] pt-3.5">
							<span class="font-mono text-[10px] text-slate-500">Criada em {formatDate(ws.created_at)}</span>
							<button
								type="button"
								onclick={() => openMembersModal(ws)}
								class="inline-flex items-center gap-1.5 rounded-xl bg-accent-600/20 px-3 py-1.5 text-xs font-semibold text-accent-300 ring-1 ring-accent-500/30 hover:bg-accent-600/30"
							>
								<UserCheck class="h-3.5 w-3.5" />
								Conectar / Gerenciar Usuários
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}

	<!-- ==================== TAB 2: USERS ==================== -->
	{:else if tab === 'users'}
		<div class="overflow-x-auto rounded-2xl border border-[#1f2d45] bg-[#131c2e]">
			<table class="w-full text-left text-sm">
				<thead class="border-b border-[#1f2d45] bg-[#0e1525] text-xs uppercase tracking-wider text-slate-400">
					<tr>
						<th class="px-4 py-3.5 sm:px-5">Usuário</th>
						<th class="px-3 py-3.5">Cargo</th>
						<th class="px-3 py-3.5">Workspaces Conectadas</th>
						<th class="hidden px-3 py-3.5 sm:table-cell">2FA</th>
						<th class="hidden px-3 py-3.5 md:table-cell">Status</th>
						<th class="px-4 py-3.5 text-right sm:px-5">Ações</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[#1a253a]">
					{#each users as u (u.id)}
						<tr class="hover:bg-[#182338]">
							<td class="px-4 py-3.5 sm:px-5">
								<div class="flex items-center gap-3">
									{#if u.avatar_url}
										<img src={u.avatar_url} alt={u.full_name} class="h-9 w-9 shrink-0 rounded-full object-cover" />
									{:else}
										<div
											class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
											style="background-color: {u.avatar_color}"
										>
											{getInitials(u.full_name)}
										</div>
									{/if}
									<div class="min-w-0">
										<p class="truncate font-medium text-white">{u.full_name}</p>
										<p class="truncate font-mono text-xs text-slate-400">@{u.username}</p>
									</div>
								</div>
							</td>
							<td class="whitespace-nowrap px-3 py-3.5">
								<span
									class="rounded-full px-2.5 py-0.5 text-xs font-semibold {u.role === 'admin'
										? 'bg-accent-500/20 text-accent-300'
										: 'bg-slate-700/50 text-slate-300'}"
								>
									{u.role === 'admin' ? 'Admin' : 'Usuário'}
								</span>
							</td>
							<td class="px-3 py-3.5">
								{#if u.workspaces && u.workspaces.length > 0}
									<div class="flex flex-wrap gap-1">
										{#each u.workspaces as w (w.id)}
											<span class="inline-flex items-center gap-1 rounded-full border border-[#233047] bg-[#0e1525] px-2 py-0.5 text-[11px] text-slate-200">
												<span class="h-2 w-2 rounded-full" style="background-color: {w.color}"></span>
												<span class="max-w-[120px] truncate">{w.name}</span>
											</span>
										{/each}
									</div>
								{:else}
									<span class="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
										Sem workspace
									</span>
								{/if}
							</td>
							<td class="hidden px-3 py-3.5 sm:table-cell">
								{#if u.totp_enabled}
									<span class="inline-flex items-center gap-1 rounded-full bg-accent-500/15 px-2 py-0.5 text-[11px] font-medium text-accent-300">
										<Smartphone class="h-3 w-3" /> Ativo
									</span>
								{:else}
									<span class="text-xs text-slate-500">—</span>
								{/if}
							</td>
							<td class="hidden px-3 py-3.5 md:table-cell">
								<span
									class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium {u.is_active
										? 'bg-accent-500/15 text-accent-300'
										: 'bg-rose-500/15 text-rose-300'}"
								>
									<span class="h-1.5 w-1.5 rounded-full {u.is_active ? 'bg-accent-400' : 'bg-rose-400'}"></span>
									{u.is_active ? 'Ativo' : 'Suspenso'}
								</span>
							</td>
							<td class="px-4 py-3.5 sm:px-5">
								<div class="flex justify-end gap-1.5">
									<button
										type="button"
										onclick={() => openEditUser(u)}
										class="rounded-lg p-1.5 text-slate-400 hover:bg-[#22304c] hover:text-white"
										title="Editar conta"
									>
										<Pencil class="h-4 w-4" />
									</button>
									{#if u.id !== data.user.id}
										<button
											type="button"
											onclick={() => deleteUser(u)}
											class="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
											title="Excluir conta (workspaces permanecem intactas)"
										>
											<Trash2 class="h-4 w-4" />
										</button>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

	<!-- ==================== TAB 3: PERFORMANCE PROFILES ==================== -->
	{:else if tab === 'performance'}
		<div class="space-y-5">
			{#if perfTelemetry}
				<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
					<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-4">
						<div class="flex items-center justify-between text-xs text-slate-400">
							<span>Memória Processo</span>
							<MemoryStick class="h-4 w-4 text-accent-400" />
						</div>
						<p class="mt-2 font-mono text-lg font-bold text-white sm:text-xl">{perfTelemetry.rssMb} MB</p>
						<p class="mt-0.5 text-[11px] text-slate-500">Heap: {perfTelemetry.heapUsedMb} / {perfTelemetry.heapTotalMb} MB</p>
					</div>

					<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-4">
						<div class="flex items-center justify-between text-xs text-slate-400">
							<span>CPU & Carga</span>
							<Cpu class="h-4 w-4 text-sky-400" />
						</div>
						<p class="mt-2 font-mono text-lg font-bold text-white sm:text-xl">{perfTelemetry.loadAvg1m}</p>
						<p class="mt-0.5 text-[11px] text-slate-500">{perfTelemetry.cpuCores} núcleo(s) • Uptime {Math.floor(perfTelemetry.uptimeSeconds / 60)}m</p>
					</div>

					<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-4">
						<div class="flex items-center justify-between text-xs text-slate-400">
							<span>Cache TTL/LRU</span>
							<Zap class="h-4 w-4 text-amber-400" />
						</div>
						<p class="mt-2 font-mono text-lg font-bold text-white sm:text-xl">{perfTelemetry.cacheHitRatePct}% hit</p>
						<p class="mt-0.5 text-[11px] text-slate-500">{perfTelemetry.cacheEntries} / {perfTelemetry.cacheMaxEntries} entradas</p>
					</div>

					<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-4">
						<div class="flex items-center justify-between text-xs text-slate-400">
							<span>Pool DB & I/O</span>
							<Gauge class="h-4 w-4 text-emerald-400" />
						</div>
						<p class="mt-2 font-mono text-lg font-bold text-white sm:text-xl">{perfTelemetry.dbConnectionLimit} conn</p>
						<p class="mt-0.5 text-[11px] text-slate-500">I/O ativo: {perfTelemetry.activeIoSlots} / {perfTelemetry.maxIoSlots} slots</p>
					</div>
				</div>
			{/if}

			<div class="rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-4 sm:p-6">
				<div class="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#1f2d45] pb-3.5">
					<div>
						<h3 class="text-sm font-semibold text-white">Perfil de Execução da Aplicação</h3>
						<p class="text-xs text-slate-400">
							Ajusta em tempo real o pool do MariaDB, buffers de streaming, semáforo de I/O, cache de sessão, Argon2id e paralelismo do cliente.
						</p>
					</div>
					<button
						type="button"
						onclick={refreshTelemetry}
						class="inline-flex items-center gap-1.5 rounded-xl border border-[#233047] bg-[#0e1525] px-3 py-1.5 text-xs text-slate-300 hover:bg-[#19253c]"
					>
						<RefreshCw class="h-3.5 w-3.5" /> Atualizar Telemetria
					</button>
				</div>

				<div class="grid grid-cols-1 gap-3.5 md:grid-cols-2">
					{#each perfProfiles as prof (prof.mode)}
						{@const isSelected = settings.performance_mode === prof.mode}
						<button
							type="button"
							disabled={perfBusy}
							onclick={() => selectPerformanceMode(prof.mode)}
							class="flex flex-col justify-between rounded-2xl border p-4 text-left transition sm:p-5 {isSelected
								? 'border-accent-400 bg-accent-500/12 ring-2 ring-accent-500/30'
								: 'border-[#1f2d45] bg-[#0e1525] hover:border-[#2e4060] hover:bg-[#141f35]'}"
						>
							<div>
								<div class="flex flex-wrap items-center justify-between gap-2">
									<span class="text-sm font-bold text-white sm:text-base">{prof.label}</span>
									{#if isSelected}
										<span class="inline-flex items-center gap-1 rounded-full bg-accent-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
											<CheckCircle2 class="h-3 w-3" /> Ativo
										</span>
									{/if}
								</div>
								<p class="mt-0.5 text-xs font-medium text-accent-300">{prof.tagline}</p>
								<p class="mt-2 text-xs leading-relaxed text-slate-400">{prof.description}</p>
							</div>

							<div class="mt-4 grid grid-cols-2 gap-2 border-t border-[#1f2d45] pt-3 font-mono text-[11px] text-slate-300 sm:grid-cols-3">
								<div><span class="text-slate-500">Pool DB:</span> {prof.dbConnectionLimit}</div>
								<div><span class="text-slate-500">Buffer:</span> {prof.streamHighWaterMarkKb} KB</div>
								<div><span class="text-slate-500">I/O Max:</span> {prof.maxConcurrentIo}</div>
								<div><span class="text-slate-500">Cache:</span> {prof.metadataCacheMaxEntries}</div>
								<div><span class="text-slate-500">Argon2:</span> {prof.argon2MemoryMb} MB</div>
								<div><span class="text-slate-500">Fila UI:</span> {prof.clientMaxConcurrentTransfers}x</div>
							</div>
						</button>
					{/each}
				</div>
			</div>
		</div>

	<!-- ==================== TAB 4: DATABASE BACKUPS ==================== -->
	{:else if tab === 'backups'}
		<input
			bind:this={backupFileInput}
			type="file"
			accept=".sql,.gz,.sql.gz"
			class="hidden"
			onchange={handleBackupUploadRestore}
		/>

		<div class="space-y-5">
			<!-- Actions & Auto-backup policy -->
			<div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
				<div class="space-y-4 rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 lg:col-span-2">
					<div class="border-b border-[#1f2d45] pb-3">
						<h3 class="text-sm font-semibold text-white">Backup & Restauração do MariaDB</h3>
						<p class="text-xs text-slate-400">
							Gere snapshots consistentes com <code class="font-mono text-accent-300">mariadb-dump</code> (ou fallback SQL nativo), integridade SHA-256 e restauração segura com snapshot automático pré-restauração.
						</p>
					</div>

					<div class="flex flex-wrap gap-2.5">
						<button
							type="button"
							disabled={backupsBusy || restoringBackup}
							onclick={() => createBackup(true)}
							class="inline-flex items-center gap-2 rounded-xl bg-accent-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-accent-600/20 hover:bg-accent-500 disabled:opacity-50"
						>
							<Archive class="h-4 w-4" />
							{backupsBusy ? 'Gerando...' : 'Criar Backup Compactado (.sql.gz)'}
						</button>
						<button
							type="button"
							disabled={backupsBusy || restoringBackup}
							onclick={() => createBackup(false)}
							class="inline-flex items-center gap-2 rounded-xl border border-[#233047] bg-[#0e1525] px-4 py-2.5 text-xs font-medium text-slate-200 hover:bg-[#19253c] disabled:opacity-50"
						>
							<Database class="h-4 w-4 text-sky-400" />
							Criar Backup SQL (.sql)
						</button>
						<button
							type="button"
							disabled={backupsBusy || restoringBackup}
							onclick={() => backupFileInput?.click()}
							class="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
						>
							<Upload class="h-4 w-4" />
							{restoringBackup ? 'Restaurando...' : 'Restaurar via Arquivo'}
						</button>
					</div>
				</div>

				<form onsubmit={saveBackupPolicy} class="space-y-3 rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5">
					<h3 class="border-b border-[#1f2d45] pb-2.5 text-sm font-semibold text-white">
						Backup Automático
					</h3>
					<div>
						<label for="abint" class="mb-1 block text-xs text-slate-400">Frequência</label>
						<select
							id="abint"
							bind:value={settings.auto_backup_interval}
							class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-xs text-white outline-none focus:border-accent-500"
						>
							<option value="off">Desativado (Manual)</option>
							<option value="daily">Diário (24h)</option>
							<option value="weekly">Semanal (7 dias)</option>
						</select>
					</div>
					<div>
						<label for="abret" class="mb-1 block text-xs text-slate-400">Retenção máxima (arquivos)</label>
						<input
							id="abret"
							type="number"
							min="1"
							max="100"
							bind:value={settings.backup_retention_count}
							class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-xs text-white outline-none focus:border-accent-500"
						/>
					</div>
					<button
						type="submit"
						disabled={savingSettings}
						class="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
					>
						<Save class="h-3.5 w-3.5" /> Salvar Política
					</button>
				</form>
			</div>

			<!-- Backups List -->
			<div class="overflow-x-auto rounded-2xl border border-[#1f2d45] bg-[#131c2e]">
				{#if backups.length === 0}
					<div class="p-10 text-center text-xs text-slate-400">
						Nenhum backup salvo ainda. Clique em "Criar Backup Compactado" acima para gerar o primeiro.
					</div>
				{:else}
					<table class="w-full text-left text-xs">
						<thead class="border-b border-[#1f2d45] bg-[#0e1525] uppercase tracking-wider text-slate-400">
							<tr>
								<th class="px-4 py-3">Arquivo</th>
								<th class="px-3 py-3">Tamanho</th>
								<th class="hidden px-3 py-3 md:table-cell">Método</th>
								<th class="hidden px-3 py-3 lg:table-cell">SHA-256</th>
								<th class="hidden px-3 py-3 sm:table-cell">Data</th>
								<th class="px-4 py-3 text-right">Ações</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-[#1a253a]">
							{#each backups as b (b.id)}
								<tr class="hover:bg-[#182338]">
									<td class="px-4 py-3">
										<p class="font-mono font-medium text-white break-all">{b.file_name}</p>
										{#if !b.exists_on_disk}
											<span class="text-[10px] text-rose-400">Ausente no disco</span>
										{/if}
									</td>
									<td class="whitespace-nowrap px-3 py-3 font-mono text-slate-300">
										{formatBytes(b.size_bytes)}
									</td>
									<td class="hidden px-3 py-3 md:table-cell">
										<span class="rounded bg-[#0b101b] px-2 py-0.5 font-mono text-[10px] text-accent-300">
											{b.method}
										</span>
									</td>
									<td class="hidden px-3 py-3 font-mono text-[10px] text-slate-500 lg:table-cell" title={b.sha256}>
										{b.sha256.slice(0, 16)}…
									</td>
									<td class="hidden whitespace-nowrap px-3 py-3 text-slate-400 sm:table-cell">
										{formatDate(b.created_at)}
									</td>
									<td class="px-4 py-3">
										<div class="flex items-center justify-end gap-1.5">
											{#if b.exists_on_disk}
												<a
													href="/api/admin/backups/{b.id}"
													class="rounded-lg p-1.5 text-slate-300 hover:bg-[#22304c] hover:text-white"
													title="Baixar backup"
												>
													<Download class="h-4 w-4" />
												</a>
												<button
													type="button"
													disabled={restoringBackup}
													onclick={() => restoreBackupById(b)}
													class="rounded-lg p-1.5 text-amber-300 hover:bg-amber-500/15"
													title="Restaurar este backup"
												>
													<RotateCcw class="h-4 w-4" />
												</button>
											{/if}
											<button
												type="button"
												onclick={() => deleteBackup(b)}
												class="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
												title="Excluir backup"
											>
												<Trash2 class="h-4 w-4" />
											</button>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		</div>

	<!-- ==================== TAB 5: INFRA & DATABASE ==================== -->
	{:else if tab === 'settings'}
		<div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
			<!-- Local Disk Storage Path -->
			<form onsubmit={saveDiskPath} class="space-y-4 rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 sm:p-6">
				<div class="flex items-center gap-2.5 border-b border-[#1f2d45] pb-3.5">
					<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400">
						<FolderCog class="h-4 w-4" />
					</div>
					<div class="min-w-0">
						<h3 class="text-sm font-semibold text-white">Local dos Arquivos em Disco</h3>
						<p class="text-xs text-slate-400">Arquivos, avatares e backups são gravados diretamente neste diretório.</p>
					</div>
				</div>

				<div>
					<label for="diskp" class="mb-1.5 block text-xs font-medium text-slate-400">
						Caminho (<code class="font-mono text-accent-300">STORAGE_ROOT</code>)
					</label>
					<input
						id="diskp"
						type="text"
						required
						bind:value={diskPath}
						placeholder="Ex: /data/storage ou ./storage"
						class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 font-mono text-xs text-white outline-none focus:border-accent-500"
					/>
					{#if diskResolved}
						<p class="mt-1.5 break-all font-mono text-[11px] text-slate-500">
							Resolvido: <span class="text-slate-300">{diskResolved}</span>
						</p>
					{/if}
				</div>

				{#if diskFreeBytes !== null && diskTotalBytes !== null}
					<div class="rounded-xl border border-[#1f2d45] bg-[#0b101b] p-3 text-xs">
						<div class="flex flex-wrap items-center justify-between gap-2 text-slate-300">
							<span>Espaço livre no volume</span>
							<span class="font-mono font-semibold text-accent-300">
								{formatBytes(diskFreeBytes)} livre / {formatBytes(diskTotalBytes)}
							</span>
						</div>
					</div>
				{/if}

				<label class="flex items-center gap-2 text-xs text-slate-300">
					<input type="checkbox" bind:checked={migrateFiles} class="accent-accent-500" />
					Migrar arquivos, avatares e backups existentes para o novo diretório
				</label>

				<div class="flex flex-wrap gap-2 pt-1">
					<button
						type="button"
						disabled={diskBusy}
						onclick={testDiskPath}
						class="rounded-xl border border-[#233047] bg-[#0e1525] px-4 py-2 text-xs font-medium text-slate-200 hover:bg-[#19253c] disabled:opacity-50"
					>
						Testar Diretório
					</button>
					<button
						type="submit"
						disabled={diskBusy}
						class="inline-flex items-center gap-1.5 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
					>
						<Save class="h-3.5 w-3.5" />
						{diskBusy ? 'Aplicando...' : 'Salvar Local'}
					</button>
				</div>
			</form>

			<!-- MariaDB Connection -->
			<form onsubmit={saveDbConn} class="space-y-4 rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 sm:p-6">
				<div class="flex items-center gap-2.5 border-b border-[#1f2d45] pb-3.5">
					<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
						<Database class="h-4 w-4" />
					</div>
					<div class="min-w-0">
						<h3 class="text-sm font-semibold text-white">Banco de Dados MariaDB</h3>
						<p class="text-xs text-slate-400">Metadados, workspaces, sessões, auditoria e índice dos arquivos.</p>
					</div>
				</div>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
					<div class="sm:col-span-2">
						<label for="dbh" class="mb-1 block text-xs text-slate-400">Host / IP</label>
						<input id="dbh" type="text" required bind:value={dbHost} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 font-mono text-xs text-white outline-none focus:border-accent-500" />
					</div>
					<div>
						<label for="dbp" class="mb-1 block text-xs text-slate-400">Porta</label>
						<input id="dbp" type="number" required bind:value={dbPort} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 font-mono text-xs text-white outline-none focus:border-accent-500" />
					</div>
				</div>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div>
						<label for="dbu" class="mb-1 block text-xs text-slate-400">Usuário MariaDB</label>
						<input id="dbu" type="text" required bind:value={dbUser} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 font-mono text-xs text-white outline-none focus:border-accent-500" />
					</div>
					<div>
						<label for="dbn" class="mb-1 block text-xs text-slate-400">Nome do Banco</label>
						<input id="dbn" type="text" required bind:value={dbName} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 font-mono text-xs text-white outline-none focus:border-accent-500" />
					</div>
				</div>

				<div>
					<label for="dbpw" class="mb-1 block text-xs text-slate-400">Senha do Banco</label>
					<input
						id="dbpw"
						type="password"
						disabled={dbHasPassword && dbKeepPassword}
						bind:value={dbPassword}
						placeholder={dbHasPassword ? 'Mantendo senha atual...' : 'Sem senha (vazio)'}
						class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-xs text-white outline-none focus:border-accent-500 disabled:opacity-50"
					/>
					{#if dbHasPassword}
						<label class="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400">
							<input type="checkbox" bind:checked={dbKeepPassword} class="accent-accent-500" />
							Manter senha configurada atualmente
						</label>
					{/if}
				</div>

				{#if dbTestVersion}
					<div class="flex items-center gap-2 rounded-xl border border-accent-500/30 bg-accent-500/10 px-3 py-2 text-xs text-accent-200">
						<CheckCircle2 class="h-4 w-4 shrink-0 text-accent-400" />
						<span class="break-all">Conectado: <strong class="font-mono">{dbTestVersion}</strong></span>
					</div>
				{/if}

				<div class="flex flex-wrap gap-2 pt-1">
					<button
						type="button"
						disabled={dbBusy}
						onclick={testDbConn}
						class="rounded-xl border border-[#233047] bg-[#0e1525] px-4 py-2 text-xs font-medium text-slate-200 hover:bg-[#19253c] disabled:opacity-50"
					>
						Testar Conexão
					</button>
					<button
						type="submit"
						disabled={dbBusy}
						class="inline-flex items-center gap-1.5 rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
					>
						<Database class="h-3.5 w-3.5" />
						{dbBusy ? 'Reconectando...' : 'Salvar & Reconectar'}
					</button>
				</div>
			</form>

			<!-- Quotas & Upload Policies -->
			<form onsubmit={saveSettings} class="space-y-4 rounded-2xl border border-[#1f2d45] bg-[#131c2e] p-5 sm:p-6 lg:col-span-2">
				<div class="border-b border-[#1f2d45] pb-3">
					<h3 class="text-sm font-semibold text-white">Políticas Padrão de Workspaces & Upload</h3>
					<p class="text-xs text-slate-400">
						Blocos de upload operam entre 8 MB (padrão/instável) e 20 MB (somente rede ultra-rápida e estável).
					</p>
				</div>

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label for="defq" class="mb-1.5 block text-xs font-medium text-slate-400">
							Cota padrão p/ novas workspaces (GB — mín. 10)
						</label>
						<input
							id="defq"
							type="number"
							min="10"
							bind:value={settings.default_quota_gb}
							class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 text-sm text-white outline-none focus:border-accent-500"
						/>
					</div>
					<div>
						<label for="maxup" class="mb-1.5 block text-xs font-medium text-slate-400">
							Tamanho máximo por arquivo (MB)
						</label>
						<input
							id="maxup"
							type="number"
							min="10"
							bind:value={settings.max_upload_mb}
							class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2.5 text-sm text-white outline-none focus:border-accent-500"
						/>
					</div>
				</div>

				<button
					type="submit"
					disabled={savingSettings}
					class="inline-flex items-center gap-2 rounded-xl bg-accent-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
				>
					<Save class="h-4 w-4" />
					{savingSettings ? 'Salvando...' : 'Salvar Políticas'}
				</button>
			</form>
		</div>

	<!-- ==================== TAB 6: AUDIT LOGS ==================== -->
	{:else}
		<div class="overflow-x-auto rounded-2xl border border-[#1f2d45] bg-[#131c2e]">
			<table class="w-full text-left text-xs">
				<thead class="border-b border-[#1f2d45] bg-[#0e1525] uppercase tracking-wider text-slate-400">
					<tr>
						<th class="px-3.5 py-3 sm:px-4">Data</th>
						<th class="px-3 py-3">Usuário</th>
						<th class="px-3 py-3">Ação</th>
						<th class="px-3 py-3">Detalhes</th>
						<th class="hidden px-4 py-3 sm:table-cell">IP</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-[#1a253a]">
					{#each auditLogs as log (log.id)}
						<tr class="hover:bg-[#182338]">
							<td class="whitespace-nowrap px-3.5 py-3 text-slate-400 sm:px-4">{formatDate(log.created_at)}</td>
							<td class="whitespace-nowrap px-3 py-3 text-slate-200">{log.username ? `@${log.username}` : 'Sistema'}</td>
							<td class="whitespace-nowrap px-3 py-3">
								<code class="rounded bg-[#0b101b] px-2 py-0.5 font-mono text-[11px] {log.action.startsWith('security.') ? 'text-rose-300' : 'text-accent-300'}">
									{log.action}
								</code>
							</td>
							<td class="min-w-[180px] px-3 py-3 break-words text-slate-300">{log.details || '—'}</td>
							<td class="hidden whitespace-nowrap px-4 py-3 font-mono text-slate-500 sm:table-cell">{log.ip_address || '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- ==================== CREATE WORKSPACE MODAL ==================== -->
{#if showCreateWsModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
		<form
			onsubmit={createWorkspace}
			class="max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border border-[#233047] bg-[#131c2e] p-5 shadow-2xl sm:p-6"
		>
			<div class="flex items-center justify-between gap-2">
				<h3 class="text-base font-semibold text-white">Nova Workspace</h3>
				<button type="button" onclick={() => (showCreateWsModal = false)} class="text-slate-400 hover:text-white">
					<X class="h-4 w-4" />
				</button>
			</div>

			<div>
				<label for="wsn" class="mb-1 block text-xs text-slate-400">Nome da Workspace</label>
				<input id="wsn" type="text" required minlength={2} bind:value={wsName} placeholder="Ex: Financeiro, Engenharia, Home-NAS" class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-accent-500" />
			</div>

			<div>
				<label for="wsd" class="mb-1 block text-xs text-slate-400">Descrição (opcional)</label>
				<input id="wsd" type="text" bind:value={wsDesc} placeholder="Arquivos compartilhados da equipe..." class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-accent-500" />
			</div>

			<div>
				<span class="mb-1.5 block text-xs text-slate-400">Cor de Identificação</span>
				<div class="flex flex-wrap gap-2">
					{#each WS_COLORS as c (c)}
						<button
							type="button"
							onclick={() => (wsColor = c)}
							class="h-7 w-7 rounded-full transition {wsColor === c ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#131c2e]' : 'opacity-75 hover:opacity-100'}"
							style="background-color: {c}"
							aria-label="Cor {c}"
						></button>
					{/each}
				</div>
			</div>

			<div>
				<label for="wsq" class="mb-1 block text-xs text-slate-400">Cota de Armazenamento (GB — mín. 10)</label>
				<input id="wsq" type="number" min="10" disabled={wsUnlimited} bind:value={wsQuotaGb} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-accent-500 disabled:opacity-40" />
				<label class="mt-2 flex items-center gap-2 text-xs text-slate-300">
					<input type="checkbox" bind:checked={wsUnlimited} class="accent-accent-500" />
					Cota ilimitada
				</label>
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<button type="button" onclick={() => (showCreateWsModal = false)} class="rounded-xl border border-[#233047] px-4 py-2 text-xs text-slate-300">Cancelar</button>
				<button type="submit" class="rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500">Criar Workspace</button>
			</div>
		</form>
	</div>
{/if}

<!-- ==================== EDIT WORKSPACE MODAL ==================== -->
{#if editWs}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
		<form
			onsubmit={saveWsEdit}
			class="max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border border-[#233047] bg-[#131c2e] p-5 shadow-2xl sm:p-6"
		>
			<div class="flex items-center justify-between gap-2">
				<h3 class="truncate text-base font-semibold text-white">Editar {editWs.name}</h3>
				<button type="button" onclick={() => (editWs = null)} class="text-slate-400 hover:text-white">
					<X class="h-4 w-4" />
				</button>
			</div>

			<div>
				<label for="ewsn" class="mb-1 block text-xs text-slate-400">Nome</label>
				<input id="ewsn" type="text" required minlength={2} bind:value={editWsName} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-accent-500" />
			</div>

			<div>
				<label for="ewsd" class="mb-1 block text-xs text-slate-400">Descrição</label>
				<input id="ewsd" type="text" bind:value={editWsDesc} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-accent-500" />
			</div>

			<div>
				<span class="mb-1.5 block text-xs text-slate-400">Cor</span>
				<div class="flex flex-wrap gap-2">
					{#each WS_COLORS as c (c)}
						<button
							type="button"
							onclick={() => (editWsColor = c)}
							class="h-7 w-7 rounded-full transition {editWsColor === c ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#131c2e]' : 'opacity-75 hover:opacity-100'}"
							style="background-color: {c}"
							aria-label="Cor {c}"
						></button>
					{/each}
				</div>
			</div>

			<div>
				<label for="ewsq" class="mb-1 block text-xs text-slate-400">Cota (GB — mín. 10)</label>
				<input id="ewsq" type="number" min="10" disabled={editWsUnlimited} bind:value={editWsQuotaGb} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-accent-500 disabled:opacity-40" />
				<div class="mt-2 space-y-2 text-xs text-slate-300">
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={editWsUnlimited} class="accent-accent-500" />
						Cota ilimitada
					</label>
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={editWsActive} class="accent-accent-500" />
						Workspace ativa
					</label>
				</div>
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<button type="button" onclick={() => (editWs = null)} class="rounded-xl border border-[#233047] px-4 py-2 text-xs text-slate-300">Cancelar</button>
				<button type="submit" class="rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500">Salvar</button>
			</div>
		</form>
	</div>
{/if}

<!-- ==================== WORKSPACE MEMBERS MODAL ==================== -->
{#if membersWs}
	{@const connectedIds = new Set(membersWs.members.map((m) => m.user_id))}
	{@const availableUsers = users.filter((u) => !connectedIds.has(u.id))}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
		<div class="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[#233047] bg-[#131c2e] shadow-2xl">
			<div class="flex items-center justify-between gap-2 border-b border-[#1f2d45] px-4 py-3.5 sm:px-5 sm:py-4">
				<div class="min-w-0">
					<h3 class="truncate text-sm font-semibold text-white sm:text-base">
						Usuários em "{membersWs.name}"
					</h3>
					<p class="text-xs text-slate-400">
						Conecte ou desconecte contas sem afetar os arquivos da workspace.
					</p>
				</div>
				<button type="button" onclick={() => (membersWs = null)} class="shrink-0 rounded-lg p-1 text-slate-400 hover:text-white">
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
				<form onsubmit={connectMember} class="flex flex-col gap-2 rounded-xl border border-[#1f2d45] bg-[#0e1525] p-3.5 sm:flex-row">
					<select
						required
						bind:value={connectUserId}
						class="w-full min-w-0 rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-xs text-white outline-none focus:border-accent-500 sm:flex-1"
					>
						<option value="">
							{availableUsers.length > 0 ? 'Selecione uma conta para conectar...' : 'Todas as contas já estão conectadas'}
						</option>
						{#each availableUsers as u (u.id)}
							<option value={u.id}>@{u.username} — {u.full_name} ({u.role === 'admin' ? 'Admin' : 'Usuário'})</option>
						{/each}
					</select>
					<div class="flex gap-2">
						<select
							bind:value={connectRole}
							class="flex-1 rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-xs text-white outline-none focus:border-accent-500 sm:flex-none"
						>
							<option value="manager">Gestor</option>
							<option value="editor">Editor</option>
							<option value="viewer">Leitor</option>
						</select>
						<button
							type="submit"
							disabled={memberBusy || !connectUserId}
							class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-accent-500 disabled:opacity-40 sm:flex-none"
						>
							<Plus class="h-3.5 w-3.5" /> Conectar
						</button>
					</div>
				</form>

				{#if membersWs.members.length === 0}
					<div class="rounded-xl border border-dashed border-[#233047] py-8 text-center text-xs text-slate-500">
						Nenhum usuário conectado a esta workspace.
					</div>
				{:else}
					<div class="space-y-2">
						{#each membersWs.members as m (m.id)}
							<div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#1f2d45] bg-[#0e1525] px-3.5 py-2.5">
								<div class="flex min-w-0 items-center gap-2.5">
									<div
										class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
										style="background-color: {m.avatar_color}"
									>
										{getInitials(m.full_name)}
									</div>
									<div class="min-w-0">
										<p class="truncate text-xs font-semibold text-white">{m.full_name}</p>
										<p class="truncate font-mono text-[11px] text-slate-400">@{m.username}</p>
									</div>
								</div>
								<div class="flex items-center gap-2">
									<select
										value={m.role}
										onchange={(e) =>
											updateMemberRole(
												membersWs!.id,
												m.user_id,
												e.currentTarget.value as WorkspaceRole
											)}
										class="rounded-lg border border-[#233047] bg-[#0b101b] px-2.5 py-1 text-xs text-slate-200 outline-none focus:border-accent-500"
									>
										<option value="manager">Gestor</option>
										<option value="editor">Editor</option>
										<option value="viewer">Leitor</option>
									</select>
									<button
										type="button"
										onclick={() => disconnectMember(membersWs!.id, m.user_id, m.username)}
										class="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
										title="Desconectar da workspace"
									>
										<Trash2 class="h-4 w-4" />
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- ==================== CREATE USER MODAL ==================== -->
{#if showCreateUserModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
		<form
			onsubmit={createUser}
			class="max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border border-[#233047] bg-[#131c2e] p-5 shadow-2xl sm:p-6"
		>
			<div class="flex items-center justify-between gap-2">
				<h3 class="text-base font-semibold text-white">Cadastrar Novo Usuário</h3>
				<button type="button" onclick={() => (showCreateUserModal = false)} class="text-slate-400 hover:text-white">
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="rounded-xl border border-accent-500/20 bg-accent-500/10 px-3 py-2 text-[11px] text-accent-200">
				A conta é criada sem workspace vinculada. Depois, conecte-a a quantas workspaces quiser na aba <strong>Workspaces</strong>.
			</div>

			<div>
				<label for="cu" class="mb-1 block text-xs text-slate-400">Usuário (imutável)</label>
				<div class="relative">
					<span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-accent-400">@</span>
					<input id="cu" type="text" required minlength={3} bind:value={newUsername} placeholder="ex: maria.silva" class="w-full rounded-xl border border-[#233047] bg-[#0b101b] py-2 pr-3 pl-7 font-mono text-sm text-white outline-none focus:border-accent-500" />
				</div>
			</div>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div>
					<label for="cfn" class="mb-1 block text-xs text-slate-400">Nome</label>
					<input id="cfn" type="text" required minlength={2} bind:value={newFirstName} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500" />
				</div>
				<div>
					<label for="cln" class="mb-1 block text-xs text-slate-400">Sobrenome</label>
					<input id="cln" type="text" required minlength={2} bind:value={newLastName} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500" />
				</div>
			</div>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div>
					<label for="cp" class="mb-1 block text-xs text-slate-400">Senha inicial</label>
					<input id="cp" type="password" required minlength={6} bind:value={newPassword} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500" />
				</div>
				<div>
					<label for="cr" class="mb-1 block text-xs text-slate-400">Cargo</label>
					<select id="cr" bind:value={newRole} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500">
						<option value="user">Usuário</option>
						<option value="admin">Administrador</option>
					</select>
				</div>
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<button type="button" onclick={() => (showCreateUserModal = false)} class="rounded-xl border border-[#233047] px-4 py-2 text-xs text-slate-300">Cancelar</button>
				<button type="submit" class="rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500">Criar Conta</button>
			</div>
		</form>
	</div>
{/if}

<!-- ==================== EDIT USER MODAL ==================== -->
{#if editUser}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-4">
		<form
			onsubmit={saveUserEdit}
			class="max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border border-[#233047] bg-[#131c2e] p-5 shadow-2xl sm:p-6"
		>
			<div class="flex items-center justify-between gap-2">
				<div class="min-w-0">
					<h3 class="truncate text-base font-semibold text-white">Editar @{editUser.username}</h3>
					<p class="text-xs text-slate-400">Cotas são definidas nas Workspaces</p>
				</div>
				<button type="button" onclick={() => (editUser = null)} class="text-slate-400 hover:text-white">
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div>
					<label for="efn" class="mb-1 block text-xs text-slate-400">Nome</label>
					<input id="efn" type="text" required minlength={2} bind:value={editFirstName} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500" />
				</div>
				<div>
					<label for="eln" class="mb-1 block text-xs text-slate-400">Sobrenome</label>
					<input id="eln" type="text" required minlength={2} bind:value={editLastName} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500" />
				</div>
			</div>

			<div>
				<label for="er" class="mb-1 block text-xs text-slate-400">Cargo Global</label>
				<select id="er" bind:value={editRole} class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3 py-2 text-sm text-white outline-none focus:border-accent-500">
					<option value="user">Usuário</option>
					<option value="admin">Administrador</option>
				</select>
			</div>

			<div class="space-y-2 text-xs text-slate-300">
				<label class="flex items-center gap-2">
					<input type="checkbox" bind:checked={editActive} class="accent-accent-500" />
					Conta ativa (desmarque para suspender / marque para desbloquear)
				</label>
				{#if editUser.totp_enabled}
					<label class="flex items-center gap-2 text-amber-300">
						<input type="checkbox" bind:checked={editReset2fa} class="accent-amber-500" />
						Resetar 2FA deste usuário (recuperação de conta)
					</label>
				{/if}
			</div>

			<div>
				<label for="epw" class="mb-1 block text-xs text-slate-400">Redefinir senha (opcional)</label>
				<input id="epw" type="password" minlength={6} bind:value={editNewPass} placeholder="Deixe em branco para manter" class="w-full rounded-xl border border-[#233047] bg-[#0b101b] px-3.5 py-2 text-sm text-white outline-none focus:border-accent-500" />
			</div>

			<div class="flex justify-end gap-2 pt-2">
				<button type="button" onclick={() => (editUser = null)} class="rounded-xl border border-[#233047] px-4 py-2 text-xs text-slate-300">Cancelar</button>
				<button type="submit" class="rounded-xl bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-500">Salvar</button>
			</div>
		</form>
	</div>
{/if}
