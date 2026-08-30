// Batalha 1x1 de Cartas — PvP com 3 cartas, blefe e "melhor de 3".
// Os dois escolhem ao mesmo tempo uma carta da sua mão; maior valor vence
// a rodada. Cada rodada consome 1 carta; após 3 rodadas o maior placar
// leva o pote (90%; 10% fica pra casa). Empate devolve as apostas.
const CFG = {
  bet: Number(process.env.CC_BET) || 50,
  pickTimeMs: Number(process.env.CC_PICK_MS) || 30000,
  houseCut: 0.10,
  cards: 3,
  maxValue: 9,
  queueWindowMs: 90000,   // quanto tempo pode esperar na fila
  resultShowMs: Number(process.env.CC_SHOW_MS) || 6000
};

let queue = [];
const matches = new Map();
const playersSeen = new Set();
let nextId = 1;
const stats = { matches: 0, coinsSpent: 0, coinsPaid: 0, players: 0 };
let onEvent = (ev, info) => {};

function uid() { return 'cc_' + (++nextId); }
function dealHand() {
  const c = [];
  for (let i = 0; i < 3; i++) c.push(1 + Math.floor(Math.random() * 9));
  return c.sort((a, b) => a - b);
}
function ensureUsed(m) { if (!m.cardsUsed) m.cardsUsed = new Map(); }
function usedIdx(m, uid) { ensureUsed(m); return m.cardsUsed.get(uid) || []; }
function remaining(m, uid) {
  return m.hands.get(uid).filter((_, i) => !usedIdx(m, uid).includes(i));
}

function makeMatch(pa, pb) {
  const id = uid();
  const m = {
    id,
    players: [pa.userId, pb.userId],
    nicks: new Map([[pa.userId, pa.nick], [pb.userId, pb.nick]]),
    hands: new Map([[pa.userId, dealHand()], [pb.userId, dealHand()]]),
    picked: new Map(),
    cardsUsed: new Map(),
    round: 1,
    scores: new Map([[pa.userId, 0], [pb.userId, 0]]),
    pot: CFG.bet * 2,
    phase: 'pick',
    lastResult: null,
    winner: null, won: 0,
    endsAt: Date.now() + CFG.pickTimeMs
  };
  matches.set(id, m);
  return m;
}

function view(m, userId) {
  const opp = m.players.find(p => p !== userId);
  if (!opp) return null;
  const hand = m.hands.get(userId);
  const used = usedIdx(m, userId);
  const myAvail = hand.map((v, i) => ({ value: v, idx: i })).filter(c => !used.includes(c.idx));
  return {
    matchId: m.id,
    phase: m.phase,
    round: m.round,
    scores: { you: m.scores.get(userId), rival: m.scores.get(opp) },
    myCards: hand,
    myAvailable: myAvail,
    myPicked: m.picked.has(userId) ? { idx: m.picked.get(userId), value: hand[m.picked.get(userId)] } : null,
    rivalCardsLeft: remaining(m, opp).length,
    pot: m.pot,
    opponent: m.nicks.get(opp),
    lastResult: m.lastResult ? {
      yourCard: m.lastResult.cards[userId],
      rivalCard: m.lastResult.cards[opp],
      roundWinner: m.lastResult.winner === 'draw' ? 'draw' : (m.lastResult.winner === userId ? 'you' : 'rival')
    } : null,
    winner: m.winner, won: m.won,
    endsAt: m.endsAt
  };
}

function resolveRound(m) {
  const [a, b] = m.players;
  const ia = m.picked.get(a), ib = m.picked.get(b);
  const va = m.hands.get(a)[ia], vb = m.hands.get(b)[ib];
  let winner = 'draw';
  if (va > vb) { m.scores.set(a, m.scores.get(a) + 1); winner = a; }
  else if (vb > va) { m.scores.set(b, m.scores.get(b) + 1); winner = b; }
  m.lastResult = { cards: { [a]: va, [b]: vb }, winner };
  m.phase = 'resolved';
  m.endsAt = Date.now() + CFG.resultShowMs;
}

function startRound(m, db) {
  m.picked = new Map();
  const done = m.players.every(p => remaining(m, p).length === 0);
  if (done) { payOut(m, db); return; }
  m.round++;
  m.phase = 'pick';
  m.endsAt = Date.now() + CFG.pickTimeMs;
}

function payOut(m, db) {
  const [a, b] = m.players;
  m.pot;
  if (m.scores.get(a) === m.scores.get(b)) {
    db.dbAddCoins(a, CFG.bet);
    db.dbAddCoins(b, CFG.bet);
    m.phase = 'draw';
    stats.coinsPaid += CFG.bet * 2;
  } else {
    const winner = m.scores.get(a) > m.scores.get(b) ? a : b;
    const won = Math.floor(m.pot * (1 - CFG.houseCut));
    db.dbAddCoins(winner, won);
    m.winner = winner;
    m.won = won;
    m.phase = 'winner';
    stats.coinsPaid += won;
    onEvent('winner', { userId: winner, nick: m.nicks.get(winner), amount: won });
  }
  m.endsAt = Date.now() + CFG.resultShowMs + 8000;
  stats.matches++;
  stats.players = playersSeen.size;
  db.dbGetUser(a).then(() => {});
}

