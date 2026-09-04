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
  maxShields: 5,                  // limite de escudos de proteção
  shieldPair: 1,                  // escudos por dupla
  shieldTriple: 3,                // escudos por trinca
  raidPrizeMult: 8,               // trinca de baú: prêmio = custo x isto
  raidExpiryMs: 120000,           // prazo para abrir o saque (baús)
  enemyStealPct: 0.15,            // % que o rato leva do alvo (ataque)
  defenseChance: 0.06,            // chance de um bot atacar você por giro
  defenseLossPct: 0.04,           // % do saldo perdido sem escudo
  defenseLossMin: 5,
  defenseLossMax: 80,
  syms: [
    { e: '🐱', w: 5,  kind: 'coins', p2: 2,   p3: 10 },   // gato raro
    { e: '🐟', w: 13, kind: 'coins', p2: 1.4, p3: 4  },   // peixinho
    { e: '🧶', w: 15, kind: 'coins', p2: 1.2, p3: 3  },   // novelo
    { e: '🥛', w: 15, kind: 'coins', p2: 1.1, p3: 2.5},   // leite
    { e: '🐁', w: 18, kind: 'coins', p2: 1,   p3: null },  // rato: trinca = ATAQUE (🥷)
    { e: '🛡️', w: 12, kind: 'shield', p2: 0,   p3: 0.5 },  // escudo / proteção
    { e: '🎁', w: 12, kind: 'raid', p2: 0,   p3: null },   // baú: dupla/trinca = SAQUE
    { e: '❌', w: 26, kind: 'lose', p2: 0,   p3: 0  }      // nada (perde)
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

let stats = { spins: 0, coinsSpent: 0, coinsWon: 0, players: 0, villages: 0, advances: 0,
              raids: 0, attacks: 0, shields: 0, defenses: 0 };
const playersSet = new Set();
const recent = [];

function getConfig() { return JSON.parse(JSON.stringify(CFG)); }

// PRNG determinístico (mulberry32) — servidor decide, cliente só anima
function seeded(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- MOTOR DE VILAS (dados) --------------------------------------------
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
  return { vid: 1, built: {}, coinsSpent: 0, pp: 0, level: 1, lastDaily: null, advances: 0, shields: 0, raid: null };
}

// "fortuna" de uma vila adversária (bot) — determinística por vila e dia
function enemyLoot(vid) {
  const n = Math.max(1, Math.min(2000, Number(vid) || 1));
  const day = Math.floor(Date.now() / 86400000);
  const s = seeded(n * 7919 + day * 101);
  const growth = 1 + (n - 1) * CFG.villageCostGrowth;
  return Math.round((60 + s() * 160) * growth);
}

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
    shields: Math.min(CFG.maxShields, v.shields || 0),
    maxShields: CFG.maxShields,
    hasRaid: !!(v.raid && v.raid.exp > Date.now()),
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

// O SERVIDOR decide o resultado (especial ou moedas). O cliente só anima.
function computeWin(rollRes, cost) {
  const a = rollRes[0], b = rollRes[1], c = rollRes[2];
  const uniform = a.e === b.e && a.e === c.e;
  const groups = {};
  for (const s of rollRes) groups[s.e] = (groups[s.e] || 0) + 1;

  // ESPECIAIS
  const specials = ['🛡️', '🎁', '🐁'];
  for (const e of specials) {
    if (groups[e] === 3) {
      if (e === '🛡️') return { win: Math.floor(cost * 0.5), kind: 'shield', guard: CFG.shieldTriple };
      if (e === '🎁') return { win: Math.floor(cost * CFG.raidPrizeMult), kind: 'raid' };
      if (e === '🐁') return { win: 0, kind: 'attack' }; // 🥷 rato ataca!
    }
    if (groups[e] === 2 && e === '🛡️') return { win: 0, kind: 'shield', guard: CFG.shieldPair };
    if (groups[e] === 2 && e === '🎁') return { win: 0, kind: 'raid' };
  }
  // O resto paga moedas no par/trinca
  const sym = uniform ? a : (groups[a.e] === 2 || groups[b.e] === 2 || groups[c.e] === 2
    ? (groups[a.e] === 2 ? a : (groups[b.e] === 2 ? b : c)) : null);
  if (!sym || sym.kind !== 'coins' || sym.p2 === 0) return { win: 0, kind: 'none' };
  if (uniform && sym.p3) return { win: Math.floor(cost * sym.p3), kind: 'all', e: sym.e };
  if (!uniform && groups[sym.e] === 2) return { win: Math.floor(cost * sym.p2), kind: 'pair', e: sym.e };
  return { win: 0, kind: 'none' };
}

// Conta os escudos atuais de um villager (persistidos em v.shields)
function getShields(v) { return Math.min(CFG.maxShields, v.shields || 0); }

function setShields(v, n) { v.shields = Math.max(0, Math.min(CFG.maxShields, n)); }

// ---- AÇÕES --------------------------------------------------------------

async function spin(db, userId, nick) {
  if (!userId) return { error: 'userId obrigatório' };
  const user = await db.dbGetUser(userId);
  if (user.balance < CFG.spinCost) return { error: `Você precisa de ${CFG.spinCost} moedas pra girar` };
  await db.dbSpendCoins(userId, CFG.spinCost);

  const rollRes = roll();
  const { win, kind, guard, e } = computeWin(rollRes, CFG.spinCost);
  let credited = null;
  const out = { ok: true, syms: rollRes.map(s => s.e), kind, e, win: 0, guard: 0, balance: null, defense: null };

  // carrega vila p/ efeitos de estado (escudo, saque, ataque)
  const char = await db.dbGetCharacter(userId);
  const v = { ...defaultVillage(), ...((char && char.village) || {}) };
  let changed = false;

  // prêmio em moedas imediato (baú paga só na abertura do saque)
  if (win > 0 && kind !== 'raid') { credited = await db.dbAddCoins(userId, win); out.win = win; }

  if (kind === 'shield') {
    setShields(v, getShields(v) + guard);
    out.guard = guard;
    v.pp = (v.pp || 0) + 5; changed = true; stats.shields += guard;
  } else if (kind === 'raid') {
    const s = seeded(userId.length * 31 + Date.now() % 100000);
    const loot = s() * 0.4 + 0.3; // fator do prêmio do baú
    v.raid = { i: Math.floor(s() * 3), coins: Math.max(10, Math.round(loot * win)), exp: Date.now() + CFG.raidExpiryMs };
    // 🎁 baú pode vir sem prêmio grande: usa trinca=win
    if (v.raid.coins <= 0) v.raid = { i: Math.floor(s() * 3), coins: 20, exp: Date.now() + CFG.raidExpiryMs };
    changed = true; stats.raids++;
  } else if (kind === 'attack') {
    // 🥷 o rato ataca uma vila adversária (bot) e rouba moedas
    const target = v.vid < 2000 ? v.vid + 1 : 1;
    const loot = enemyLoot(target);
    const gain = Math.max(10, Math.round(loot * CFG.enemyStealPct));
    credited = await db.dbAddCoins(userId, gain);
    out.win = gain; out.attack = { target, loot, gain };
    v.pp = (v.pp || 0) + 10; changed = true; stats.attacks++;
  }

  // contra-ataque de bot: seu escudo bloqueia, senão perde um pouco
  if (Math.random() < CFG.defenseChance) {
    if (getShields(v) > 0) {
      setShields(v, getShields(v) - 1);
      out.defense = { blocked: true, lost: 0 }; changed = true; stats.defenses++;
    } else {
      const balance = credited ? credited.balance : user.balance - CFG.spinCost;
      const lost = Math.min(balance, Math.max(CFG.defenseLossMin, Math.round(balance * CFG.defenseLossPct)));
      if (lost > 0) {
        await db.dbSpendCoins(userId, lost);
        out.defense = { blocked: false, lost };
        stats.defenses++;
      }
    }
  }

  if (changed) await db.dbSetCharacter(userId, { ...(char || {}), village: v });

  stats.spins++;
  stats.coinsSpent += CFG.spinCost;
  stats.coinsWon += out.win;
  playersSet.add(userId);
  stats.players = playersSet.size;

  recent.unshift({ nick: nick || 'anônimo', syms: rollRes.map(s => s.e), kind, win: out.win, t: Date.now() });
  if (recent.length > 15) recent.pop();

  out.balance = credited ? credited.balance : (await db.dbGetUser(userId)).balance;

  if (kind === 'raid') {
    out.chests = [0, 1, 2].map(i => ({ i }));
    out.raidExpirySec = Math.floor(CFG.raidExpiryMs / 1000);
  }
  return out;
}

// Abrir o baú escolhido do SAQUE (servidor já decidiu o prêmio no spin)
async function raid(db, userId, pick) {
  if (!userId) return { error: 'userId obrigatório' };
  if (![0, 1, 2].includes(Number(pick))) return { error: 'Escolha inválida' };
  const char = await db.dbGetCharacter(userId);
  const v = { ...defaultVillage(), ...((char && char.village) || {}) };
  const r = v.raid;
  if (!r || r.exp < Date.now()) return { error: 'Este saque expirou. Gire um baú de novo!' };
  if (r.i !== Number(pick)) return { error: 'Tente novamente! Nesse baú tinha poeira 🕸️' };
  v.raid = null;
  await db.dbAddCoins(userId, r.coins);
  await db.dbSetCharacter(userId, { ...(char || {}), village: v });
  return { ok: true, prize: r.coins, balance: (await db.dbGetUser(userId)).balance };
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
    maxShields: CFG.maxShields,
    recent,
    stats
  };
}

module.exports = {
  CFG,
  getConfig,
  villaDef,
  spin,
  raid,
  build,
  advance,
  daily,
  village,
  snapshot,
  status: snapshot
};