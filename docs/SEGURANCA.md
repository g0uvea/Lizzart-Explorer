# Segurança & Criptografia

O Lizzart Explorer implementa múltiplas camadas de defesa para proteger credenciais, sessões, tokens e dados em repouso.

---

## 1. JWT Assimétrico EdDSA (Ed25519)

Implementado em `src/lib/server/jwt.ts`:
- **Algoritmo**: `EdDSA` com curvas **Ed25519** (substituindo HMAC simétrico para assinatura de access tokens).
- **Chaves**: geradas automaticamente na primeira inicialização e persistidas com permissão restrita `0600` em `.lizzart-ed25519.pem` (ou carregadas via `JWT_ED25519_PRIVATE_KEY_B64`).
- **Claims validadas**: `iss` (`lizzart-explorer`), `aud` (`lizzart-web`), `sub`, `sid`, `role`, `jti`, `iat`, `exp` (15 minutos) e `fp` (hash SHA-256 do `User-Agent` do cliente).
- **Cookies**: `lizzart_access` (15 min) e `lizzart_refresh` (padrão 7 dias via `SESSION_TTL_DAYS`), ambos com `HttpOnly`, `SameSite=Lax` e `Secure` automático quando acessado via HTTPS/proxy reverso (`X-Forwarded-Proto: https` ou `FORCE_HTTPS=true`).

---

## 2. Refresh Token Rotation & Detecção de Reuso

Implementado em `src/lib/server/auth.ts`:
- Cada login cria uma família de tokens (`token_family`) na tabela `sessions`.
- O refresh token bruto nunca é salvo no banco: ele é convertido com **HMAC-SHA512** usando uma chave derivada via **HKDF-SHA256** (`refresh-token-hmac`) a partir da `APP_MASTER_KEY`.
- Quando o access token expira, o servidor rotaciona o refresh token:
  - O hash atual passa para `previous_token_hash` e um novo par `access + refresh` é emitido.
  - Há uma janela de tolerância de **10 segundos** (`ROTATION_GRACE_MS`) para evitar falsos positivos quando múltiplas abas fazem requisições simultâneas no exato momento da rotação.
  - Se um `previous_token_hash` for apresentado **após** a janela de tolerância, o sistema detecta **reuso/roubo de token**, revoga **toda a família de sessões** (`DELETE FROM sessions WHERE token_family = ?`) e registra `security.token_reuse_detected` na auditoria.

---

## 3. Senhas, Anti-Enumeração & Bloqueio Progressivo

Implementado em `src/lib/server/crypto.ts` e `src/routes/api/auth/login/+server.ts`:
- **Argon2id**: senhas são armazenadas com Argon2id (custo de memória ajustado conforme o perfil de desempenho, mínimo 19 MiB OWASP). Contas legadas em `scrypt` são atualizadas transparentemente para Argon2id no próximo login válido.
- **Anti-Enumeração por Tempo Constante**: tentativas de login para usuários inexistentes ou suspensos executam `verifyDummyPassword()`, evitando diferenças de tempo na resposta.
- **Rate Limit + Lockout Progressivo**:
  - Limite por janela deslizante por `IP + usuário` (`10 tentativas / 5 min`).
  - Após **6 falhas consecutivas** na mesma conta, ela é bloqueada temporariamente por **10 minutos** (`locked_until`), registrando `security.account_locked` na auditoria.
- **Revogação automática**: ao alterar a senha ou desativar o 2FA, todas as outras sessões do usuário são encerradas automaticamente.

---

## 4. 2FA Local (TOTP RFC 6238) com AES-256-GCM

Implementado em `src/lib/server/totp.ts`, `src/lib/server/crypto.ts` e `src/routes/api/auth/2fa/+server.ts`:
- **Criptografia em Repouso**: o segredo Base32 do TOTP é criptografado com **AES-256-GCM** usando subchave derivada via **HKDF-SHA256** (`aes-gcm:totp-secret`) e **AAD** vinculada ao `userId` (impedindo substituição de ciphertext entre contas).
- **Desafio Assinado**: na etapa 1 do login com 2FA, o servidor retorna um `challengeToken` (`JWT+2FA` assinado em Ed25519, vinculado ao hash do IP, válido por 5 minutos). A senha é limpa da memória do navegador e não precisa ser reenviada na etapa 2.
- **Proteção Anti-Replay**: `verifyTotpCodeWithStep()` grava `totp_last_step` no banco — um código de 6 dígitos já utilizado não pode ser reaproveitado dentro da mesma janela de 30 segundos.

---

## 5. Proteção CSRF & Headers HTTP

Implementado em `src/lib/server/security.ts`:
- Requisições mutantes em `/api/*` (`POST`, `PUT`, `PATCH`, `DELETE`) verificam `Sec-Fetch-Site` (`same-origin` / `same-site` / `none`) e comparam `Origin` com `Host` / `X-Forwarded-Host`.
- Headers aplicados em todas as respostas:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY` (ou `SAMEORIGIN` apenas para pré-visualização inline de arquivos/PDFs)
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Content-Security-Policy` restritiva
  - `Strict-Transport-Security` (HSTS) quando em HTTPS
  - `Cache-Control: no-store` em `/api/auth/*`