function autoPick(m, uid) {
  const avail = remaining(m, uid);
  if (!avail.length) return;
  const mid = Math.floor((avail.length - 1) / 2);
  const target = avail[mid];                 // remaining retorna números, não objetos
  const hand = m.hands.get(uid);
  const handIdx = hand.findIndex((v, i) => v === target && !usedIdx(m, uid).includes(i));
  if (handIdx >= 0 && !m.picked.has(uid)) {
    m.picked.set(uid, handIdx);
    ensureUsed(m);
    if (!m.cardsUsed.has(uid)) m.cardsUsed.set(uid, []);
    m.cardsUsed.get(uid).push(handIdx);
  }
}

function doPick(m, uid, cardIdx) {
  const hand = m.hands.get(uid);
  if (!hand || cardIdx == null || cardIdx < 0 || cardIdx >= hand.length) return { error: 'carta inválida' };
  if (usedIdx(m, uid).includes(cardIdx)) return { error: 'essa carta já foi jogada' };
  m.picked.set(uid, cardIdx);
  ensureUsed(m);
  if (!m.cardsUsed.has(uid)) m.cardsUsed.set(uid, []);
  m.cardsUsed.get(uid).push(cardIdx);
  if (m.picked.size === 2) resolveRound(m);
  return { ok: true };
}

function findMatchOf(uid, live=true) {
  for (const m of matches.values()) {
    if (m.players.includes(uid) && (m.phase === 'pick' || m.phase === 'resolved' || (live && m.phase === 'winner') || (live && m.phase === 'draw'))) return m;
  }
  return null;
}

function tick(db) {
  const now = Date.now();
  for (const m of matches.values()) {
    if (m.phase === 'pick' && now > m.endsAt) {
      for (const p of m.players) if (!m.picked.has(p)) autoPick(m, p);
      if (m.picked.size === 2) resolveRound(m);
    } else if (m.phase === 'resolved' && now > m.endsAt) {
      startRound(m, db);
    } else if ((m.phase === 'winner' || m.phase === 'draw') && now > m.endsAt) {
      matches.delete(m.id);
    }
  }
  // fila expirada: devolve a aposta
  if (queue.length) {
    const qe = queue.shift();
    if (now - qe.t < CFG.queueWindowMs) queue.unshift(qe);
    else db.dbAddCoins(qe.userId, CFG.bet);
  }
}

async function join(db, userId, nick) {
  if (!userId) return { error: 'userId obrigatório' };
  const user = await db.dbGetUser(userId);
  if (user.balance < CFG.bet) return { error: `Você precisa de ${CFG.bet} moedas para entrar` };
  if (findMatchOf(userId)) return { error: 'Você já está numa partida' };
  if (queue.some(q => q.userId === userId)) return { error: 'Você já está na fila' };

  await db.dbSpendCoins(userId, CFG.bet);
  playersSeen.add(userId);
  const opp = queue.find(q => q.userId !== userId);
  if (opp) {
    queue = queue.filter(q => q !== opp);
    const m = makeMatch(opp, { userId, nick: nick || 'anônimo' });
    return { ok: true, status: 'match', match: view(m, userId) };
  }
  queue.unshift({ userId, nick: nick || 'anônimo', t: Date.now() });
  return { ok: true, status: 'queue', waiting: queue.length };
}

function pick(db, userId, cardIdx) {
  const m = findMatchOf(userId);
  if (!m) return { error: 'Você não está numa partida ou ela terminou' };
  if (m.phase !== 'pick') return { error: 'Aguarde a rodada atual terminar' };
  const r = doPick(m, userId, cardIdx);
  if (r.error) return r;
  return { ok: true, match: view(m, userId) };
}

function status(userId) {
  const m = findMatchOf(userId, false);
  if (m) return { inMatch: true, match: view(m, userId) };
  if (queue.some(q => q.userId === userId)) return { inMatch: false, inQueue: true, waiting: queue.length, bet: CFG.bet };
  return { inMatch: false, inQueue: false, waiting: queue.length, bet: CFG.bet };
}

function snapshot() {
  return { waiting: queue.length, matches: matches.size, bet: CFG.bet, stats };
}

module.exports = {
  CFG,
  join,
  pick,
  status,
  startLoop(db) { setInterval(() => tick(db), 800); },
  snapshot,
  set onEvent(fn) { onEvent = fn; }
};