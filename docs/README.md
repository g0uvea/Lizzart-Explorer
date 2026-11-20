# Documentação — Lizzart Explorer

Bem-vindo à documentação técnica e operacional do **Lizzart Explorer**.

## Guias Disponíveis

1. **[Guia de Instalação](INSTALACAO.md)**
   Passo a passo completo para rodar com a imagem **Docker All-in-One (MariaDB + App)**, importar o pacote `.tar.gz` exportado, configurar proxy reverso externo (HTTPS), ou instalar localmente com Bun + MariaDB.
2. **[Arquitetura & Banco de Dados](ARQUITETURA.md)**
   Visão geral da stack, estrutura de diretórios, modelo de tabelas no MariaDB (`schema.sql`) e organização física dos arquivos em disco (`blobs`, `chunks`, `avatars`, `backups`).
3. **[Segurança & Criptografia](SEGURANCA.md)**
   Detalhes sobre JWT assimétrico **EdDSA (Ed25519)**, **Refresh Token Rotation** com detecção de reuso, **Argon2id**, **AES-256-GCM** para segredos 2FA TOTP, proteção CSRF e headers HTTP.
4. **[Workspaces, Arquivos & Transferências Retomáveis](WORKSPACES-E-ARQUIVOS.md)**
   Funcionamento das Workspaces desacopladas de usuários, cotas, compartilhamento, recorte lossless de imagens, uploads em blocos adaptativos (**8 MB → 20 MB**) e downloads/uploads resistentes a quedas de energia e rede.
5. **[Administração, Desempenho & Backups](ADMINISTRACAO-E-OPERACAO.md)**
   Painel Administrativo (`/admin`), tabela completa dos 4 perfis de desempenho, backup e restauração do MariaDB, auditoria e referência do `Makefile`.
