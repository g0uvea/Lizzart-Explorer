# Workspaces, Arquivos & Transferências Retomáveis

---

## 1. Workspaces Desacopladas dos Usuários

No Lizzart Explorer, **usuários** e **workspaces** são entidades totalmente separadas:

- **Usuários** são apenas identidades de acesso (`@usuario`, nome, senha, 2FA, preferências visuais).
- **Workspaces** possuem os arquivos, pastas (`storage_nodes`) e a **cota de armazenamento** (mínimo de **10 GB** ou **Ilimitada**).
- **Início limpo**: tanto o Administrador inicial (`/setup`) quanto qualquer usuário criado no `/admin` nascem **sem nenhuma workspace conectada**. O administrador cria as workspaces e decide quem participa de cada uma.
- **Múltiplos usuários por Workspace**: uma mesma workspace pode ter vários usuários conectados simultaneamente, cada um com seu papel:
  - `manager` (**Gestor**): controle total na workspace (criar, editar, mover, compartilhar por `@usuário` ou link público, excluir permanentemente e esvaziar lixeira).
  - `editor` (**Editor**): pode enviar arquivos, criar pastas, renomear, mover, duplicar, favoritar e enviar para a lixeira.
  - `viewer` (**Leitor**): acesso somente leitura (visualizar e baixar arquivos).
- **Exclusão segura de contas**: deletar um usuário remove apenas a conta, suas sessões e seus vínculos de membro — **todos os arquivos e workspaces permanecem 100% intactos** (a coluna `created_by` passa a `NULL`).
- **Acesso estrito**: mesmo um Administrador global só visualiza os arquivos das workspaces às quais estiver explicitamente conectado.

---

## 2. Explorador de Arquivos

- **Modos de visualização**: Grade e Lista (preferência salva no perfil do usuário).
- **Seleção múltipla**: retângulo de seleção (marquee) no desktop, `Ctrl/Cmd + Clique`, `Shift + Clique`, `Ctrl/Cmd + A` e menu de ações em lote.
- **Mobile-first**: em telas pequenas (`< 640px`), o menu de contexto abre como **Bottom Sheet** com toque confortável, e a barra de breadcrumbs rola horizontalmente sem quebrar o layout.
- **Drag & Drop**: arraste arquivos do sistema operacional para upload ou arraste itens internos entre pastas, breadcrumbs e atalhos da barra lateral (Raiz, Favoritos, Lixeira).
- **Visualização & Edição**:
  - Player customizado de vídeo e áudio, visualizador de imagens/GIFs com zoom, PDFs e arquivos de código/texto.
  - **Editor de Recorte Lossless (PNG)**: recorte manual com suporte a toque ou detecção automática de bordas pretas, salvando como cópia ou substituindo o original sem perda de qualidade.
- **Compartilhamento**:
  - Por `@usuário` (`Leitor` / `Editor`) — aparece em **Compartilhados** mesmo entre usuários de workspaces diferentes.
  - Por **Link Público** (`/s/[token]`) — com senha opcional, expiração e limite de downloads (suportando HTTP `Range` para streaming e retomada).

---

## 3. Uploads e Downloads Retomáveis (8 MB → 20 MB)

O gerenciador de transferências (`src/lib/stores/transfers.svelte.ts`) foi projetado para resistir a quedas de rede, fechamento de aba e quedas de energia sem corromper arquivos.

### Regra Adaptativa de Blocos (8 MB até 20 MB)

- Todo upload e download inicia em **8 MB** (`MIN_CHUNK_BYTES`).
- O controlador só sobe a escada (**8 MB → 12 MB → 16 MB → 20 MB**) quando a conexão comprova **alta velocidade sustentada e baixíssimo jitter** (coeficiente de variação CV baixo ao longo de múltiplos blocos consecutivos sem falhas):
  - `12 MB`: média ≥ 25 MB/s, CV ≤ 0.18, 3+ blocos limpos
  - `16 MB`: média ≥ 45 MB/s, CV ≤ 0.15, 3+ blocos limpos
  - `20 MB`: média ≥ 75 MB/s, CV ≤ 0.12, 4+ blocos limpos (teto máximo rígido de 20 MB; o servidor rejeita qualquer bloco acima de 20 MB com `413`)
- Diante de **qualquer erro de rede, retry, variação brusca de velocidade ou dica de rede lenta (`saveData` / `2g` / `3g`)**, o bloco cai **imediatamente para 8 MB** e permanece em 8 MB por um período de cooldown antes de tentar subir novamente.

### Resiliência a Queda de Energia / Rede

- **No Upload**:
  1. Cada bloco é transmitido em streaming direto para o arquivo `.part` no disco, validado por **SHA-256** (`X-Chunk-SHA256`) e sincronizado fisicamente com `handle.datasync()`.
  2. Se ocorrer queda de energia ou reinício do servidor no meio de um bloco, o endpoint `/api/files/upload/init` calcula o offset durável confirmado `min(tamanho_em_disco, uploaded_bytes_db)` e trunca qualquer byte parcial não confirmado (`truncateTempFile`), retomando do byte exato.
  3. Ao reabrir o navegador após queda de energia, `GET /api/files/upload/pending` lista os uploads interrompidos na fila de transferências; basta selecionar o arquivo novamente para continuar exatamente de onde parou.
- **No Download**:
  1. Cada bloco baixado via HTTP `Range` (`206 Partial Content`) é gravado imediatamente no **IndexedDB** do navegador (`src/lib/stores/transferPersistence.ts`), evitando manter gigabytes na memória RAM.
  2. Os metadados incluem o `ETag` (`sha256` do arquivo) e o cabeçalho `If-Range` — se o arquivo for alterado no servidor antes da retomada, o download reinicia com segurança; caso contrário, continua exatamente do último byte salvo mesmo após recarregar a página ou cair a energia.
