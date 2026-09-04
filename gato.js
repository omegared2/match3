// Gatinho — motor de vilas (Village Engine) + máquina de giros.
// PRINCÍPIO: UMA vila NÃO são 2000 telas — é 1 motor dirigido por dados.
//   vila_id = 1..2000 → villaDef(id) gera nome/mundo/tema/custos na hora.
// Configuração central aqui embaixo (CFG) — tudo vem de um lugar só.
const CFG = {
  spinCost: Number(process.env.GT_SPIN_COST) || 20,
  dailyReward: Number(process.env.GT_DAILY_REWARD) || 40,
  villageCostGrowth: Number(process.env.GT_COST_GROWTH) || 0.06, // +6% de custo por vila
  ppPerLevel: Number(process.env.GT_PP_PER_LEVEL) || 250,
  buildingsPerVillage: 5,
  tiers: 5,                       // cada construção tem 5 níveis
  tierMult: [1, 1.6, 2.5, 4, 6],  // multiplicador de custo por nível
  tierXp: [10, 15, 25, 40, 60],
  syms: [
    { e: '🐱', w: 5,  p2: 2,   p3: 10 },   // gato raro
    { e: '🐟', w: 14, p2: 1.4, p3: 4  },   // peixinho
    { e: '🧶', w: 16, p2: 1.2, p3: 3  },   // novelo
    { e: '🥛', w: 16, p2: 1.1, p3: 2.5},   // leite
    { e: '🐁', w: 22, p2: 1,   p3: 2  },   // rato
    { e: '💤', w: 24, p2: 0.8, p3: 1.5},   // sono
    { e: '❌', w: 28, p2: 0,   p3: 0  }    // nada (perde)
  ],
  // as 5 construções da vila (cada uma evolui do nível 1 ao 5)
  buildings: [
    { id: 'gato',  nome: 'Casinha do Gato', e: '🏠', custo: 50 },
    { id: 'peixe', nome: 'Lago de Peixes',  e: '🐟', custo: 120 },
    { id: 'brin',  nome: 'Arranhador',      e: '🧶', custo: 250 },
    { id: 'rac',   nome: 'Casa de Ração',   e: '🥣', custo: 500 },
    { id: 'cast',  nome: 'Castelo do Gato', e: '🏰', custo: 1000 }
  ],
  // 20 mundos × 100 vilas = 2.000 vilas (temas trocáveis sem tocar no motor)
  worlds: ['Mundo Inicial', 'Floresta', 'Praia', 'Montanhas', 'Cidade', 'Deserto',
           'Neve', 'Espaço', 'Mundo Mágico', 'Submarino', 'Futurista',
           'Ilhas Tropicais', 'Reino dos Gatos', 'Mundo Antigo', 'Mundo Mecânico',
           'Mundo Lendário', 'Mundo Cósmico', 'Mundo dos Sonhos', 'Mundo Supremo',
           'Mundo Final'],
  worldEmoji: ['🌱', '🌲', '🏖️', '⛰️', '🏙️', '🏜️', '❄️', '🚀', '🪄', '🌊',
               '🤖', '🏝️', '👑', '🏺', '⚙️', '🐉', '🌌', '💤', '✨', '🔥']
};

let stats = { spins: 0, coinsSpent: 0, coinsWon: 0, players: 0, villages: 0, advances: 0 };
const playersSet = new Set();
const recent = [];

function getConfig() { return JSON.parse(JSON.stringify(CFG)); }

// ---- MOTOR DE VILAS (dados) --------------------------------------------
// Uma função pura define QUALQUER vila de 1 a 2000 em tempo real.
function villaDef(id) {
  const n = Math.max(1, Math.min(2000, Number(id) || 1));
  const wIdx = Math.floor((n - 1) / 100) % CFG.worlds.length;
  const inWorld = ((n - 1) % 100) + 1;
  const growth = 1 + (n - 1) * CFG.villageCostGrowth;
  const blds = CFG.buildings.map((b, i) => ({
    id: b.id, nome: b.nome, e: b.e,
    base: Math.round(b.custo * (1 + i * 0.15) * growth)
  }));
  return {
    id: n,
    world: CFG.worlds[wIdx],
    worldEmoji: CFG.worldEmoji[wIdx],
    name: `${CFG.worldEmoji[wIdx]} Vila ${n}`,
    inWorld,
    buildings: blds
  };
}

