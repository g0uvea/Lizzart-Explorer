# Administração, Desempenho & Backups

O **Painel Administrativo (`/admin`)** é a central de controle do sistema. Ele fica disponível na barra lateral apenas para contas com papel de **Administrador** (`admin`).

---

## 1. O que você faz em cada aba do Painel Admin

1. **Workspaces**: crie novos espaços de trabalho (definindo nome, cor, descrição e limite de espaço a partir de 10 GB ou ilimitado), ajuste cotas, suspenda/exclua workspaces e conecte usuários com papel de **Gestor**, **Editor** ou **Leitor**.
2. **Usuários**: crie novas contas (não existe cadastro público aberto), edite nome/cargo, desbloqueie contas travadas por excesso de tentativas de senha, redefina senhas, desative o 2FA de um usuário que perdeu o celular ou exclua contas (os arquivos das workspaces permanecem intactos).
3. **Desempenho**: escolha o perfil de velocidade ideal para o hardware do seu servidor e acompanhe em tempo real o uso de memória RAM, carga da CPU, cache e conexões ativas.
4. **Backups DB**: gere backups do banco de dados com um clique, baixe cópias de segurança, ative backups automáticos (diários ou semanais) e restaure o sistema quando precisar.
5. **Infra & Banco**: configure ou mude a pasta física onde os arquivos são salvos (`STORAGE_ROOT`), teste a conexão com o MariaDB e defina limites padrão de cota e upload.
6. **Auditoria**: consulte os últimos 100 eventos importantes do sistema (logins, alterações de admin, compartilhamentos e alertas de segurança).

---

## 2. Perfis de Desempenho: Qual escolher?

Você pode trocar o perfil a qualquer momento sem reiniciar o servidor. O sistema ajusta conexões, cache e paralelismo na hora:

- **Extremamente Otimizada** (`ultra_optimized`): ideal para **Raspberry Pi, mini-PCs ou Home-NAS com pouca RAM** (1–2 GB). Economiza memória e desativa efeitos visuais pesados.
- **Otimizada** (`optimized` — padrão): melhor equilíbrio para a maioria dos **VPS, PCs domésticos e servidores pequenos**.
- **Rápida** (`fast`): recomendada para **servidores com boa CPU e 4+ GB de RAM** com vários usuários simultâneos.
- **Extremamente Rápida** (`ultra_fast`): indicada para **servidores dedicados com bastante RAM, SSD/NVMe e rede local Gigabit/10G**.

### Parâmetros técnicos de cada perfil (`src/lib/server/performance.ts`)

| Perfil | Pool DB | Buffer Stream | Semáforo I/O | Cache TTL/LRU | Argon2id | Fila UI / Debounce / Blur |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Extremamente Otimizada** (`ultra_optimized`) | 4 conn | 64 KB | 2 slots | 150 entradas (6s auth) | 19 MB | 1 transferência • 420 ms • Sem `backdrop-blur` |
| **Otimizada** (`optimized` — padrão) | 10 conn | 256 KB | 4 slots | 500 entradas (15s auth) | 32 MB | 2 transferências • 280 ms • Efeitos normais |
| **Rápida** (`fast`) | 22 conn | 512 KB | 8 slots | 2000 entradas (30s auth) | 48 MB | 3 transferências • 180 ms • Efeitos normais |
| **Extremamente Rápida** (`ultra_fast`) | 40 conn | 1 MB | 16 slots | 5000 entradas (45s auth) | 64 MB | 4 transferências • 100 ms • Efeitos normais |

---

## 3. Backups e Restauração do Banco de Dados

Os backups protegem todas as informações de contas, workspaces, pastas e permissões:

- **Como funciona**: o sistema gera arquivos `.sql.gz` (compactados) ou `.sql` usando `mariadb-dump` (ou um gerador interno automático caso o utilitário não esteja instalado no sistema).
- **Verificação de integridade**: cada backup salva seu código **SHA-256** para garantir que o arquivo não foi corrompido.
- **Backup Automático**: ao ativar o agendamento **Diário** ou **Semanal**, os backups são criados em segundo plano e os mais antigos são removidos conforme o limite de retenção configurado.
- **Restauração Segura**: antes de restaurar qualquer backup (salvo na lista ou enviado do seu computador), o sistema cria automaticamente um **snapshot de segurança pré-restauração** (`pre-restore-safety-*.sql.gz`) caso você precise voltar atrás.

---

## 4. Linha de Comando (CLI), Health Check e Makefile

### CLI Administrativa (`lizzart`)
Para tarefas rápidas direto no terminal do servidor (como gerenciar usuários, workspaces, backups ou trocar o perfil de desempenho), você pode usar:

```bash
bun run lizzart
```

### Monitoramento de Saúde
- `GET /api/health` retorna um JSON com o status da aplicação, banco de dados, armazenamento e perfil ativo (`200` quando saudável ou `503` se houver falha). É usado automaticamente pelo `HEALTHCHECK` do Docker.

### Comandos úteis do `Makefile`

```bash
make help          # Lista todos os comandos disponíveis
make dev           # Sobe o servidor de desenvolvimento local
make start         # Compila e inicia o servidor de produção local
make check         # Verifica tipos Svelte/TypeScript
make test-docker   # Sobe container temporário, roda testes E2E e limpa
make deploy        # Gera imagem Docker unificada e exporta dist/lizzart-explorer-allinone.tar.gz
make docker-up     # Sobe o container via docker-compose.yml
```
