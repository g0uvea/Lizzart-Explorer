# Guia de Instalação — Lizzart Explorer

Este guia cobre as duas formas oficiais de instalar e executar o **Lizzart Explorer**:

1. **Docker Unificado (Recomendado)** — MariaDB + Aplicação em uma única imagem pronta para produção, Home-NAS ou servidores corporativos.
2. **Instalação Local (Bare-Metal)** — Executando diretamente no host Linux com Bun e MariaDB.

---

## Opção 1: Docker Unificado (MariaDB + Aplicação)

A imagem unificada contém o **MariaDB 10.11** (vinculado exclusivamente a `127.0.0.1` dentro do container) e a aplicação **Lizzart Explorer** rodando juntos sob supervisão do `tini` e `docker/entrypoint.sh`, com encerramento gracioso e persistência em um único volume `/data`.

### Pré-requisitos
- Docker Engine (`24+` recomendado) e Docker Compose (opcional).
- Porta `3000` (ou outra de sua escolha) disponível no host.

### 1A. Importando a imagem exportada (`.tar.gz`)

Se você recebeu ou gerou o pacote `dist/lizzart-explorer-allinone.tar.gz`:

```bash
# (Opcional) Verificar integridade do arquivo
sha256sum -c dist/lizzart-explorer-allinone.tar.gz.sha256

# Importar a imagem para o Docker local
docker load -i dist/lizzart-explorer-allinone.tar.gz

# Iniciar o container com volume persistente
docker run -d \
  --name lizzart-explorer \
  -p 3000:3000 \
  -v lizzart_data:/data \
  --restart unless-stopped \
  lizzart-explorer:latest
```

Ou usando o `Makefile`:

```bash
make docker-load
make docker-up
```

### 1B. Construindo a partir do código-fonte

```bash
# Subir diretamente com Docker Compose
make docker-up

# Ou gerar a imagem e exportar o .tar.gz para levar para outro servidor / NAS
make deploy
```

### Estrutura do Volume `/data`

Tudo que é persistente fica concentrado em `/data`:

| Caminho no container | Conteúdo |
| :--- | :--- |
| `/data/mariadb` | Arquivos físicos do banco de dados MariaDB |
| `/data/storage` | Arquivos dos usuários (`blobs/`, `chunks/`, `avatars/`, `backups/`) |
| `/data/config/.env` | Credenciais do banco e chaves (`APP_MASTER_KEY`, `JWT_SECRET`) geradas automaticamente na primeira inicialização (`chmod 600`) |
| `/data/config/.lizzart-ed25519.pem` | Chave privada Ed25519 usada na assinatura dos tokens JWT |

### Variáveis de Ambiente do Container

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `PORT` | `3000` | Porta HTTP interna da aplicação |
| `ORIGIN` | *(vazio)* | URL pública quando atrás de proxy reverso (ex.: `https://nuvem.suaempresa.com`) |
| `FORCE_HTTPS` | *(vazio)* | Defina como `true` quando servido via HTTPS para forçar cookies `Secure` e HSTS |
| `PERFORMANCE_MODE` | `optimized` | Perfil inicial: `ultra_optimized`, `optimized`, `fast` ou `ultra_fast` |
| `SESSION_TTL_DAYS` | `7` | Validade do refresh token em dias |

### Conexão com o Exterior (Proxy Reverso / HTTPS)

O container expõe apenas HTTP na porta `3000` (e mantém o MariaDB isolado em `127.0.0.1:3306`). Para acesso externo seguro com TLS/HTTPS, coloque um proxy reverso na frente (Nginx, Caddy, Traefik ou Cloudflare Tunnel).

Exemplo mínimo com **Caddy**:

```caddyfile
nuvem.seudominio.com {
    reverse_proxy 127.0.0.1:3000
}
```

Exemplo de blocos recomendados no **Nginx** (garantindo uploads grandes e streaming sem buffering):

```nginx
server {
    listen 443 ssl http2;
    server_name nuvem.seudominio.com;

    client_max_body_size 32M; # Chunks têm no máximo 20 MB

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_request_buffering off;
    }
}
```

> **Dica**: Ao usar proxy reverso HTTPS, defina `ORIGIN=https://nuvem.seudominio.com` e `FORCE_HTTPS=true` no `docker-compose.yml` ou no `docker run`.

---

## Opção 2: Instalação Local (Bun + MariaDB)

### Pré-requisitos
- **Bun** `1.x` (`https://bun.sh`)
- **MariaDB** `10.6+` ou `11.x` em execução

### Passos

1. **Instale as dependências:**
   ```bash
   make install
   ```

2. **Configure o arquivo `.env`:**
   ```bash
   cp .env.example .env
   ```
   Edite `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` e `STORAGE_ROOT`. As chaves `APP_MASTER_KEY` e `JWT_SECRET` são geradas automaticamente na primeira execução caso estejam vazias.

3. **Inicialize o banco de dados (opcional — a aplicação também cria automaticamente no boot):**
   ```bash
   make db-init
   ```

4. **Execute:**
   - **Modo Desenvolvimento** (`http://localhost:5173`):
     ```bash
     make dev
     ```
   - **Modo Produção** (`http://localhost:3000`):
     ```bash
     make start
     ```

---

## Primeiro Acesso e Configuração Inicial (`/setup`)

1. Abra **`http://localhost:3000`** (ou `5173` em dev).
2. Como ainda não existe administrador no MariaDB, o sistema redirecionará automaticamente para **`/setup`**.
3. Crie a conta **Administradora** inicial (usuário imutável, nome, sobrenome e senha com mínimo de 8 caracteres).
4. Após o setup, o administrador entra **sem nenhuma workspace conectada**.
5. Acesse **Painel Admin (`/admin`) → Workspaces**, crie sua primeira Workspace (definindo cota mínima de 10 GB ou ilimitada) e clique em **Conectar / Gerenciar Usuários** para vincular sua conta e outros membros.