function defaultVillage() {
  return { vid: 1, built: {}, coinsSpent: 0, pp: 0, level: 1, lastDaily: null, advances: 0 };
}

// custo do nível (tier) 1..5 de uma construção em determinada vila
function buildCost(vdef, tier) {
  const b = vdef.buildings[tier.bi];
  return Math.round(b.base * CFG.tierMult[tier.tier - 1]);
}

function makeBuiltMap(v) {
  const out = {};
  const raw = v.built || {};
  // migração: registros antigos guardavam só `idx` (1 ciclo por construção)
  if (raw.idx != null && CFG.buildings[raw.idx]) {
    out[CFG.buildings[raw.idx].id] = 5;
    return out;
  }
  for (const k of Object.keys(raw)) {
    if (CFG.buildings.some(b => b.id === k)) out[k] = Math.min(CFG.tiers, Number(raw[k]) || 1);
  }
  return out;
}

function nextBuildIndex(vdef, built) {
  for (let i = 0; i < CFG.buildings.length; i++) {
    if ((built[CFG.buildings[i].id] || 0) < CFG.tiers) return i;
  }
  return -1; // vila completa
}

function villageSnapshot(v) {
  const vdef = villaDef(v.vid);
  const built = makeBuiltMap(v);
  const nextBi = nextBuildIndex(vdef, built);
  const complete = nextBi === -1;
  const pp = v.pp || 0;
  const level = Math.floor(pp / CFG.ppPerLevel) + 1;
  const xpToNext = CFG.ppPerLevel - (pp % CFG.ppPerLevel);
  let next = null;
  if (!complete) {
    const b = CFG.buildings[nextBi];
    const tier = (built[b.id] || 0) + 1;
    const t = { bi: nextBi, id: b.id, nome: b.nome, e: b.e, tier, max: CFG.tiers };
    next = { ...t, custo: buildCost(vdef, t) };
  }
  return {
    vid: v.vid,
    world: vdef.world,
    worldEmoji: vdef.worldEmoji,
    name: vdef.name,
    inWorld: vdef.inWorld,
    totalVillages: 2000,
    maxWorlds: CFG.worlds.length,
    level,
    pp,
    ppPerLevel: CFG.ppPerLevel,
    xpToNext,
    built,
    complete,
    next,
    coinsSpent: v.coinsSpent || 0,
    advances: v.advances || 0,
    daily: {
      reward: CFG.dailyReward,
      available: canClaimDaily(v)
    }
  };
}

function canClaimDaily(v) {
  const today = new Date().toISOString().slice(0, 10);
  return v.lastDaily !== today;
}

function pickWeighted() {
  const total = CFG.syms.reduce((a, s) => a + s.w, 0);
  let r = Math.random() * total;
  for (const s of CFG.syms) {
    r -= s.w;
    if (r < 0) return s;
  }
  return CFG.syms[0];
}

function roll() { return [pickWeighted(), pickWeighted(), pickWeighted()]; }

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

// ---- AÇÕES --------------------------------------------------------------

async function spin(db, userId, nick) {
  if (!userId) return { error: 'userId obrigatório' };
  const user = await db.dbGetUser(userId);
  if (user.balance < CFG.spinCost) return { error: `Você precisa de ${CFG.spinCost} moedas pra girar` };
  await db.dbSpendCoins(userId, CFG.spinCost);

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
    balance: credited ? credited.balance : (await db.dbGetUser(userId)).balance,
    spinCost: CFG.spinCost
  };
}

