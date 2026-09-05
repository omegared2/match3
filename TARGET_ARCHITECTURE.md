# TARGET_ARCHITECTURE (arquitetura deste plano)

Visão: **motor de jogo + motor de vilas + economia + backend seguro + contas +
anúncios + sincronização**, com as 2000 vilas vindo de conteúdo/configuração —
jamais "2000 páginas manuais".

Regra-mestra da spec (55): implementar preservando o que já funciona e evoluindo
gradualmente, **sempre mantendo uma versão funcional**.

## Pilares
1. **Motor de jogo** — roleta/resultado 100% no servidor. Já é o caso; manter.
2. **Motor de vilas** — vila = dados (nome, mundo, objetivo, custos, recompensa).
   Já data-driven em `VILAS_CFG`; no alvo, vira **tabela de conteúdo** consultada
   pelo servidor (2.000 registros, sem código novo por vila).
3. **Economia** — moedas, custos, multiplicadores e sequência diária centralizados
   e reajustáveis em runtime (`setConfig`, `tools/balance.js`). Já existe; evoluir
   para persistir a config.
4. **Backend seguro** — validação, rate limit, locks, auditoria e sem confiar em
   cliente (localStorage/valor pago). Já implementado (spec 47). Manter como base.
5. **Sistema de conta** — userId por dispositivo hoje. Alvo: conta persistente
   (login opcional) para progresso em múltiplos aparelhos e anti-manipulação forte.
6. **Sistema de anúncios** — recompensa definida e validada no servidor;
   cooldown + teto diário. Já implementado; evoluir métricas por rede.faixa.
7. **Sincronização** — WebSocket já cobre TV/pareamento e sessão. Alvo:
   sincronização de progresso multi-dispositivo (servidor como fonte da verdade,
   estados "resolvem" no servidor).

## Persistência (a grande lacuna)
- Hoje: banco em memória (restart perde estado) — ok para staging, inviável em produção.
- Alvo Fase 16: **banco real** (ex.: SQLite/Postgres) com as mesmas funções de
  `db.js`, migração transparente para jogadores existentes, e seed das 2000 vilas.
- Confirmação do ciclo (spec 54) mantida: criar conta → girar → validar → construir
  → concluir vila → desbloquear próxima → anúncios → sem duplicação → celular e
  desktop → TV → código documentado → erros registrados → backup criado.

## Fases (spec 53) → status
1 Refatoração/segurança ......... ✅ feito (47)
2 Sistema de usuário ............ parcial (userId por dispositivo; falta conta real)
3 Economia ...................... ✅ feito (46, config runtime)
4 Roleta ........................ ✅ feito (servidor)
5 Vila .......................... ✅ feito
6 Construções ................... ✅ feito
7 Mapa .......................... ✅ feito (mundo/vilas data-driven)
8 Progressão .................... ✅ feito (XP, níveis, desbloqueios, objetivo)
9 Ataque/raide/defesa ............ ✅ feito
10 Coleções ...................... ✅ feito
11 Missões ....................... ✅ feito
12 AdMob ......................... ✅ feito (ads.js + ad-reward servidor)
13 Eventos ....................... ✅ feito (painel admin)
14 Smart TV ...................... ✅ feito (gato-tv.html)
15 Controle celular → TV .......... ✅ feito (WS + teclado virtual)
16 Escalar para 2000 vilas ........ ⏳ **próximo grande passo** (persistência + seed)

## Critério concluído (spec 54) — verificação
Checklist completo de conclusão executado/verificado; gaps restantes listados
na seção "Limitações" (persistência real + conta real) — ambos cobertos pela
Fase 16.