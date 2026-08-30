// ============================================================
//  BINGO DIÁRIO — bingo com cartela 5x5 (75 números) e jackpot
//  Cada cartela comprada engorda o pote (70% do valor).
//  Quem completar a cartela inteira leva o jackpot.
//  Quando o tempo da partida acaba sem bingo, o pote passa pra próxima.
// ============================================================

const CFG = {
  cardCost: 50,           // custo da cartela (moedas)
  drawIntervalMs: 3000,   // sorteia um número a cada ...
  roundMs: 180000,        // 3 minutos por partida
  resultHoldMs: 9000,     // tempo exibindo o vencedor
  houseCut: 0.30          // fatia que fica com a casa (30% → pote fica com 70%)
};

function envNum(key, fallback) {
  const v = parseInt(process.env['BN_' + key], 10);
  return Number.isFinite(v) ? v : fallback;
}
CFG.cardCost = envNum('CARD_COST', CFG.cardCost);
CFG.drawIntervalMs = envNum('DRAW_INTERVAL', CFG.drawIntervalMs);
CFG.roundMs = envNum('ROUND_MS', CFG.roundMs);
CFG.resultHoldMs = envNum('RESULT_HOLD', CFG.resultHoldMs);
CFG.houseCut = Math.max(0, Math.min(0.9, CFG.houseCut));

let game = null;

function todayLabel() {
  return new Date().toISOString().slice(0, 10);
}
function newGame(first) {
  return {
    phase: 'drawing',
    round: 0,
    jackpot: 0,
    drawn: new Set(),
    drawnList: [],
    cards: new Map(),      // cardId -> {userId, nick, numbers:[..]}
    buyers: new Map(),     // userId -> [cardIds]
    nextDrawAt: Date.now() + 1500,
    roundStartAt: Date.now(),
    roundEndAt: Date.now() + CFG.roundMs,
    phaseEndAt: null,
    lastWinner: null,
    startedLabel: todayLabel(),
    stats: { cardsSold: 0, coinsSpent: 0, coinsPaid: 0, jackpots: 0 }
  };
}
game = newGame(true);

// evento opcional: onEvent('jackpot'|'milestone', info)
let onEvent = null;

function logPush(msg) {
  if (!game.log) game.log = [];
  game.log.push(msg);
  if (game.log.length > 60) game.log.splice(0, game.log.length - 60);
}

const RANGES = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Gera uma cartela 5x5 (colunas por faixa de 15 números), centro livre.
function makeCard() {
  const cols = RANGES.map(([a, b]) => {
    const arr = [];
    while (arr.length < 5) {
      const n = randInt(a, b);
      if (!arr.includes(n)) arr.push(n);
    }
    return arr;
  });
  cols[2][2] = null; // centro = FREE
  const numbers = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (cols[c][r] !== null) numbers.push(cols[c][r]);
    }
  }
  return { cols, numbers };
}

function cardId() {
  return 'c' + game.round + '_' + game.cards.size + '_' + Date.now().toString(36);
}

// Comprar cartela: gasta moedas e devolve o cartão.
async function buyCard(db, userId, nickRaw) {
  if (game.phase !== 'drawing') return { error: '⏳ Partida em andamento/fechada! Espere a próxima.' };
  const r = await db.dbSpendCoins(userId, CFG.cardCost);
  if (!r) return { error: `Moedas insuficientes (cartela = ${CFG.cardCost}). Compre um pacote!` };

  const clean = String(nickRaw || '').replace(/[^\p{L}\p{N} _\-]/gu, '').slice(0, 16) || 'Jogador';
  const { cols, numbers } = makeCard();
  const id = cardId();
  game.cards.set(id, { userId, nick: clean, numbers });
  if (!game.buyers.has(userId)) game.buyers.set(userId, []);
  game.buyers.get(userId).push(id);

  const add = Math.round(CFG.cardCost * (1 - CFG.houseCut));
  game.jackpot += add;
  game.stats.cardsSold += 1;
  game.stats.coinsSpent += CFG.cardCost;
  logPush(`🎟️ ${clean} comprou uma cartela! (+${add} no pote)`);

  // avisa o dono quando o pote passa marcos bonitos
  const m = Math.floor(game.jackpot / 500);
  if (m > 0 && (game.jackpot - m * 500) < (Math.round(CFG.cardCost * (1 - CFG.houseCut)) )) {
    if (onEvent) onEvent('milestone', { jackpot: game.jackpot });
  }

  return { ok: true, cardId: id, cols, cost: CFG.cardCost, jackpot: game.jackpot, balance: r.balance };
}

