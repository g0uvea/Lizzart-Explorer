# Lizzart Explorer

Sistema completo de **Armazenamento de Arquivos em Nuvem** construído com **Bun + TypeScript + SvelteKit + Tailwind CSS + MariaDB**, projetado para ser seguro, leve, confiável e escalável — ideal tanto para **Home-NAS** quanto para **empresas de pequeno, médio e grande porte**.

---

## Principais Recursos

- **Workspaces Desacopladas dos Usuários**:
  - Contas e Workspaces são objetos independentes: excluir ou suspender usuários **nunca** apaga arquivos ou pastas das workspaces.
  - Cotas de armazenamento (mín. 10 GB ou ilimitada) pertencem às **Workspaces**, com suporte a múltiplos usuários conectados (`Gestor`, `Editor`, `Leitor`).
  - Todas as contas (inclusive o Admin inicial em `/setup`) iniciam sem workspace vinculada; o administrador cria workspaces e gerencia os vínculos no Painel Admin (`/admin`).
- **Segurança & Criptografia de Ponta**:
  - **JWT Assimétrico EdDSA (Ed25519)** com rotação de refresh tokens em **HMAC-SHA512** (chave derivada por HKDF-SHA256) e **detecção automática de reuso/roubo de token**.
  - **Argon2id** para senhas (com defesa anti-enumeração e bloqueio progressivo contra força bruta).
  - **2FA Local (TOTP RFC 6238)** com segredo criptografado em **AES-256-GCM**, desafio assinado Ed25519 e proteção anti-replay.
  - Proteção **CSRF** (`Origin` / `Sec-Fetch-Site`), cookies `HttpOnly` + `SameSite=Lax` + `Secure` (HTTPS), CSP e HSTS.
- **4 Perfis de Desempenho Editáveis no Painel Admin**:
  - **Extremamente Otimizada**, **Otimizada**, **Rápida** e **Extremamente Rápida** — ajustam em tempo real pool do MariaDB, buffers de streaming, semáforo de I/O, cache TTL/LRU, Argon2id e paralelismo da interface, com telemetria ao vivo.
- **Backup & Restauração do MariaDB**:
  - Snapshots `.sql.gz` / `.sql` sob demanda ou agendados (diário/semanal), verificação SHA-256, download direto e restauração segura com snapshot automático pré-restauração.
- **Uploads & Downloads Retomáveis (8 MB → 20 MB)**:
  - Uploads em blocos adaptativos de **8 MB** até no máximo **20 MB** (apenas em redes ultra-rápidas e estáveis; retorna imediatamente para **8 MB** em qualquer instabilidade), com streaming direto + `datasync()` + SHA-256 por bloco.
  - Downloads via HTTP `Range` + `If-Range` (`ETag`) persistidos em IndexedDB, retomando exatamente de onde pararam após queda de rede, recarregamento ou queda de energia.
- **Interface Responsiva (Desktop & Mobile)**:
  - Layout adaptado para celulares sem cortes ou sobreposições, menu de contexto em Bottom Sheet no mobile, seleção marquee, drag-and-drop, player de vídeo/áudio e editor de recorte PNG lossless.
- **Docker All-in-One Exportável**:
  - MariaDB + Aplicação empacotados em uma única imagem segura e pronta para importar em qualquer servidor ou NAS.

---

## Início Rápido

### Com Docker Unificado (Recomendado)

```bash
# Construir e exportar a imagem unificada (.tar.gz + .sha256)
make deploy

# Ou subir diretamente via Docker Compose
make docker-up
```

Para importar uma imagem já exportada em outra máquina:

```bash
docker load -i dist/lizzart-explorer-allinone.tar.gz
docker run -d \
  --name lizzart-explorer \
  -p 3000:3000 \
  -v lizzart_data:/data \
  --restart unless-stopped \
  lizzart-explorer:latest
```

### Desenvolvimento Local

```bash
make install
cp .env.example .env
make dev
```

Acesse **`http://localhost:3000`** (Docker / `make start`) ou **`http://localhost:5173`** (`make dev`). Na primeira inicialização, você será direcionado para `/setup` para criar a conta Administradora.

---

## Documentação

Consulte a pasta [`docs/`](docs/README.md) para guias detalhados:

- **[Guia de Instalação](docs/INSTALACAO.md)** (Docker All-in-One, Proxy Reverso HTTPS e Instalação Local)
- **[Arquitetura & Banco de Dados](docs/ARQUITETURA.md)**
- **[Segurança & Criptografia](docs/SEGURANCA.md)**
- **[Workspaces, Arquivos & Transferências Retomáveis](docs/WORKSPACES-E-ARQUIVOS.md)**
- **[Administração, Perfis de Desempenho & Backups](docs/ADMINISTRACAO-E-OPERACAO.md)**
