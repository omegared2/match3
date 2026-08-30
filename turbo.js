// Modo Turbo — multiplicador que sobe até "estourar". Aposte uma vez por
// rodada e resgate quando quiser: prêmio = aposta x multiplicador.
// Taxa de 5% só sobre o LUCRO (quem resgata no empate x1.00 ganha exatamente
// de volta o que apostou). Margem média da casa ~5%.
// ATENÇÃO: jogo estilo cassino — adulto, moedas virtuais, sem retirada em
// dinheiro real. Ver divulgação legal na frente do jogo.
const CFG = {
  bet: Number(process.env.TB_BET) || 20,
  edge: 0.05,                 // taxa sobre o lucro
  tickMs: 800,
  step: 0.05,                 // multiplicador sobe 0.05 a cada tick
  crashProbPerTick: 0.07,
  autoCash: Number(process.env.TB_AUTOCASH) || 1.10, // resgate automático
  pauseMs: Number(process.env.TB_PAUSE_MS) || 6000,  // janela de aposta entre rodadas
  joinMs: Number(process.env.TB_JOIN_MS) || 8000     // janela inicial
};

let game = null;              // rodada atual
let nextId = 1;
let stats = { rounds: 0, coinsSpent: 0, coinsPaid: 0, cashouts: 0, busts: 0, players: 0 };
let lastRounds = [];
const seen = new Set();
let onEvent = (ev, info) => {};

function pad(m) { return m.toFixed(2); }

function newRound() {
  game = {
    id: 'tb_' + (nextId++),
    phase: 'wait',            // wait (pausa) | running | crashed
    bets: new Map(),          // userId -> bet (sempre CFG.bet por rodada)
    startAt: 0,
    crashAt: null,            // timestamp do crash
    nextPhaseAt: Date.now() + CFG.joinMs,  // janela de aposta inicial
    lastCrashMult: null
  };
}

function crashMult(m) { return m; }

function tick(db) {
  if (!game) newRound();
  const now = Date.now();
  if (game.phase === 'wait') {
    if (now >= game.nextPhaseAt) {
      game.phase = 'running';
      game.startAt = now;
      // calcula o instante do crash (exponencial discreto)
      let c = now + CFG.tickMs + Math.floor(Math.random() * CFG.tickMs);
      while (Math.random() > (1 - CFG.crashProbPerTick) && c - now < 60000) c += CFG.tickMs;
      game.crashAt = c;
    }
    return;
  }
  if (game.phase === 'running') {
    const mult = currentMult();
    // resgate automático de quem pediu
    for (const [uid, betSlot] of game.bets) if (!betSlot.cashed && betSlot.auto) cashOut(db, uid, true);
    if (now >= game.crashAt) {
      game.phase = 'crashed';
      game.lastCrashMult = mult;
      game.nextPhaseAt = now + CFG.pauseMs;
      stats.rounds++;
      for (const [uid, betSlot] of game.bets) {
        if (!betSlot.cashed) { stats.busts++; stats.coinsSpent += betSlot.bet; }
      }
      onEvent('round', { crashMult: mult, alive: game.bets.size });
    }
    return;
  }
  // fase crashed → nova rodada
  if (now >= game.nextPhaseAt) {
    lastRounds.unshift({ id: game.id, crash: game.lastCrashMult, bets: game.bets.size, t: now });
    if (lastRounds.length > 10) lastRounds.pop();
    newRound();
  }
}

function currentMult() {
  if (!game || game.phase !== 'running') return 1;
  const ticks = Math.floor((Date.now() - game.startAt) / CFG.tickMs);
  const m = 1 + CFG.step * ticks;
  return Math.min(m, crashAtLocal());
}
function crashAtLocal() {
  const ticks = Math.max(1, Math.floor((game.crashAt - game.startAt) / CFG.tickMs));
  return 1 + CFG.step * ticks;
}
function toWin(bet, mult) {
  // taxa aplicada só sobre o lucro
  return Math.floor(bet * (1 + (mult - 1) * (1 - CFG.edge)));
}

async function bet(db, userId, autoCash) {
  if (!userId) return { error: 'userId obrigatório' };
  if (!game || game.phase !== 'wait') return { error: 'Espere a próxima rodada começar' };
  if (game.bets.has(userId)) return { error: 'Você já apostou nesta rodada' };
  const user = await db.dbGetUser(userId);
  if (user.balance < CFG.bet) return { error: `Você precisa de ${CFG.bet} moedas` };
  const res = await db.dbSpendCoins(userId, CFG.bet);
  seen.add(userId);
  stats.players = seen.size;
  game.bets.set(userId, { bet: CFG.bet, cashed: false, auto: !!autoCash });
  return { ok: true, round: game.id, balance: res.balance, cashOut: toWin(CFG.bet, currentMult()) };
}

async function cashOut(db, userId, automatic) {
  if (!game || game.phase !== 'running') return { error: 'A roda ainda não começou' };
  const slot = game.bets.get(userId);
  if (!slot) return { error: 'Você não está com aposta nesta rodada' };
  if (slot.cashed) return { error: 'Já resgatou nesta rodada' };
  const m = currentMult();
  const won = toWin(slot.bet, m);
  slot.cashed = true;
  slot.won = won;
  stats.cashouts++;
  stats.coinsPaid += won;
  if (won > 0) {
    const cred = await db.dbAddCoins(userId, won);
    return automatic ? { ok: true } : { ok: true, won, mult: m, balance: cred.balance };
  }
  return automatic ? { ok: true } : { ok: true, won: 0, mult: m };
}

function snapshot(userId) {
  let mine = null;
  if (game && game.bets.has(userId)) {
    const s = game.bets.get(userId);
    mine = { cashed: s.cashed, bet: s.bet, auto: s.auto };
  }
  return {
    bet: CFG.bet,
    phase: game ? game.phase : 'wait',
    round: game ? game.id : null,
    mult: game ? currentMult() : 1,
    crash: game ? crashAtLocal() : 1,
    alive: game ? game.bets.size : 0,
    countdownMs: game ? Math.max(0, game.nextPhaseAt - Date.now()) : 0,
    mine,
    lastRounds,
    stats,
    taxa: CFG.edge
  };
}

function startLoop(db) {
  newRound();
  setInterval(() => tick(db), CFG.tickMs);
}

module.exports = {
  CFG,
  bet,
  cashOut,
  snapshot,
  status: snapshot,
  startLoop,
  set onEvent(fn) { onEvent = fn; }
};