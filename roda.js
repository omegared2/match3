// Roda da Fortuna — gire a roda, acerte o prêmio.
// A roda gira NO SERVIDOR (aleatório ponderado, sem trapaça do cliente).
// 3% de cada giro alimenta o pote; quem cair em JACKPOT leva o pote inteiro.
const CFG = {
  spinCost: Number(process.env.RW_SPIN_COST) || 30,
  potFeed: 0.03,          // % de cada giro que vai pro pote
  // pesos: EV ≈ 0.885 (margem ~11% p/ a casa; saudável e ainda divertida)
  weights: [
    { mult: 0,   w: 45 },
    { mult: 1,   w: 26 },
    { mult: 1.5, w: 11 },
    { mult: 2,   w: 9 },
    { mult: 3,   w: 6 },
    { mult: 5,   w: 2 },
    { mult: 'JACKPOT', w: 1 }
  ]
};

let pot = 0;
let stats = { spins: 0, coinsSpent: 0, coinsPaid: 0, jackpots: 0, players: 0 };
const playersSet = new Set();
const recent = [];    // últimos 20 resultados
let onEvent = (ev, info) => {};

function pickWeighted() {
  const total = CFG.weights.reduce((a, s) => a + s.w, 0);
  let r = Math.random() * total;
  for (const seg of CFG.weights) {
    r -= seg.w;
    if (r < 0) return seg;
  }
  return CFG.weights[0];
}

function snapshot() {
  return {
    spinCost: CFG.spinCost,
    pot: Math.floor(pot),
    recent,
    stats
  };
}

async function spin(db, userId, nick) {
  if (!userId) return { error: 'userId obrigatório' };
  const user = await db.dbGetUser(userId);
  if (user.balance < CFG.spinCost) return { error: `Você precisa de ${CFG.spinCost} moedas pra girar` };
  const res = await db.dbSpendCoins(userId, CFG.spinCost);

  const seg = pickWeighted();
  const isJackpot = seg.mult === 'JACKPOT';
  const potDrain = isJackpot ? Math.floor(pot) : 0;
  const feed = Math.max(1, Math.ceil(CFG.spinCost * CFG.potFeed));
  if (!isJackpot) pot += feed;

  let won = 0;
  let credited = null;
  if (isJackpot) {
    won = Math.max(potDrain, 1);
    pot = 0;
    stats.jackpots++;
    playersSet.add(userId);
    stats.coinsPaid += won;
    onEvent('jackpot', { userId, nick, amount: won });
  } else {
    won = Math.floor(CFG.spinCost * seg.mult);
    stats.coinsPaid += won;
    if (won > 0) credited = await db.dbAddCoins(userId, won);
  }

  stats.spins++;
  stats.coinsSpent += CFG.spinCost;
  playersSet.add(userId);
  stats.players = playersSet.size;

  recent.unshift({ nick: nick || 'anônimo', mult: seg.mult, won, t: Date.now() });
  if (recent.length > 20) recent.pop();

  return {
    ok: true,
    segmentIndex: CFG.weights.findIndex(s => s.mult === seg.mult),
    mult: seg.mult,
    won,
    pot: Math.floor(pot),
    balance: credited ? credited.balance : res.balance,
    jackpot: isJackpot
  };
}

module.exports = {
  CFG,
  spin,
  snapshot,
  status: snapshot,
  set onEvent(fn) { onEvent = fn; }
};