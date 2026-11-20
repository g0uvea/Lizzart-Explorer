# Guia de Instalação — Lizzart Explorer (Imagem Docker Unificada)

Este guia foi feito para quem vai **instalar e rodar o Lizzart Explorer diretamente a partir da imagem Docker pronta** (`lizzart-explorer-allinone.tar.gz`), **sem precisar clonar código-fonte, instalar Bun ou compilar nada**.

A imagem já entrega **MariaDB + Lizzart Explorer** integrados e pré-configurados em um único container, com geração automática de credenciais e persistência em volume único.

---

## 1. Pré-requisitos

- **Docker Engine** instalado no servidor, VPS, PC ou Home-NAS (Linux, Windows com Docker Desktop/WSL2 ou macOS).
- Porta **`3000`** (ou outra porta de sua escolha) liberada.

Verifique se o Docker está ativo:

```bash
docker --version
```

---

## 2. Importar a Imagem Docker

Coloque o arquivo **`lizzart-explorer-allinone.tar.gz`** (e, se enviado junto, o `.sha256`) na máquina onde o servidor vai rodar.

```bash
# (Opcional) Conferir integridade do arquivo recebido
sha256sum -c lizzart-explorer-allinone.tar.gz.sha256

# Importar a imagem para o Docker local
docker load -i lizzart-explorer-allinone.tar.gz
```

Confirme que a imagem apareceu na lista local:

```bash
docker images lizzart-explorer
```

---

## 3. Iniciar o Container

Você pode subir com **`docker run`** (um único comando) ou com **`docker compose`**.

### Opção A: Via `docker run` (Mais simples)

```bash
docker run -d \
  --name lizzart-explorer \
  -p 3000:3000 \
  -v lizzart_data:/data \
  -e PERFORMANCE_MODE=optimized \
  --restart unless-stopped \
  lizzart-explorer:latest
```

### Opção B: Via `docker-compose.yml`

Crie um arquivo `docker-compose.yml` na pasta desejada:

```yaml
services:
  lizzart-explorer:
    image: lizzart-explorer:latest
    container_name: lizzart-explorer
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      PORT: "3000"
      PERFORMANCE_MODE: "optimized"
      # Descomente abaixo se for acessar por domínio externo com HTTPS:
      # ORIGIN: "https://nuvem.seudominio.com"
      # FORCE_HTTPS: "true"
    volumes:
      - lizzart_data:/data
    stop_grace_period: 30s

volumes:
  lizzart_data:
```

E inicie em segundo plano:

```bash
docker compose up -d
```

> **Dica para Home-NAS / Pasta específica no host**: se preferir salvar os dados em uma pasta física visível no seu servidor (ex.: `/mnt/hd/lizzart-data`), troque `-v lizzart_data:/data` por `-v /mnt/hd/lizzart-data:/data`.

---

## 4. Acompanhar Inicialização

Na primeira vez que o container sobe, ele automaticamente:
1. Gera credenciais seguras do banco e chaves criptográficas (`APP_MASTER_KEY`, `JWT_SECRET`, chave `Ed25519`).
2. Inicializa o MariaDB internamente (escutando apenas em `127.0.0.1:3306`).
3. Cria o banco `lizzart_explorer` e todas as tabelas.
4. Sobe a aplicação na porta `3000`.

Para acompanhar os logs:

```bash
docker logs -f lizzart-explorer
```

Quando aparecer `Listening on http://0.0.0.0:3000` (ou status `healthy` em `docker ps`), o sistema estará pronto.

---

## 5. Primeiro Acesso (`/setup`)

1. Abra no navegador: **`http://IP-DO-SERVIDOR:3000`** (ou `http://localhost:3000` se estiver na mesma máquina).
2. Como ainda não existe nenhum administrador, você será direcionado automaticamente para **`/setup`**.
3. Preencha os dados do **Administrador principal** (`@usuário`, nome, sobrenome e senha com mínimo de 8 caracteres).
4. Ao entrar, sua conta iniciará **sem nenhuma workspace conectada**.
5. Vá em **Painel Admin → Workspaces**, clique em **Nova Workspace**, defina a cota (mín. 10 GB ou ilimitada) e clique em **Conectar / Gerenciar Usuários** para vincular sua conta e sua equipe.

---

## 6. Onde Ficam os Dados (Volume `/data`)

Todo o estado da aplicação e do banco fica isolado dentro do volume `/data`:

| Caminho dentro do volume | O que contém |
| :--- | :--- |
| `/data/mariadb` | Banco de dados MariaDB |
| `/data/storage` | Arquivos enviados (`blobs/`), chunks temporários (`chunks/`), avatares e backups do DB (`backups/`) |
| `/data/config/.env` | Credenciais do banco e chaves secretas geradas automaticamente (`chmod 600`) |
| `/data/config/.lizzart-ed25519.pem` | Chave privada Ed25519 usada nos tokens JWT |

---

## 7. Variáveis de Ambiente Opcionais

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `PORT` | `3000` | Porta HTTP interna da aplicação |
| `PERFORMANCE_MODE` | `optimized` | Perfil inicial: `ultra_optimized`, `optimized`, `fast` ou `ultra_fast` (também editável depois pelo Painel Admin) |
| `ORIGIN` | *(vazio)* | URL pública completa quando atrás de proxy reverso (ex.: `https://nuvem.suaempresa.com`) |
| `FORCE_HTTPS` | *(vazio)* | Defina `true` quando servido via HTTPS para ativar cookies `Secure` e HSTS |
| `SESSION_TTL_DAYS` | `7` | Duração da sessão (refresh token) em dias |

---

## 8. Expor para Internet / Domínio Próprio (HTTPS)

O container já entrega MariaDB + Aplicação juntos de forma segura (o MariaDB não é exposto para fora do container). Para publicar em um domínio externo com HTTPS, utilize um proxy reverso na frente da porta `3000` (Nginx, Caddy, Traefik ou Cloudflare Tunnel).

### Exemplo com Caddy (HTTPS automático)

```caddyfile
nuvem.seudominio.com {
    reverse_proxy 127.0.0.1:3000
}
```

### Exemplo com Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name nuvem.seudominio.com;

    client_max_body_size 32M; # Os blocos de upload têm no máximo 20 MB

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

> Ao publicar em HTTPS, lembre-se de definir `-e ORIGIN=https://nuvem.seudominio.com -e FORCE_HTTPS=true`.

---

## 9. Atualizar a Imagem Mantendo Todos os Dados

Como todos os arquivos, banco e chaves ficam no volume `lizzart_data`, atualizar para uma nova versão é seguro:

```bash
# 1. Importar a nova imagem recebida
docker load -i lizzart-explorer-allinone.tar.gz

# 2. Parar e remover apenas o container antigo (NÃO apague o volume!)
docker stop lizzart-explorer
docker rm lizzart-explorer

# 3. Subir novamente apontando para o mesmo volume lizzart_data
docker run -d \
  --name lizzart-explorer \
  -p 3000:3000 \
  -v lizzart_data:/data \
  --restart unless-stopped \
  lizzart-explorer:latest
```

---

## 10. Comandos Úteis do Dia a Dia

```bash
docker ps                              # Ver status e saúde (healthy)
docker logs -f lizzart-explorer        # Ver logs em tempo real
docker stop lizzart-explorer           # Desligar com segurança (encerra App + MariaDB graciosamente)
docker start lizzart-explorer          # Iniciar novamente
```
