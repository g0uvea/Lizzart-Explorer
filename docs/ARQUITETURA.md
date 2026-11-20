# Arquitetura & Estrutura do Projeto

O **Lizzart Explorer** é uma aplicação full-stack construída sobre **Bun + TypeScript + SvelteKit (`@sveltejs/adapter-node`) + Tailwind CSS v4 + MariaDB**.

---

## Estrutura de Diretórios

```text
Lizzart-Explorer/
├── database/
│   └── schema.sql                  # Schema completo v3 do MariaDB
├── docker/
│   ├── entrypoint.sh               # Supervisor unificado (MariaDB + App)
│   └── mariadb-lizzart.cnf         # Configuração otimizada do MariaDB no container
├── docs/                           # Documentação técnica e guias
├── scripts/
│   ├── export-docker.sh            # Build + exportação .tar.gz + SHA-256
│   └── verify-e2e.ts               # Suíte de testes E2E completa
├── src/
│   ├── hooks.server.ts             # Middleware global: CSRF, Auth EdDSA, Headers, Auto-Setup, Scheduler
│   ├── lib/
│   │   ├── components/             # Componentes UI (ToastContainer, TransferQueue, modais do explorer)
│   │   ├── server/                 # Lógica de servidor (DB, Auth, Crypto, JWT, Storage, Backup, Performance, Workspaces)
│   │   └── stores/                 # Estado reativo Svelte 5 (workspace, quota, transfers, transferPersistence, theme, drag, toast)
│   └── routes/
│       ├── (app)/                  # Área autenticada: Explorador (/), Admin (/admin), Perfil (/profile), Minecraft (/minecraft)
│       ├── api/                    # Endpoints REST (auth, files, share, admin, health)
│       ├── login/                  # Tela de login + etapa 2FA
│       ├── setup/                  # Assistente de criação do primeiro Admin
│       └── s/[token]/              # Página pública de links compartilhados
├── Dockerfile                      # Multi-stage build unificado (MariaDB + Bun)
├── docker-compose.yml              # Orquestração pronta com volume único /data
└── Makefile                        # Automação local, testes e deploy Docker
```

---

## Armazenamento Híbrido: Disco + MariaDB

O Lizzart Explorer separa estritamente **conteúdo binário** de **metadados**:

- **MariaDB**: armazena apenas usuários, sessões, workspaces, membros, índice hierárquico (`storage_nodes`), sessões de upload, permissões, links públicos, logs de auditoria e registros de backups.
- **Disco Local (`STORAGE_ROOT`)**: armazena os arquivos físicos organizados em 4 subpastas:
  - `blobs/<2-hex>/<uuid>` — arquivos finalizados (referenciados por `disk_path`, com limpeza automática apenas quando nenhuma linha no banco os referencia).
  - `chunks/<uploadId>.part` — arquivos temporários de uploads em andamento/pausados.
  - `avatars/` — fotos de perfil dos usuários.
  - `backups/` — snapshots `.sql` / `.sql.gz` do banco de dados MariaDB.

---

## Modelo de Dados (MariaDB v3)

| Tabela | Responsabilidade |
| :--- | :--- |
| `users` | Contas (`id`, `username` imutável, nome/sobrenome, `password_hash`, `role`, preferências sincronizadas, `totp_secret` criptografado, `totp_last_step`, bloqueio progressivo). Não armazena cotas nem posse exclusiva de arquivos. |
| `sessions` | Sessões ativas com `token_family`, `refresh_token_hash` (HMAC-SHA512), `previous_token_hash`, `rotated_at`, `rotation_count`, `device_label`, IP e expiração. |
| `workspaces` | Espaços de trabalho independentes (`name`, `slug`, `color`, `quota_bytes`, `used_bytes`, `is_active`). |
| `workspace_members` | Relação N:N entre `workspaces` e `users` com papel por workspace (`manager`, `editor`, `viewer`). |
| `storage_nodes` | Pastas e arquivos pertencentes a uma `workspace_id`, com `created_by` (`ON DELETE SET NULL`), `parent_id`, `disk_path` e `sha256`. |
| `upload_sessions` | Controle durável de uploads em chunks (`workspace_id`, `fingerprint`, `total_bytes`, `uploaded_bytes`, `temp_path`, `status`). |
| `node_permissions` | Compartilhamento granular por `@usuário` entre contas (`viewer` ou `editor`). |
| `share_links` | Links públicos `/s/[token]` com senha opcional, expiração e limite de downloads. |
| `db_backups` | Registro dos backups gerados (`file_name`, `size_bytes`, `sha256`, `method`, `compressed`). |
| `audit_logs` | Trilha de auditoria de ações administrativas, transferências e eventos de segurança (`security.*`). |
| `system_settings` | Configurações globais (`default_quota_gb`, `max_upload_mb`, `storage_root`, `performance_mode`, `auto_backup_interval`, `backup_retention_count`). |
| `mc_servers` | Instâncias e `server.properties` da interface casca de servidores Minecraft. |

---

## Fluxo de Inicialização (`hooks.server.ts`)

Em toda requisição recebida pelo SvelteKit:
1. **Proteção CSRF**: rotas `/api/*` mutantes validam `Sec-Fetch-Site` e `Origin` contra o `Host` esperado.
2. **Bootstrap do Banco**: `ensureDatabaseReady()` cria o banco/tabelas caso necessário, aplica migrações idempotentes e carrega o `performance_mode` salvo.
3. **Agendador de Backups**: `ensureBackupSchedulerStarted()` inicia a verificação periódica em segundo plano.
4. **Autenticação**: valida o cookie `lizzart_access` (JWT EdDSA) ou rotaciona o `lizzart_refresh` automaticamente.
5. **Setup Obrigatório**: se não houver nenhum `admin` cadastrado, redireciona rotas de página para `/setup`.
6. **Headers de Segurança**: aplica `CSP`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `COOP` e `HSTS` (em HTTPS).
