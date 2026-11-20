# Administração, Perfis de Desempenho & Backups

O Painel Administrativo (`/admin`) é acessível exclusivamente para contas com `role = 'admin'`.

---

## 1. Abas do Painel Administrativo

1. **Workspaces**: crie workspaces com cor, descrição e cota (mín. 10 GB ou ilimitada), edite cotas, suspenda/exclua workspaces e gerencie os usuários conectados (`Gestor`, `Editor`, `Leitor`).
2. **Usuários**: cadastre novas contas (sem registro público), edite nome/cargo, suspenda ou desbloqueie contas bloqueadas por força bruta, redefina senhas, resete 2FA e exclua usuários mantendo workspaces e arquivos intactos.
3. **Desempenho**: alterne entre os 4 perfis de hardware em tempo real e acompanhe a telemetria ao vivo (RAM RSS/Heap, CPU Load, taxa de acerto do cache TTL/LRU, pool do MariaDB e slots ativos de I/O).
4. **Backups DB**: crie backups manuais (`.sql.gz` ou `.sql`), baixe snapshots, configure backup automático (desativado, diário ou semanal) com retenção e restaure o banco a partir de um backup salvo ou enviado.
5. **Infra & Banco**: configure e teste o diretório físico `STORAGE_ROOT` (com migração opcional de arquivos, avatares e backups), reconecte o MariaDB em tempo real e ajuste políticas padrão de cota/upload.
6. **Auditoria**: visualize os últimos 100 eventos registrados (`auth.*`, `admin.*`, `file.*`, `share.*`, `security.*`).

---

## 2. Perfis de Desempenho (`src/lib/server/performance.ts`)

| Perfil | Pool DB | Buffer Stream | Semáforo I/O | Cache TTL/LRU | Argon2id | Fila UI / Debounce / Blur |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Extremamente Otimizada** (`ultra_optimized`) | 4 conn | 64 KB | 2 slots | 150 entradas (6s auth) | 19 MB | 1 transferência • 420 ms • Sem `backdrop-blur` |
| **Otimizada** (`optimized` — padrão) | 10 conn | 256 KB | 4 slots | 500 entradas (15s auth) | 32 MB | 2 transferências • 280 ms • Efeitos normais |
| **Rápida** (`fast`) | 22 conn | 512 KB | 8 slots | 2000 entradas (30s auth) | 48 MB | 3 transferências • 180 ms • Efeitos normais |
| **Extremamente Rápida** (`ultra_fast`) | 40 conn | 1 MB | 16 slots | 5000 entradas (45s auth) | 64 MB | 4 transferências • 100 ms • Efeitos normais |

- Ao trocar de perfil no Admin, o valor é salvo no MariaDB (`system_settings.performance_mode`), o pool de conexões é recriado dinamicamente sem derrubar o servidor e o cache é ajustado para o novo limite imediatamente.

---

## 3. Backup & Restauração do MariaDB (`src/lib/server/backup.ts`)

- **Geração**: utiliza `mariadb-dump` (ou `mysqldump`) com `--single-transaction --quick --hex-blob`. Caso nenhum binário esteja presente no host, um gerador SQL puro via `mysql2` assume automaticamente.
- **Integridade**: todo backup gera e armazena seu hash **SHA-256** (enviado também no header `X-Backup-SHA256` ao baixar).
- **Agendamento Automático**: quando configurado para **Diário** ou **Semanal**, um agendador em segundo plano cria snapshots `.sql.gz` e aplica a política de retenção (`backup_retention_count`), removendo os backups mais antigos automaticamente.
- **Restauração Segura**: antes de restaurar qualquer `.sql` ou `.sql.gz` (da lista ou via upload), o sistema cria automaticamente um **snapshot de segurança pré-restauração** (`pre-restore-safety-*.sql.gz`).

---

## 4. Health Check & Makefile

### Endpoint de Saúde
- `GET /api/health` retorna status JSON (`status`, `database`, `storage`, `performance_mode`, `uptime_sec`) com HTTP `200` (ou `503` se degradado). Utilizado pelo `HEALTHCHECK` do Docker.

### Comandos do `Makefile`

```bash
make help          # Lista todos os comandos
make dev           # Servidor de desenvolvimento local
make start         # Build + servidor de produção local
make check         # Typecheck Svelte/TypeScript
make test-docker   # Sobe container temporário, roda verify-e2e.ts e limpa
make deploy        # Gera imagem Docker unificada e exporta dist/lizzart-explorer-allinone.tar.gz
make docker-up     # Sobe o container via docker-compose.yml
```
