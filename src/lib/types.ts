export type UserRole = 'admin' | 'user';

export type LayoutDensity = 'normal' | 'compact';
export type ViewMode = 'grid' | 'list';
export type SortBy = 'name' | 'date' | 'size';
export type SortDir = 'asc' | 'desc';

export interface SafeUser {
	id: string;
	username: string;
	first_name: string;
	last_name: string;
	full_name: string;
	role: UserRole;
	quota_bytes: number;
	used_bytes: number;
	is_active: boolean;
	avatar_color: string;
	avatar_url: string | null;
	accent_color: string;
	layout_density: LayoutDensity;
	default_view_mode: ViewMode;
	default_sort_by: SortBy;
	default_sort_dir: SortDir;
	totp_enabled: boolean;
	created_at: string;
}

export type NodeType = 'folder' | 'file';

export interface StorageNode {
	id: string;
	owner_id: string;
	owner_name?: string;
	owner_username?: string;
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
