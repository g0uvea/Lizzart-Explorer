export type UserRole = 'admin' | 'user';

export interface SafeUser {
	id: string;
	name: string;
	email: string;
	role: UserRole;
	quota_bytes: number;
	used_bytes: number;
	is_active: boolean;
	avatar_color: string;
	created_at: string;
}

export type NodeType = 'folder' | 'file';

export interface StorageNode {
	id: string;
	owner_id: string;
	owner_name?: string;
	owner_email?: string;
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
	user_name: string;
	user_email: string;
	avatar_color: string;
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
	user_name: string | null;
	user_email: string | null;
	action: string;
	target_type: string | null;
	target_id: string | null;
	details: string | null;
	ip_address: string | null;
	created_at: string;
}

export interface SystemSettings {
	allow_registration: boolean;
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
