-- Lizzart Explorer - MariaDB Schema v2
-- Usuários por username (imutável) + nome/sobrenome, 2FA TOTP local, avatares, cor de tema global,
-- uploads retomáveis em chunks, permissões, compartilhamentos, auditoria e casca Minecraft

CREATE DATABASE IF NOT EXISTS `lizzart_explorer`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `lizzart_explorer`;

CREATE TABLE IF NOT EXISTS `users` (
  `id` CHAR(36) NOT NULL,
  `username` VARCHAR(64) NOT NULL,
  `first_name` VARCHAR(80) NOT NULL,
  `last_name` VARCHAR(80) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  `quota_bytes` BIGINT NOT NULL DEFAULT 10737418240,
  `used_bytes` BIGINT NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `avatar_color` VARCHAR(32) NOT NULL DEFAULT '#10b981',
  `avatar_path` VARCHAR(255) NULL,
  `accent_color` VARCHAR(32) NOT NULL DEFAULT '#10b981',
  `layout_density` ENUM('normal', 'compact') NOT NULL DEFAULT 'normal',
  `default_view_mode` ENUM('grid', 'list') NOT NULL DEFAULT 'grid',
  `default_sort_by` ENUM('name', 'date', 'size') NOT NULL DEFAULT 'name',
  `default_sort_dir` ENUM('asc', 'desc') NOT NULL DEFAULT 'asc',
  `totp_secret` VARCHAR(128) NULL,
  `totp_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sessions` (
  `id` VARCHAR(128) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `ip_address` VARCHAR(64) NULL,
  `user_agent` VARCHAR(255) NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sessions_user` (`user_id`),
  KEY `idx_sessions_expires` (`expires_at`),
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `storage_nodes` (
  `id` CHAR(36) NOT NULL,
  `owner_id` CHAR(36) NOT NULL,
  `parent_id` CHAR(36) NULL,
  `type` ENUM('folder', 'file') NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(190) NULL,
  `size_bytes` BIGINT NOT NULL DEFAULT 0,
  `disk_path` VARCHAR(512) NULL,
  `sha256` CHAR(64) NULL,
  `is_starred` TINYINT(1) NOT NULL DEFAULT 0,
  `is_trashed` TINYINT(1) NOT NULL DEFAULT 0,
  `trashed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_nodes_owner_parent_trash` (`owner_id`, `parent_id`, `is_trashed`),
  KEY `idx_nodes_owner_star` (`owner_id`, `is_starred`, `is_trashed`),
  KEY `idx_nodes_disk_path` (`disk_path`),
  KEY `idx_nodes_name` (`name`),
  CONSTRAINT `fk_nodes_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_nodes_parent` FOREIGN KEY (`parent_id`) REFERENCES `storage_nodes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `upload_sessions` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `owner_id` CHAR(36) NOT NULL,
  `parent_id` CHAR(36) NULL,
  `fingerprint` VARCHAR(255) NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(190) NOT NULL DEFAULT 'application/octet-stream',
  `total_bytes` BIGINT NOT NULL,
  `uploaded_bytes` BIGINT NOT NULL DEFAULT 0,
  `temp_path` VARCHAR(512) NOT NULL,
  `status` ENUM('uploading', 'completed', 'aborted') NOT NULL DEFAULT 'uploading',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_upload_lookup` (`user_id`, `fingerprint`, `status`),
  CONSTRAINT `fk_upload_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_upload_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `node_permissions` (
  `id` CHAR(36) NOT NULL,
  `node_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `granted_by` CHAR(36) NOT NULL,
  `permission` ENUM('viewer', 'editor') NOT NULL DEFAULT 'viewer',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_node_user` (`node_id`, `user_id`),
  KEY `idx_perm_user` (`user_id`),
  CONSTRAINT `fk_perm_node` FOREIGN KEY (`node_id`) REFERENCES `storage_nodes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_perm_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_perm_granted_by` FOREIGN KEY (`granted_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `share_links` (
  `id` CHAR(36) NOT NULL,
  `node_id` CHAR(36) NOT NULL,
  `created_by` CHAR(36) NOT NULL,
  `token` VARCHAR(64) NOT NULL,
  `password_hash` VARCHAR(255) NULL,
  `expires_at` DATETIME NULL,
  `max_downloads` INT NULL,
  `download_count` INT NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_share_token` (`token`),
  KEY `idx_share_node` (`node_id`),
  CONSTRAINT `fk_share_node` FOREIGN KEY (`node_id`) REFERENCES `storage_nodes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_share_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NULL,
  `action` VARCHAR(64) NOT NULL,
  `target_type` VARCHAR(32) NULL,
  `target_id` CHAR(36) NULL,
  `details` TEXT NULL,
  `ip_address` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_created` (`created_at`),
  KEY `idx_audit_user` (`user_id`),
  CONSTRAINT `fk_audit_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `system_settings` (
  `setting_key` VARCHAR(64) NOT NULL,
  `setting_value` TEXT NOT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mc_servers` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(255) NULL,
  `version` VARCHAR(32) NOT NULL DEFAULT '1.21.4',
  `edition_label` VARCHAR(32) NOT NULL DEFAULT 'Interface Casca',
  `host_port` INT NOT NULL DEFAULT 25565,
  `max_players` INT NOT NULL DEFAULT 20,
  `allocated_ram_mb` INT NOT NULL DEFAULT 4096,
  `motd` VARCHAR(255) NOT NULL DEFAULT 'Bem-vindo ao Lizzart Craft!',
  `gamemode` VARCHAR(32) NOT NULL DEFAULT 'survival',
  `difficulty` VARCHAR(32) NOT NULL DEFAULT 'normal',
  `pvp` TINYINT(1) NOT NULL DEFAULT 1,
  `online_mode` TINYINT(1) NOT NULL DEFAULT 1,
  `whitelist` TINYINT(1) NOT NULL DEFAULT 0,
  `status` ENUM('offline', 'online', 'starting', 'stopping') NOT NULL DEFAULT 'offline',
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_mc_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
