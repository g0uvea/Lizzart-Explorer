import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '$lib/server/db';
import {
	getWorkspaceMembership,
	workspaceRoleToEffectivePermission
} from '$lib/server/workspaces';
import type { SafeUser } from '$lib/types';

export type EffectivePermission = 'owner' | 'editor' | 'viewer' | null;

export interface NodeRow extends RowDataPacket {
	id: string;
	workspace_id: string;
	created_by: string | null;
	parent_id: string | null;
	type: 'folder' | 'file';
	name: string;
	mime_type: string | null;
	size_bytes: number;
	disk_path: string | null;
	sha256: string | null;
	is_note?: number;
	is_starred: number;
	is_trashed: number;
	trashed_at: Date | string | null;
	created_at: Date | string;
	updated_at: Date | string;
}

export async function getNodeById(nodeId: string): Promise<NodeRow | null> {
	const db = getPool();
	const [rows] = await db.query<NodeRow[]>('SELECT * FROM storage_nodes WHERE id = ? LIMIT 1', [
		nodeId
	]);
	return rows[0] ?? null;
}

/**
 * Computes effective permission for a user on a node:
 * 1. Workspace membership (`manager` -> 'owner', `editor` -> 'editor', `viewer` -> 'viewer')
 * 2. Direct or ancestor-inherited `node_permissions` (for cross-workspace sharing)
 * Note: Admins have NO implicit file access to disconnected workspaces — they must be
 * connected to the workspace explicitly via the Admin Panel.
 */
export async function getEffectivePermission(
	user: SafeUser,
	nodeId: string
): Promise<{ node: NodeRow | null; permission: EffectivePermission }> {
	const db = getPool();
	const node = await getNodeById(nodeId);
	if (!node) return { node: null, permission: null };

	// Personal notes: ONLY the note creator is 'owner' (invisible to other workspace members unless explicitly shared via node_permissions)
	if (Boolean(node.is_note)) {
		if (node.created_by === user.id) {
			return { node, permission: 'owner' };
		}
		const [permRows] = await db.query<RowDataPacket[]>(
			'SELECT permission FROM node_permissions WHERE user_id = ? AND node_id = ? LIMIT 1',
			[user.id, node.id]
		);
		if (permRows.some((r) => r.permission === 'editor')) {
			return { node, permission: 'editor' };
		}
		if (permRows.some((r) => r.permission === 'viewer')) {
			return { node, permission: 'viewer' };
		}
		return { node, permission: null };
	}

	// 1. Check workspace membership
	const membership = await getWorkspaceMembership(user.id, node.workspace_id);
	const wsPerm: EffectivePermission = membership
		? workspaceRoleToEffectivePermission(membership.role)
		: null;

	if (wsPerm === 'owner') {
		return { node, permission: 'owner' };
	}

	// 2. Check direct or inherited node_permissions (cross-workspace share or elevated share)
	const ancestorIds: string[] = [node.id];
	let currentParent = node.parent_id;
	let depth = 0;

	while (currentParent && depth < 32) {
		ancestorIds.push(currentParent);
		const [pRows] = await db.query<RowDataPacket[]>(
			'SELECT parent_id FROM storage_nodes WHERE id = ? LIMIT 1',
			[currentParent]
		);
		currentParent = pRows[0]?.parent_id ? String(pRows[0].parent_id) : null;
		depth++;
	}

	const placeholders = ancestorIds.map(() => '?').join(',');
	const [permRows] = await db.query<RowDataPacket[]>(
		`SELECT permission FROM node_permissions
		 WHERE user_id = ? AND node_id IN (${placeholders})`,
		[user.id, ...ancestorIds]
	);

	if (permRows.some((r) => r.permission === 'editor') || wsPerm === 'editor') {
		return { node, permission: 'editor' };
	}
	if (permRows.some((r) => r.permission === 'viewer') || wsPerm === 'viewer') {
		return { node, permission: 'viewer' };
	}

	return { node, permission: null };
}

export async function collectDescendantNodeIds(rootId: string): Promise<NodeRow[]> {
	const db = getPool();
	const result: NodeRow[] = [];
	const queue: string[] = [rootId];

	while (queue.length > 0) {
		const batch = queue.splice(0, 50);
		const placeholders = batch.map(() => '?').join(',');
		const [rows] = await db.query<NodeRow[]>(
			`SELECT * FROM storage_nodes WHERE parent_id IN (${placeholders})`,
			batch
		);
		for (const row of rows) {
			result.push(row);
			if (row.type === 'folder') {
				queue.push(row.id);
			}
		}
	}

	return result;
}
