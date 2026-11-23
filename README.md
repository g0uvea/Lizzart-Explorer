# Lizzart Explorer

Nuvem privada de arquivos moderna, leve e segura — feita para rodar tanto em **Home-NAS** quanto em **servidores de empresas**.

Com o Lizzart Explorer, você organiza arquivos em **Workspaces** compartilhadas, visualiza mídias direto no navegador, cria links públicos com senha e mantém tudo sob seu controle (inclusive com backup automático e Docker tudo-em-um).

---

## O que você encontra no sistema

- **Workspaces Independentes**: os arquivos pertencem aos espaços de trabalho, não a um único usuário. Se uma conta for removida, **nenhum arquivo é perdido**. Cada pessoa pode ter papel de **Gestor**, **Editor** ou **Leitor** em cada workspace.
- **Transferências que não perdem progresso**: uploads e downloads de arquivos grandes são feitos em blocos e **retomam de onde pararam** se a internet cair ou o computador desligar.
- **Visualizador e Editor Integrados**: assista a vídeos, ouça áudios, leia PDFs/textos e recorte imagens PNG sem perda de qualidade direto no navegador.
- **Compartilhamento Flexível**: compartilhe com usuários da equipe (`@usuário`) ou gere links públicos com senha, data de expiração e limite de downloads.
- **Funciona bem no PC e no Celular**: interface responsiva com seleção múltipla, arrastar e soltar (drag-and-drop) e menu adaptado para telas pequenas.
- **Segurança Completa**: senhas protegidas, autenticação em 2 fatores (2FA por aplicativo), sessões gerenciáveis no perfil e registro de auditoria.
- **Painel Admin Completo**: gerencie usuários, workspaces, backups automáticos do banco de dados e escolha entre 4 perfis de desempenho conforme a potência do seu servidor.
- **Fácil de Instalar**: tudo empacotado em um único container Docker (Aplicação + Banco MariaDB).

---

## Começando em 2 Minutos

### Opção 1: Via Docker (Recomendado)

```bash
# Subir usando Docker Compose
make docker-up

# Ou construir e exportar a imagem pronta (.tar.gz)
make deploy
```

Se você já recebeu o arquivo exportado (`lizzart-explorer-allinone.tar.gz`):

```bash
docker load -i dist/lizzart-explorer-allinone.tar.gz
docker run -d \
  --name lizzart-explorer \
  -p 3000:3000 \
  -v lizzart_data:/data \
  --restart unless-stopped \
  lizzart-explorer:latest
```

### Opção 2: Rodar localmente (Desenvolvimento)

```bash
make install
cp .env.example .env
make dev
```

Depois de iniciar, abra **`http://localhost:3000`** (Docker) ou **`http://localhost:5173`** (Desenvolvimento).
Na primeira vez, o sistema abrirá a tela **`/setup`** para você criar a conta do Administrador.

---

## Documentação

A documentação está dividida por objetivo para facilitar a leitura:

### Para aprender e usar o sistema
- **[Guia do Usuário](docs/GUIA-DO-USUARIO.md)** — passo a passo simples para usar workspaces, enviar/baixar arquivos, compartilhar, configurar perfil e 2FA.

### Para instalar e administrar
- **[Guia de Instalação](docs/INSTALACAO.md)** — como importar a imagem Docker, configurar HTTPS e atualizar sem perder dados.
- **[Administração, Desempenho & Backups](docs/ADMINISTRACAO-E-OPERACAO.md)** — como usar o Painel Admin, escolher o perfil de desempenho ideal e restaurar backups.

### Referência técnica (para desenvolvedores)
- **[Arquitetura & Banco de Dados](docs/ARQUITETURA.md)** — estrutura do código, pastas em disco e tabelas do MariaDB.
- **[Segurança & Criptografia](docs/SEGURANCA.md)** — detalhes de JWT Ed25519, rotação de tokens, Argon2id, AES-256-GCM e CSRF.
- **[Workspaces, Arquivos & Transferências (Detalhes Técnicos)](docs/WORKSPACES-E-ARQUIVOS.md)** — regras internas de blocos adaptativos (8 MB → 20 MB) e persistência.
