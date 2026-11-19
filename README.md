# Lizzart Explorer

Sistema completo de **Armazenamento de Arquivos em Nuvem** construído com **Bun + TypeScript + SvelteKit + Tailwind CSS + MariaDB**, acompanhado de um **Painel Administrativo** completo e uma **Casca (UI) de Painel Admin para Servidores de Minecraft**.

## Recursos Principais

- **Primeira Inicialização (`/setup`)**: Quando não existe nenhum administrador no MariaDB, o sistema abre automaticamente o assistente para criar o primeiro Admin. Novas contas de usuários só podem ser criadas por administradores (sem registro público).
- **Segurança Moderna (JWT + Hardening)**:
  - Autenticação dual-token: **Access Token JWT (HS256, 15 min)** + **Refresh Token opaco com rotação automática** armazenado em hash **SHA-256** no MariaDB (nunca em texto puro), ambos em cookies `HttpOnly` + `SameSite=Lax`.
  - Gerenciamento de **Sessões Ativas** na aba Conta (revogar dispositivos individuais ou todos os outros).
  - **Rate Limiting** contra força bruta em login/setup/links com senha, proteção **CSRF** nativa e headers HTTP de segurança (`CSP`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `COOP`).
- **Contas por `@usuário` + 2FA Local + Avatar**:
  - Login por **usuário** (imutável após criado), com **Nome** e **Sobrenome** mutáveis pelo usuário.
  - Upload de imagem para foto de perfil.
  - **2FA Local (TOTP RFC 6238)** com QR Code gerado localmente (Google Authenticator, Authy, Aegis, 1Password).
- **Tema & Preferências Sincronizadas na Conta**: Cor principal **Verde Esmeralda** por padrão, densidade (**Normal** / **Compacto**), modo de visualização (**Grade** / **Lista**) e ordenação salvos no perfil no MariaDB — mantendo a mesma interface em qualquer dispositivo.
- **Infraestrutura Configurável pelo Admin**: No Painel Admin (`/admin`), é possível definir e testar o diretório de armazenamento físico dos arquivos em disco (`STORAGE_ROOT`, com migração opcional) e a conexão do banco MariaDB (responsável apenas por metadados e índice).
- **Explorador de Arquivos ("Meus Arquivos")**:
  - **Retângulo de seleção (marquee)** arrastando com o mouse + `Ctrl/Shift+Click` + `Ctrl+A` + ações em lote.
  - **Menu de contexto customizado** substituindo o menu nativo do navegador.
  - **Uploads e Downloads Retomáveis com Chunks Dinâmicos (8 MB → até 64 MB)** preservando 100% da qualidade original byte-a-byte, com pausa/retomada e reconexão automática.
  - **Player customizado de Vídeo e Áudio** + visualizador de **GIFs** e imagens com zoom na qualidade original.
  - **Editor de Recorte de Bordas de Imagem (Lossless PNG)** com botão automático **"Remover Bordas Pretas"** e salvamento sem perda de qualidade (cópia ou substituir original).
  - **Compartilhamento**: por `@usuário` (`Leitor` / `Editor`) e **Links Públicos** (`/s/[token]`) com senha, expiração e limite de downloads.
- **Gestão de Usuários & Cotas**: Cadastro de contas exclusivo para admins com **cota mínima de 10 GB** (ou ilimitada) e logs de auditoria.
- **Painel Minecraft (Casca UI)**: Interface visual de instâncias, console, jogadores e `server.properties` salvos no MariaDB (sem iniciadores/modloaders/plugin loaders).

## Como rodar

```bash
bun install
bun run dev
```

Acesse **`http://localhost:5173`**. Na primeira inicialização (sem administradores no banco), você será direcionado automaticamente para `/setup` para criar sua conta Admin.
