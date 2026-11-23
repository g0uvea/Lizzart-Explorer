# Guia do Usuário — Aprendendo a Usar o Lizzart Explorer

Este guia foi feito para ajudar você a **usar o Lizzart Explorer no dia a dia**, sem complicação e sem termos técnicos.

---

## 1. Primeiro Acesso e Login

### Se você é quem instalou o sistema (Primeiro Administrador)
1. Abra o endereço do Lizzart Explorer no navegador (ex.: `http://localhost:3000`).
2. Como ainda não existe nenhuma conta, o sistema abrirá automaticamente a tela de **Configuração Inicial (`/setup`)**.
3. Crie a conta do Administrador preenchendo nome, `@usuário` e uma senha forte (mínimo de 8 caracteres).
4. Ao entrar pela primeira vez, **você ainda não verá arquivos**. Isso é normal! Antes de enviar arquivos, é preciso criar uma **Workspace** no Painel Admin (veja o passo 2).

### Se você recebeu uma conta de um Administrador
- Acesse o endereço do sistema e entre com seu `@usuário` e senha.
- Se a **Verificação em 2 Etapas (2FA)** estiver ativada na sua conta, digite também o código de 6 dígitos do seu aplicativo autenticador.

---

## 2. O que é uma Workspace?

No Lizzart Explorer, os arquivos não ficam "presos" a uma pessoa — eles ficam dentro de **Workspaces** (espaços de trabalho).

Pense em uma Workspace como um **disco compartilhado independente**:
- Cada workspace tem seu próprio nome, cor e **limite de espaço** (cota a partir de 10 GB ou ilimitada).
- Você pode participar de **várias workspaces** (ex.: *Pessoal*, *Equipe de Design*, *Backup Casa*) e alternar entre elas pelo **seletor no topo da barra lateral**.
- **Segurança contra perda de dados**: se um usuário sair da equipe ou tiver a conta excluída, **nenhum arquivo da workspace é apagado**.

### Papéis dentro de uma Workspace
Cada pessoa conectada a uma workspace tem um nível de permissão:

| Papel | O que pode fazer |
| :--- | :--- |
| **Gestor** | Controle total: enviar, editar, mover, compartilhar, restaurar e **apagar arquivos definitivamente** da lixeira. |
| **Editor** | Pode enviar arquivos, criar pastas, renomear, mover, duplicar, favoritar e enviar itens para a lixeira. |
| **Leitor** | Apenas visualiza e baixa os arquivos (não pode alterar nem apagar nada). |

> **Não vê nenhuma workspace na barra lateral?**
> - Se você é **usuário comum**: peça ao administrador para conectar sua conta a uma workspace.
> - Se você é **administrador**: clique em **Painel Admin → Workspaces → Nova Workspace** e depois conecte sua própria conta a ela.

---

## 3. Conhecendo a Tela Principal (Explorador)

A tela principal funciona como um gerenciador de arquivos tradicional, adaptado tanto para computador quanto para celular:

- **Barra Lateral (Esquerda)**:
  - **Seletor de Workspace**: troca entre os espaços de trabalho que você participa.
  - **Arquivos**: sua pasta principal (raiz) da workspace atual.
  - **Recentes**: mostra os arquivos acessados ou modificados por último.
  - **Favoritos**: acesso rápido aos arquivos e pastas marcados com estrela.
  - **Compartilhados**: arquivos e pastas que outras pessoas compartilharam diretamente com o seu `@usuário`.
  - **Lixeira**: itens excluídos (podem ser restaurados ou apagados de vez por um Gestor).
- **Barra Superior**:
  - **Busca**: encontre arquivos e pastas pelo nome.
  - **Modo de Visualização**: alterne entre **Grade** (ícones/miniaturas) e **Lista** (detalhes em linha).
  - **Ordenação**: ordene por nome, tamanho ou data.
- **Caminho de Pastas (Breadcrumbs)**: mostra em qual pasta você está e permite voltar clicando em qualquer nível anterior.

---

## 4. Enviando e Baixando Arquivos

### Como enviar arquivos (Upload)
- **Arrastando e soltando**: arraste arquivos do seu computador direto para dentro da área de arquivos.
- **Pelo botão de envio**: clique no botão de upload na barra superior e escolha os arquivos desejados.

### Como baixar arquivos (Download)
- Clique com o botão direito no arquivo (ou toque no menu de opções no celular) e escolha **Baixar**.

