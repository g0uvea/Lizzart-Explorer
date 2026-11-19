# Lizzart Explorer

Sistema completo de **Armazenamento de Arquivos em Nuvem** construído com **Bun + TypeScript + SvelteKit + Tailwind CSS + MariaDB**, acompanhado de um **Painel Administrativo** completo e uma **Casca (UI) de Painel Admin para Servidores de Minecraft**.

## Arquitetura

- **Arquivos físicos**: Armazenados no disco local (configurável em `STORAGE_ROOT` no `.env`, padrão `./storage/blobs/<prefix>/<uuid>`), protegidos contra path traversal e com contagem de referências para exclusão segura.
- **Metadados & Permissões**: 100% indexados no **MariaDB** (`lizzart_explorer`), incluindo usuários, cargos (`admin` / `user`), sessões `HttpOnly`, árvore virtual de pastas/arquivos, SHA-256, favoritos, lixeira, permissões granulares entre usuários (`viewer` / `editor`), links públicos com senha/expiração/limite de downloads, auditoria e registros da casca Minecraft.
- **Painel Minecraft (Casca UI)**: Interface completa (instâncias, controles visuais, console simulado, jogadores, editor `server.properties` salvo no MariaDB, aba backups) **sem iniciadores/modloaders/plugin loaders** por enquanto, pronta para integração futura.

## Como rodar

1. Certifique-se de que o **MariaDB** está rodando (padrão `127.0.0.1:3306`, usuário `root`, sem senha — ajustável no `.env`).
2. Instale as dependências (se ainda não instalou):
   ```bash
   bun install
   ```
3. Inicialize o banco de dados (também acontece automaticamente na primeira requisição):
   ```bash
   bun run db:init
   ```
4. Inicie o servidor de desenvolvimento:
   ```bash
   bun run dev
   ```
5. Acesse `http://localhost:5173`.

### Conta Administrador Padrão
- **E-mail**: `admin@lizzart.local`
- **Senha**: `admin123`
