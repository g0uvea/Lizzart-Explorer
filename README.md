# Lizzart Explorer

Sistema completo de **Armazenamento de Arquivos em Nuvem & Home-NAS / Corporativo** construído com **Bun + TypeScript + SvelteKit + Tailwind CSS + MariaDB**, projetado para ser seguro, leve, escalável e confiável.

## Recursos Principais

- **Workspaces Desacopladas dos Usuários**:
  - Contas de usuários e Workspaces são entidades independentes — excluir ou suspender usuários **nunca** apaga os arquivos ou pastas das workspaces.
  - Cotas de armazenamento (mín. 10 GB ou ilimitada) pertencem às **Workspaces**, com suporte a múltiplos usuários conectados simultaneamente (`Gestor`, `Editor`, `Leitor`).
  - Toda conta nova (incluindo o Admin inicial no `/setup`) começa **sem workspace conectada**; o administrador cria workspaces e gerencia os vínculos no Painel Admin (`/admin`).
- **Segurança & Criptografia de Ponta**:
  - **JWT Assimétrico EdDSA (Ed25519)** com rotação de chaves automática (`kid`, `iss`, `aud`, fingerprint de dispositivo).
  - **Refresh Token Rotation** com hash **HMAC-SHA512** (chave derivada por HKDF-SHA256) e **detecção automática de reuso/roubo de token** (revoga a família de sessões inteira imediatamente em caso de replay).
  - **Argon2id** para senhas (com defesa contra enumeração por tempo constante e bloqueio progressivo contra força bruta).
  - **2FA Local (TOTP RFC 6238)** com segredo criptografado em repouso (**AES-256-GCM**), desafio assinado Ed25519 (`challengeToken`) e proteção anti-replay de códigos.
  - Proteção **CSRF Origin / Sec-Fetch-Site**, cookies `HttpOnly` + `SameSite=Lax` + `Secure` (automático em HTTPS/Proxy), HSTS e CSP.
- **Desempenho Configurável pelo Painel Admin**:
  - 4 perfis dinâmicos aplicados em tempo real sem reiniciar:
    - **Extremamente Otimizada**: consumo mínimo de RAM/CPU para Home-NAS, Raspberry Pi ou VPS enxuta.
    - **Otimizada**: equilíbrio inteligente (padrão recomendado).
    - **Rápida**: pool MariaDB ampliado, cache longo e maior paralelismo de I/O.
    - **Extremamente Rápida**: throughput máximo para redes gigabit e servidores dedicados.
  - Telemetria ao vivo de memória, CPU, cache TTL/LRU, pool de banco e semáforo de I/O.
- **Backup & Restauração do Banco de Dados MariaDB**:
  - Geração de backups sob demanda (`.sql.gz` ou `.sql`) via `mariadb-dump` (com fallback SQL nativo), verificação SHA-256, download direto, backup automático agendado (diário/semanal) com retenção e restauração segura (com snapshot automático pré-restauração).
- **Uploads & Downloads Retomáveis (Resistentes a Queda de Energia e Rede)**:
  - **Uploads em blocos adaptativos de 8 MB até 20 MB**: inicia em **8 MB** e só escala até **20 MB** quando a conexão comprova velocidade muito alta e baixíssima variação (jitter); cai imediatamente para **8 MB** diante de qualquer instabilidade.
  - Gravação em streaming direto no disco com `datasync()` + verificação **SHA-256** por bloco + recuperação de uploads interrompidos após queda de energia/reload (`/api/files/upload/pending`).
  - **Downloads persistidos em disco local (IndexedDB)** por chunks com HTTP `Range` + `If-Range` (`ETag`), permitindo retomar exatamente de onde parou mesmo após fechar o navegador ou cair a energia.
- **Interface 100% Responsiva (Desktop & Mobile)**:
  - Menu de contexto em **Bottom Sheet** no celular, zero colisões entre fila de transferências e notificações, suporte touch no recorte lossless de imagens, breadcrumbs e abas roláveis.

---

## Docker Unificado (MariaDB + Aplicação em uma só imagem)

A imagem unificada entrega o **MariaDB** (restrito a `127.0.0.1` internamente) e o **Lizzart Explorer** gerenciados juntos com encerramento gracioso (`tini` + `mariadb-admin shutdown`), credenciais auto-geradas persistidas e volume único em `/data`.

### Construir e Exportar a Imagem

```bash
bun run docker:export
# Gera: dist/lizzart-explorer-allinone.tar.gz (+ .sha256)
```

### Importar e Executar em Qualquer Servidor / Home-NAS

```bash
# 1. Importar a imagem exportada
docker load -i dist/lizzart-explorer-allinone.tar.gz

# 2. Subir o container unificado (MariaDB + App) com volume persistente
docker run -d \
  --name lizzart-explorer \
  -p 3000:3000 \
  -v lizzart_data:/data \
  --restart unless-stopped \
  lizzart-explorer:latest
```

Ou usando Docker Compose:

```bash
docker compose up -d
```

Acesse **`http://localhost:3000`** (ou conecte atrás do seu proxy reverso / Nginx / Caddy / Cloudflare Tunnel definindo `ORIGIN=https://seu-dominio` e `FORCE_HTTPS=true`).

---

## Desenvolvimento Local

```bash
bun install
bun run dev
```