### E se a internet cair ou o PC desligar no meio?
Você não perde o progresso! O Lizzart Explorer envia e baixa arquivos grandes em pequenos blocos:
- **No Download**: se a conexão cair ou você recarregar a página, o download retoma do ponto onde parou.
- **No Upload**: se houver queda de energia ou internet, o upload interrompido aparece na **Fila de Transferências** quando você abrir o navegador novamente — basta selecionar o mesmo arquivo para continuar de onde parou, sem precisar enviar tudo do zero.

---

## 5. Organizando, Visualizando e Editando

### Selecionando vários itens de uma vez
- **No computador**:
  - Clique e arraste em uma área vazia para desenhar um retângulo de seleção ao redor dos itens.
  - Segure `Ctrl` (Windows/Linux) ou `Cmd` (Mac) e clique para marcar itens separados.
  - Segure `Shift` e clique para selecionar um intervalo contínuo.
  - Use `Ctrl + A` (ou `Cmd + A`) para selecionar tudo na pasta atual.
- **Movendo arquivos facilmente**: você pode arrastar arquivos selecionados e soltá-los em outra pasta, no caminho de pastas (breadcrumbs) ou até nos atalhos da barra lateral (como **Favoritos** ou **Lixeira**).

### Menu de Ações (Computador e Celular)
- **Computador**: clique com o botão direito sobre qualquer arquivo ou pasta.
- **Celular**: toque no botão de menu do item (ou segure sobre ele) para abrir o painel de ações na parte inferior da tela.

### Visualizador Integrado e Editor de Imagens
Ao abrir um arquivo, você pode visualizá-lo direto no navegador sem precisar baixar:
- **Vídeos e Áudios**: player integrado com controle de reprodução.
- **Imagens, GIFs e PDFs**: visualização com zoom e navegação.
- **Códigos e Textos**: leitura formatada na própria tela.
- **Editor de Recorte PNG (sem perda de qualidade)**: ao visualizar uma imagem PNG, você pode abrir o editor de recorte para ajustar manualmente a área desejada ou remover bordas pretas automaticamente, salvando como uma cópia ou substituindo a imagem original.

---

## 6. Compartilhando Arquivos e Pastas

Você pode compartilhar de duas formas pelo menu do arquivo/pasta em **Compartilhar**:

### Opção A: Compartilhar com outro usuário do sistema
1. Digite o `@usuário` da pessoa.
2. Escolha se ela será **Leitor** (só vê/baixa) ou **Editor** (pode alterar).
3. O item aparecerá na aba **Compartilhados** dela — mesmo que vocês não estejam na mesma workspace.

### Opção B: Criar um Link Público
Ideal para enviar um arquivo a alguém de fora do sistema:
1. Gere um link público (formato `/s/...`).
2. Se quiser mais controle, configure:
   - **Senha de acesso** (opcional).
   - **Data de expiração** (o link para de funcionar após o prazo).
   - **Limite de downloads** (ex.: máximo de 5 downloads).

---

## 7. Seu Perfil, Aparência e Segurança (`/profile`)

Clique no seu nome/avatar no canto inferior da barra lateral para acessar o **Perfil**:

- **Conta e Avatar**: atualize seu nome, sobrenome e foto de perfil.
- **Aparência e Preferências**:
  - Escolha o **idioma** e país.
  - Personalize a **cor de destaque** da interface.
  - Ajuste a **densidade do layout** (normal ou compacto) e o modo padrão de visualização (**Grade** ou **Lista**).
- **Trocar Senha e Sessões Ativas**:
  - Altere sua senha quando precisar (isso encerra automaticamente as sessões em outros dispositivos por segurança).
  - Veja quais aparelhos estão conectados na sua conta e desconecte sessões antigas.
- **Verificação em 2 Etapas (2FA)**:
  - Ative a proteção extra escaneando o QR Code com um aplicativo autenticador no celular (como Google Authenticator, Microsoft Authenticator ou Authy).

---

## 8. Plugins e Recursos Extras (`/plugins`)

Na seção de **Plugins**, o administrador pode ativar ou desativar módulos extras que aparecem na barra lateral:
- **Notas**: bloco de anotações rápido integrado ao sistema.
- **Servidores Minecraft**: painel visual para organizar e configurar instâncias de servidores Minecraft.