async function build(db, userId) {
  if (!userId) return { error: 'userId obrigatório' };
  const char = await db.dbGetCharacter(userId);
  const v = { ...defaultVillage(), ...((char && char.village) || {}) };
  const vdef = villaDef(v.vid);
  const built = makeBuiltMap(v);
  const bi = nextBuildIndex(vdef, built);
  if (bi === -1) return { error: 'Esta vila já está completa! Aperte Avançar.' };
  const b = CFG.buildings[bi];
  const tier = (built[b.id] || 0) + 1;
  const t = { bi, id: b.id, nome: b.nome, e: b.e, tier, max: CFG.tiers };
  const custo = buildCost(vdef, t);

  const user = await db.dbGetUser(userId);
  if (user.balance < custo) return { error: `Precisa de ${custo} moedas p/ '${b.nome}' nível ${tier}` };
  await db.dbSpendCoins(userId, custo);

  built[b.id] = tier;
  v.built = built;
  v.coinsSpent = (v.coinsSpent || 0) + custo;
  v.pp = (v.pp || 0) + CFG.tierXp[tier - 1];
  await db.dbSetCharacter(userId, { ...(char || {}), village: v });

  return {
    ok: true,
    building: t,
    village: villageSnapshot(v),
    balance: (await db.dbGetUser(userId)).balance
  };
}

async function advance(db, userId) {
  if (!userId) return { error: 'userId obrigatório' };
  const char = await db.dbGetCharacter(userId);
  const v = { ...defaultVillage(), ...((char && char.village) || {}) };
  const vdef = villaDef(v.vid);
  const built = makeBuiltMap(v);
  if (nextBuildIndex(vdef, built) !== -1) return { error: 'Termine as 5 construções antes de avançar.' };

  const bonus = Math.round(150 * (1 + (v.vid - 1) * CFG.villageCostGrowth));
  await db.dbAddCoins(userId, bonus);
  const oldWorld = vdef.world;
  v.vid = Math.min(2000, v.vid + 1);
  v.built = {};
  v.advances = (v.advances || 0) + 1;

  // recompensa a XP ao concluir a vila
  v.pp = (v.pp || 0) + 20;
  await db.dbSetCharacter(userId, { ...(char || {}), village: v });

  stats.villages++;
  stats.advances++;

  return {
    ok: true,
    fromWorld: oldWorld,
    to: villaDef(v.vid),
    reward: bonus,
    village: villageSnapshot(v),
    balance: (await db.dbGetUser(userId)).balance
  };
}

async function daily(db, userId) {
  if (!userId) return { error: 'userId obrigatório' };
  const char = await db.dbGetCharacter(userId);
  const v = { ...defaultVillage(), ...((char && char.village) || {}) };
  if (!canClaimDaily(v)) return { error: 'Diária já resgatada hoje. Volte amanhã!' };
  const today = new Date().toISOString().slice(0, 10);
  v.lastDaily = today;
  await db.dbAddCoins(userId, CFG.dailyReward);
  await db.dbSetCharacter(userId, { ...(char || {}), village: v });
  return {
    ok: true,
    reward: CFG.dailyReward,
    balance: (await db.dbGetUser(userId)).balance
  };
}

async function village(db, userId) {
  if (!userId) return { error: 'userId obrigatório' };
  const char = await db.dbGetCharacter(userId);
  const v = { ...defaultVillage(), ...((char && char.village) || {}) };
  const user = await db.dbGetUser(userId);
  return {
    village: villageSnapshot(v),
    balance: user.balance,
    worldIndex: Math.floor((v.vid - 1) / 100) % CFG.worlds.length
  };
}

function snapshot() {
  return {
    spinCost: CFG.spinCost,
    dailyReward: CFG.dailyReward,
    buildings: CFG.buildings.map(b => ({ id: b.id, nome: b.nome, e: b.e })),
    totalVillages: 2000,
    maxWorlds: CFG.worlds.length,
    worlds: CFG.worlds.map((w, i) => ({ name: w, emoji: CFG.worldEmoji[i] })),
    recent,
    stats
  };
}

module.exports = {
  CFG,
  getConfig,
  villaDef,
  spin,
  build,
  advance,
  daily,
  village,
  snapshot,
  status: snapshot
};