function drawTicket() {
  while (game.drawn.size < 75) {
    const n = randInt(1, 75);
    if (!game.drawn.has(n)) return n;
  }
  return null;
}

function checkWinner() {
  for (const [id, card] of game.cards) {
    if (card.numbers.every(n => game.drawn.has(n))) {
      return [id, card];
    }
  }
  return null;
}

function snapshot(userId) {
  let ownCards = [];
  if (userId && game.cards) {
    const ids = game.buyers.get(userId) || [];
    ownCards = ids.map(id => {
      const card = game.cards.get(id);
      if (!card) return null;
      return { cardId: id, marked: card.numbers.filter(n => game.drawn.has(n)) };
    }).filter(Boolean);
  }
  return {
    phase: game.phase,
    round: game.round,
    jackpot: game.jackpot,
    cardCost: CFG.cardCost,
    drawIntervalMs: CFG.drawIntervalMs,
    drawn: game.drawnList,
    drawnCount: game.drawn.size,
    players: game.buyers.size,
    cardsSold: game.cards.size,
    countdownMs: Math.max(0, (game.phase === 'winner' ? game.phaseEndAt : game.roundEndAt) - Date.now()),
    lastWinner: game.lastWinner,
    drawnLast: game.drawnLast || null,
    log: (game.log || []).slice(-15),
    ownCards,
    stats: game.stats
  };
}

function tick() {
  const now = Date.now();

  if (game.phase === 'winner') {
    if (now >= game.phaseEndAt) {
      // próximo round
      game.round += 1;
      game.phase = 'drawing';
      game.drawn = new Set();
      game.drawnList = [];
      game.drawnLast = null;
      game.cards = new Map();
      game.buyers = new Map();
      game.roundStartAt = now;
      game.roundEndAt = now + CFG.roundMs;
      game.nextDrawAt = now + 1500;
      if (todayLabel() !== game.startedLabel) {
        game.startedLabel = todayLabel();
        game.jackpot = 0;
      }
      logPush(`🆕 Nova partida! Cartela = ${CFG.cardCost} moedas. Pote: ${game.jackpot}`);
    }
    return;
  }

  if (game.phase === 'drawing') {
    // fim do tempo sem bingo → pote rola pra próxima
    if (now >= game.roundEndAt) {
      game.log = game.log || [];
      logPush(`⏰ Tempo esgotado sem bingo! O pote de ${game.jackpot} passa pra próxima.`);
      game.round += 1;
      game.drawn = new Set();
      game.drawnList = [];
      game.drawnLast = null;
      game.cards = new Map();
      game.buyers = new Map();
      game.roundStartAt = now;
      game.roundEndAt = now + CFG.roundMs;
      game.nextDrawAt = now + 1500;
      return;
    }
    if (now >= game.nextDrawAt) {
      const n = drawTicket();
      if (n === null) {
        // todas as 75 sorteadas e sem bingo: força vencedor? impossível se alguém completou antes; se nenhum, pote rola.
        game.roundEndAt = now;
        return;
      }
      game.drawn.add(n);
      game.drawnList.push(n);
      game.drawnLast = n;
      game.nextDrawAt = now + CFG.drawIntervalMs;

      const win = checkWinner();
      if (win) {
        const [id, card] = win;
        game.phase = 'winner';
        game.phaseEndAt = now + CFG.resultHoldMs;
        const prize = game.jackpot;
        game.jackpot = 0;
        game.lastWinner = {
          userId: card.userId,
          nick: card.nick,
          amount: prize,
          round: game.round,
          cardId: id
        };
        game.stats.coinsPaid += prize;
        game.stats.jackpots += 1;
        logPush(`🏆 BINGO! ${card.nick} completou a cartela e levou ${prize} moedas!`);
        // credita o prêmio
        dbAddSafe(card.userId, prize).catch(() => {});
        if (onEvent) onEvent('jackpot', { nick: card.nick, amount: prize });
      }
    }
  }
}

let _store = null; // db injetado
let dbAddSafe;
function startLoop(db) {
  if (_store === game) return; // já iniciado
  _store = game;
  dbAddSafe = (id, amount) => db.dbAddCoins(id, amount);
  setInterval(tick, 1000);
}

module.exports = {
  CFG,
  buyCard,
  snapshot,
  status: snapshot,
  startLoop,
  tick,
  set onEvent(fn) { onEvent = fn; },
  get game() { return game; }
};