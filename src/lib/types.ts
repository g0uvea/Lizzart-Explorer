export type UserRole = 'admin' | 'user';
export type WorkspaceRole = 'manager' | 'editor' | 'viewer';
export type PerformanceMode =
	| 'legacy_mobile'
	| 'ultra_optimized'
	| 'optimized'
	| 'fast'
	| 'ultra_fast';
export type AutoBackupInterval = 'off' | 'daily' | 'weekly';
export type AppLanguage = 'en' | 'pt' | 'es';

export type LayoutDensity = 'normal' | 'compact';
export type ViewMode = 'grid' | 'list';
export type SortBy = 'name' | 'date' | 'size';
export type SortDir = 'asc' | 'desc';

export interface WorkspaceSummary {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	color: string;
	quota_bytes: number;
	used_bytes: number;
	is_active: boolean;
	role: WorkspaceRole;
}

export interface WorkspaceMemberRecord {
	id: string;
	workspace_id: string;
	user_id: string;
	username: string;
	full_name: string;
	avatar_color: string;
	avatar_url: string | null;
	user_role: UserRole;
	role: WorkspaceRole;
	created_at: string;
}

export interface WorkspaceAdminRecord {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	color: string;
	quota_bytes: number;
	used_bytes: number;
	is_active: boolean;
	member_count: number;
	file_count: number;
	folder_count: number;
	created_at: string;
	updated_at: string;
	members: WorkspaceMemberRecord[];
}

export interface SafeUser {
	id: string;
	username: string;
	first_name: string;
	last_name: string;
	full_name: string;
	role: UserRole;
	is_active: boolean;
	avatar_color: string;
	avatar_url: string | null;
	accent_color: string;
	layout_density: LayoutDensity;
	default_view_mode: ViewMode;
	default_sort_by: SortBy;
	default_sort_dir: SortDir;
	totp_enabled: boolean;
	language: AppLanguage;
	country: string;
	created_at: string;
	workspaces?: WorkspaceSummary[];
}

export type NodeType = 'folder' | 'file';

export interface StorageNode {
	id: string;
	workspace_id: string;
	workspace_name?: string;
	created_by: string | null;
	created_by_name?: string;
	created_by_username?: string;
	parent_id: string | null;
	type: NodeType;
	name: string;
	mime_type: string | null;
	size_bytes: number;
	sha256: string | null;
	is_starred: boolean;
	is_trashed: boolean;
	trashed_at: string | null;
	created_at: string;
	updated_at: string;
	permission?: 'owner' | 'editor' | 'viewer';
	share_count?: number;
	link_count?: number;
}

export interface BreadcrumbItem {
	id: string | null;
	name: string;
}

export interface NodePermissionRecord {
	id: string;
	node_id: string;
	user_id: string;
	username: string;
	full_name: string;
	avatar_color: string;
	avatar_url: string | null;
	permission: 'viewer' | 'editor';
	created_at: string;
}

export interface ShareLinkRecord {
	id: string;
	node_id: string;
	token: string;
	has_password: boolean;
	expires_at: string | null;
	max_downloads: number | null;
	download_count: number;
	is_active: boolean;
	created_at: string;
}

export interface AuditLogRecord {
	id: number;
	user_id: string | null;
	username: string | null;
	full_name: string | null;
	action: string;
	target_type: string | null;
	target_id: string | null;
	details: string | null;
	ip_address: string | null;
	created_at: string;
}

export interface SystemSettings {
	default_quota_gb: number;
	max_upload_mb: number;
	performance_mode: PerformanceMode;
	auto_backup_interval: AutoBackupInterval;
	backup_retention_count: number;
	default_language: AppLanguage;
	default_country: string;
	plugin_mc_servers: boolean;
	plugin_notes: boolean;
}

export interface PluginState {
	mc_servers: boolean;
	notes: boolean;
}

export interface NoteRecord {
	id: string;
	workspace_id: string;
	workspace_name?: string;
	created_by: string | null;
	created_by_name?: string;
	created_by_username?: string;
	title: string;
	name: string;
	content?: string;
	size_bytes: number;
	is_starred: boolean;
	permission: 'owner' | 'editor' | 'viewer';
	share_count: number;
	link_count: number;
	created_at: string;
	updated_at: string;
}

export interface PerformanceClientConfig {
	mode: PerformanceMode;
	label: string;
	maxConcurrentTransfers: number;
	searchDebounceMs: number;
	reducedEffects: boolean;
}

export interface PerformanceProfileInfo {
	mode: PerformanceMode;
	label: string;
	tagline: string;
	description: string;
	dbConnectionLimit: number;
	streamHighWaterMarkKb: number;
	maxConcurrentIo: number;
	authCacheTtlSec: number;
	metadataCacheMaxEntries: number;
	maxListLimit: number;
	argon2MemoryMb: number;
	clientMaxConcurrentTransfers: number;
	clientSearchDebounceMs: number;
	clientReducedEffects: boolean;
}

export interface PerformanceTelemetry {
	mode: PerformanceMode;
	rssMb: number;
	heapUsedMb: number;
	heapTotalMb: number;
	cpuCores: number;
	loadAvg1m: number;
	uptimeSeconds: number;
	activeIoSlots: number;
	maxIoSlots: number;
	cacheEntries: number;
	cacheMaxEntries: number;
	cacheHitRatePct: number;
	dbConnectionLimit: number;
}

export interface BackupRecord {
	id: string;
	file_name: string;
	size_bytes: number;
	sha256: string;
	method: 'mariadb-dump' | 'sql-native' | 'uploaded';
	compressed: boolean;
	created_by_username: string | null;
	created_at: string;
	exists_on_disk: boolean;
}

export interface PendingUploadSession {
	uploadId: string;
	workspaceId: string;
	workspaceName: string;
	parentId: string | null;
	fileName: string;
	mimeType: string;
	totalBytes: number;
	uploadedBytes: number;
	fingerprint: string;
	updatedAt: string;
}

export interface McServerRecord {
	id: string;
	name: string;
	description: string | null;
	version: string;
	edition_label: string;
	host_port: number;
	max_players: number;
	allocated_ram_mb: number;
	motd: string;
	gamemode: string;
	difficulty: string;
	pvp: boolean;
	online_mode: boolean;
	whitelist: boolean;
	status: 'offline' | 'online' | 'starting' | 'stopping';
	created_by: string | null;
	created_at: string;
}
