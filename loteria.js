// Loteria do Site — escolha um número 00-99; se cair, ganha 80x.
// Sorteio automático a cada 10 min. Margem da casa: 20% (80x sobre 1% de chance).
const CFG = {
  cost: Number(process.env.LT_COST) || 20,
  mult: Number(process.env.LT_MULT) || 80,
  intervalMs: Number(process.env.LT_INTERVAL_MS) || 600000, // 10 min
  maxNum: 100
};

let tickets = new Map();      // userId -> [{num, id}]
let nextDrawAt = Date.now() + CFG.intervalMs;
let lastDraws = [];           // [{num, winners, prize, t}]
let stats = { sold: 0, coinsSpent: 0, coinsPaid: 0, winners: 0 };
let nextId = 1;
let onEvent = (ev, info) => {};

function pad(n) { return String(n).padStart(2, '0'); }

function snapshot(userId) {
  let mine = [];
  if (userId && tickets.has(userId)) mine = tickets.get(userId);
  const queue = [...tickets.entries()];
  const players = queue.length;
  return {
    cost: CFG.cost,
    mult: CFG.mult,
    myTickets: mine,
    players,
    countdownMs: Math.max(0, nextDrawAt - Date.now()),
    lastDraws,
    stats
  };
}

async function buy(db, userId, picked) {
  if (!userId) return { error: 'userId obrigatório' };
  const num = Number(picked);
  if (!Number.isInteger(num) || num < 0 || num >= CFG.maxNum) return { error: 'Escolha um número de 00 a 99' };
  const user = await db.dbGetUser(userId);
  if (user.balance < CFG.cost) return { error: `Você precisa de ${CFG.cost} moedas pra comprar` };
  const res = await db.dbSpendCoins(userId, CFG.cost);
  if (!tickets.has(userId)) tickets.set(userId, []);
  const ticket = { num, id: 'lt_' + (nextId++) };
  tickets.get(userId).push(ticket);
  stats.sold++;
  stats.coinsSpent += CFG.cost;
  return {
    ok: true,
    ticket,
    num: pad(num),
    balance: res.balance,
    myTickets: tickets.get(userId)
  };
}

function performDraw(db) {
  const num = Math.floor(Math.random() * CFG.maxNum);
  const winners = [];
  for (const [userId, list] of tickets) {
    for (const t of list) {
      if (t.num === num) {
        winners.push({ userId });
        break;
      }
    }
  }
  let prize = 0;
  if (winners.length) {
    prize = winners.length === 1 ? CFG.cost * CFG.mult : Math.floor((CFG.cost * CFG.mult) / winners.length);
    for (const w of winners) db.dbAddCoins(w.userId, prize);
    stats.winners += winners.length;
    stats.coinsPaid += prize * winners.length;
    onEvent('winner', { userId: winners[0].userId, amount: prize, num: pad(num), winners: winners.length });
  }
  lastDraws.unshift({ num: pad(num), winners: winners.map(w => w.userId), prize, t: Date.now() });
  if (lastDraws.length > 12) lastDraws.pop();
  tickets = new Map();
  nextDrawAt = Date.now() + CFG.intervalMs;
  return { num: pad(num), winners: winners.length, prize };
}

function startLoop(db) {
  setInterval(() => {
    if (Date.now() >= nextDrawAt) performDraw(db);
  }, 1500);
}

module.exports = {
  CFG,
  buy,
  snapshot,
  status: snapshot,
  performDraw,
  startLoop,
  set onEvent(fn) { onEvent = fn; }
};