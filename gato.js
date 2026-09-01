// Gatinho — máquina caça-níqueis do mascote gato + construção de vila.
// Giros da máquina dão moedas; o jogador usa as moedas p/ construir/evoluir a vila.
const CFG = {
  spinCost: Number(process.env.GT_SPIN_COST) || 20,
  // símbolos e seus multiplicadores quando 2 ou 3 iguais
  syms: [
    { e: '🐱', w: 5,  p2: 2,   p3: 10 },   // gato raro
    { e: '🐟', w: 14, p2: 1.4, p3: 4  },   // peixinho
    { e: '🧶', w: 16, p2: 1.2, p3: 3  },   // novelo
    { e: '🥛', w: 16, p2: 1.1, p3: 2.5},   // leite
    { e: '🐁', w: 22, p2: 1,   p3: 2  },   // rato
    { e: '💤', w: 24, p2: 0.8, p3: 1.5},   // sono
    { e: '❌', w: 28, p2: 0,   p3: 0  }    // nada (perde)
  ],
  // construções da vila (nome, emoji, custo, xp)
  buildings: [
    { id: 'gato',  nome: 'Casinha do Gato', e: '🏠', custo: 50,   xp: 10 },
    { id: 'peixe', nome: 'Lago de Peixes',  e: '🐟', custo: 120,  xp: 25 },
    { id: 'brin',  nome: 'Arranhador',      e: '🧶', custo: 250,  xp: 50 },
    { id: 'raç',   nome: 'Casa de Ração',   e: '🥣', custo: 500,  xp: 90 },
    { id: 'cast',  nome: 'Castelo do Gato', e: '🏰', custo: 1200, xp: 200 }
  ]
};

let stats = { spins: 0, coinsSpent: 0, coinsWon: 0, players: 0 };
const playersSet = new Set();
const recent = [];

function pickWeighted() {
  const total = CFG.syms.reduce((a, s) => a + s.w, 0);
  let r = Math.random() * total;
  for (const s of CFG.syms) {
    r -= s.w;
    if (r < 0) return s;
  }
  return CFG.syms[0];
}

function roll() {
  return [pickWeighted(), pickWeighted(), pickWeighted()];
}

// ingressão: dado um giro, quanto ganha (2 iguais → p2, 3 iguais → p3)
function computeWin(rollRes, cost) {
  const a = rollRes[0].e, b = rollRes[1].e, c = rollRes[2].e;
  if (a === b && a === c) {
    if (rollRes[0].p3 === 0) return { win: 0, kind: 'none' };
    return { win: Math.floor(cost * rollRes[0].p3), kind: 'all', e: rollRes[0].e };
  }
  const groups = {};
  for (const s of rollRes) groups[s.e] = (groups[s.e] || 0) + 1;
  for (const e in groups) {
    if (groups[e] === 2) {
      const sym = rollRes.find(s => s.e === e);
      if (sym.p2 === 0) return { win: 0, kind: 'none' };
      return { win: Math.floor(cost * sym.p2), kind: 'pair', e: sym.e };
    }
  }
  return { win: 0, kind: 'none' };
}

function villageSnapshot(char) {
  const v = (char && char.village) || {};
  const lvl = Math.floor(((v.level || 1) - 1) * 5 + (v.pp || 0));
  return {
    level: v.level || 1,
    pp: v.pp || 0,
    built: v.built || {},
    xpToNext: lvl * 40 + 30,
    coinsSpentBuilding: v.coinsSpent || 0
  };
}

async function spin(db, userId, nick) {
  if (!userId) return { error: 'userId obrigatório' };
  const user = await db.dbGetUser(userId);
  if (user.balance < CFG.spinCost) return { error: `Você precisa de ${CFG.spinCost} moedas pra girar` };
  const res = await db.dbSpendCoins(userId, CFG.spinCost);

  const rollRes = roll();
  const { win, kind, e } = computeWin(rollRes, CFG.spinCost);
  let credited = null;
  if (win > 0) credited = await db.dbAddCoins(userId, win);

  stats.spins++;
  stats.coinsSpent += CFG.spinCost;
  stats.coinsWon += win;
  playersSet.add(userId);
  stats.players = playersSet.size;

  recent.unshift({ nick: nick || 'anônimo', syms: rollRes.map(s => s.e), kind, win, t: Date.now() });
  if (recent.length > 15) recent.pop();

  return {
    ok: true,
    syms: rollRes.map(s => s.e),
    kind,
    e,
    win,
    balance: credited ? credited.balance : res.balance,
    spinCost: CFG.spinCost
  };
}

async function build(db, userId) {
  if (!userId) return { error: 'userId obrigatório' };
  const char = await db.dbGetCharacter(userId);
  const v = (char && char.village) || { level: 1, pp: 0, built: {}, coinsSpent: 0 };
  // escolhe a próxima construção não construída (ou a mais barata disponível)
  const idx = v.built && v.built.idx != null ? v.built.idx : -1;
  let nextIdx = idx + 1;
  if (nextIdx >= CFG.buildings.length) nextIdx = 0; // reinicia ciclo
  const b = CFG.buildings[nextIdx];

  const user = await db.dbGetUser(userId);
  if (user.balance < b.custo) return { error: `Precisa de ${b.custo} moedas p/ construir '${b.nome}'` };
  await db.dbSpendCoins(userId, b.custo);

  v.built = { idx: nextIdx, nome: b.nome, e: b.e, custo: b.custo };
  v.pp = (v.pp || 0) + b.xp;
  v.coinsSpent = (v.coinsSpent || 0) + b.custo;
  // sobe de nível a cada 5 construções
  v.level = Math.floor(((v.pp) / 100)) + 1;

  await db.dbSetCharacter(userId, { ...(char || defaultCharSafe()), village: v });

  return { ok: true, building: v.built, village: villageSnapshot(char ? { village: v } : { village: v }), balance: (await db.dbGetUser(userId)).balance };
}

function defaultCharSafe() {
  return { village: { level: 1, pp: 0, built: {}, coinsSpent: 0 } };
}

async function village(db, userId) {
  if (!userId) return { error: 'userId obrigatório' };
  const char = await db.dbGetCharacter(userId);
  const snap = villageSnapshot(char);
  // escolhe a próxima construção disponível
  const builtIdx = (snap.built && snap.built.idx != null) ? snap.built.idx : -1;
  let nextIdx = builtIdx + 1;
  if (nextIdx >= CFG.buildings.length) nextIdx = 0;
  const next = CFG.buildings[nextIdx];
  const user = await db.dbGetUser(userId);
  return { village: snap, next: next, balance: user.balance };
}

function snapshot() {
  return {
    spinCost: CFG.spinCost,
    buildings: CFG.buildings,
    recent,
    stats
  };
}

module.exports = {
  CFG,
  spin,
  build,
  village,
  snapshot,
  status: snapshot
};
