# CURRENT_ARCHITECTURE (como o projeto funciona hoje)

Estado real do repositório — Gatinho, hospedado no mesmo Express do Match-3
(URL pública: https://match3-te1c.onrender.com).

## Stack
- **Runtime:** Node.js executado via `bun run server.js` (local: systemd user `match3-server`, porta 3000). Deploy: Render (push no git dispara).
- **Framework:** Express (rotas explícitas para páginas e assets; não confiar em `express.static` de raiz).
- **Banco de dados:** em memória (`Map` no processo). VILAS_CFG e gatos estão no código. Restart do processo zera o estado de jogadores.
- **Tempo real:** WebSocket (`/ws`) para pareamento celular→TV e sessão; TV também tem polling de fallback.
- **Sem login:** usuário identificado por `userId` gerado no cliente (`localStorage 'match3_user'`) e enviado em toda chamada. Saldo no `localStorage` é só display; estado verdadeiro é do servidor.

## Arquivos-chave
- `server.js` — Express: rotas de páginas, `/api/*`, `/api/gato/*`, `/api/admin/*`, webhook, rate limits, locks por usuário (`runExclusive`), validação (`uid`, `nickSan`, tipos), analytics/telemetria.
- `gato.js` — motor do jogo: vilas data-driven, economia (balanceamento em `tools/balance.js`), giro, missões, coleção, eventos editáveis, recompensa de anúncio controlada pelo servidor (`adReward`), configuração dinâmica (`setConfig`).
- `admin.js` — painel: sessões 12h, analytics (anel 5000 + contadores), telemetria de erros (anel 500), auditoria de saldo (anel 500).
- `limiter.js` — rate/acc em janelas fixas de memória.
- `db.js` — helpers de consulta/atualização sobre o banco em memória.
- `public/gato.html` — app do jogador (roleta, vila, coleção, ranking, amigos, missões, TV, offline, tutorial).
- `public/gato-tv.html` — tela para Smart TV (pareamento por código, foco/controle remoto).
- `public/gato-brand.css` / `gato-brand.js` — identidade própria (mascote SVG, cenário CSS, sons WebAudio, favicon).
- `public/ads.js`, `public/jogos.html` — fluxo ads (recompensa pelo `/api/gato/ad-reward`, sem valor confiável no cliente).
- `public/admin.html` — painel administrativo (config, eventos, jogadores, análise, erros, ads, auditoria).

## Jogo já implementado (spec 1–54, uso real)
- Roleta com 9 símbolos, resultado 100% no servidor; pity de gato; defesa/ataque/raide; **objetivo atual** sempre visível.
- Construções (5 por vila), níveis, avance de mundo, 2000 vilas data-driven (geradas de VILAS_CFG).
- Diária com sequência, missões diárias + XP, coleção de gatos com bônus, eventos temporários.
- TV: pareamento celular→TV + controle remoto.
- Anúncios recompensados (cooldown + teto diário no servidor), sem duplicação.
- Proteção: rate limit por usuário/IP, lock serial por usuário, validação de tipos/ids/valores, gate `GT_APP_SECRET`, auditoria de saldo.
- Admin: config em tempo real, eventos, top jogadores, analytics, erros, auditoria.
- Offline: cache local de exibição + banner; regras continuam no servidor.
- VM: `node --check` + testes locais (tsec/treg/tadmin + Playwright: máquina/TV, offline, admin) antes de cada etapa; deploy verificado na Render.

## Refazer o jogo é barato
Como vilas/gatos/economia são dados (VILAS_CFG, balance.js), adicionar conteúdo não exige código novo. Falta conteúdo de "chefia" (coleção, mundo) e, principalmente, **persistência real** fora da memória (próximo passo de escala).

## Limitações conhecidas
- Banco em memória: restart perde estado; 2000 vilas exigem banco de verdade (fase 16).
- Sem login real (senha/email); userId local por dispositivo.
- Sem tutoria de "framework": páginas são HTML/JS puro, sem bundler.