# Documentação — Lizzart Explorer

Bem-vindo à documentação do **Lizzart Explorer**. Escolha o guia ideal para o que você precisa agora:

---

## 1. Aprenda a Usar o Sistema
- **[Guia do Usuário](GUIA-DO-USUARIO.md)**
  Comece por aqui! Explica de forma simples como funcionam as workspaces, como enviar e baixar arquivos, compartilhar com a equipe ou por link público, editar imagens PNG, ativar 2FA e personalizar seu perfil.

---

## 2. Instalação e Administração
- **[Guia de Instalação](INSTALACAO.md)**
  Passo a passo para rodar com Docker (imagem única com MariaDB + App), importar o arquivo `.tar.gz`, configurar domínio com HTTPS e atualizar mantendo seus dados.
- **[Administração, Desempenho & Backups](ADMINISTRACAO-E-OPERACAO.md)**
  Guia prático do Painel Admin (`/admin`): criação de workspaces e usuários, escolha do perfil de desempenho ideal para o seu hardware, backups automáticos/restauração e uso da CLI.

---

## 3. Referência Técnica (Avançado)
- **[Workspaces, Arquivos & Transferências](WORKSPACES-E-ARQUIVOS.md)**
  Detalhes técnicos de permissões, streaming, retomada de uploads/downloads com IndexedDB e controle adaptativo de blocos (8 MB → 20 MB).
- **[Arquitetura & Banco de Dados](ARQUITETURA.md)**
  Estrutura de pastas do projeto, organização física em disco (`blobs`, `chunks`, `avatars`, `backups`) e modelo de tabelas no MariaDB.
- **[Segurança & Criptografia](SEGURANCA.md)**
  Implementação de JWT EdDSA (Ed25519), rotação de refresh tokens com detecção de reuso, Argon2id, 2FA com AES-256-GCM e proteção CSRF.
