// Gatinho — motor de vilas (Village Engine) + máquina de giros.
// PRINCÍPIO: UMA vila NÃO são 2000 telas — é 1 motor dirigido por dados.
//   vila_id = 1..2000 → villaDef(id) gera nome/mundo/tema/custos na hora.
const CFG = {
  spinCost: Number(process.env.GT_SPIN_COST) || 20,
  betGrowth: Number(process.env.GT_BET_GROWTH) || 0.025,   // aposta cresce 2,5%/vila (junto do ganho)
  payoutMult: Number(process.env.GT_PAYOUT_MULT) || 8,      // o giro precisa pagar acima do custo (EV>0)
  dailyReward: Number(process.env.GT_DAILY_REWARD) || 40,
  villageCostGrowth: Number(process.env.GT_COST_GROWTH) || 0.03,
  ppPerLevel: Number(process.env.GT_PP_PER_LEVEL) || 250,
  buildingsPerVillage: 5,
  tiers: 5,
  tierMult: [1, 1.6, 2.5, 4, 6],
  tierXp: [10, 15, 25, 40, 60],
  maxShields: 5,
  shieldPair: 1,
  shieldTriple: 3,
  raidPrizeMult: 8,
  raidExpiryMs: 120000,
  enemyStealPct: 0.15,
  defenseChance: 0.06,
  defenseLossPct: 0.04,
  defenseLossMin: 5,
  defenseLossMax: 80,
  catDrop: { comum: 60, raro: 27, epico: 10, lendario: 3 },
  catDupe: { comum: 20, raro: 50, epico: 120, lendario: 300 },
  catTripleCoins: 4,
  catSinglePity: 15,
  luckConsolation: 10,
  streakBase: 0.25,
  streakMax: 7,
  streakFinalMult: 2.5,
  syms: [
    { e: '🐱', w: 5,  kind: 'coins', p2: 2,   p3: 10 },
    { e: '🐟', w: 13, kind: 'coins', p2: 1.4, p3: 4  },
    { e: '🧶', w: 15, kind: 'coins', p2: 1.2, p3: 3  },
    { e: '🥛', w: 15, kind: 'coins', p2: 1.1, p3: 2.5},
    { e: '🐁', w: 18, kind: 'coins', p2: 1,   p3: null },
    { e: '🛡️', w: 12, kind: 'shield', p2: 0,   p3: 0.5 },
    { e: '🎁', w: 12, kind: 'raid', p2: 0,   p3: null },
    { e: '🐾', w: 14, kind: 'cat', p2: 0,   p3: null },
    { e: '❌', w: 22, kind: 'lose', p2: 0,   p3: 0  }
  ],
  buildings: [
    { id: 'gato',  nome: 'Casinha do Gato', e: '🏠', custo: 10 },
    { id: 'peixe', nome: 'Lago de Peixes',  e: '🐟', custo: 20 },
    { id: 'brin',  nome: 'Arranhador',      e: '🧶', custo: 40 },
    { id: 'rac',   nome: 'Casa de Ração',   e: '🥣', custo: 80 },
    { id: 'cast',  nome: 'Castelo do Gato', e: '🏰', custo: 160 }
  ],
  worlds: ['Mundo Inicial', 'Floresta', 'Praia', 'Montanhas', 'Cidade', 'Deserto',
           'Neve', 'Espaço', 'Mundo Mágico', 'Submarino', 'Futurista',
           'Ilhas Tropicais', 'Reino dos Gatos', 'Mundo Antigo', 'Mundo Mecânico',
           'Mundo Lendário', 'Mundo Cósmico', 'Mundo dos Sonhos', 'Mundo Supremo',
           'Mundo Final'],
  worldEmoji: ['🌱', '🌲', '🏖️', '⛰️', '🏙️', '🏜️', '❄️', '🚀', '🪄', '🌊',
               '🤖', '🏝️', '👑', '🏺', '⚙️', '🐉', '🌌', '💤', '✨', '🔥']
};

// ---- COLEÇÃO DE GATOS (configuráveis; bônus somados no servidor) ---------
const CATS = [
  { id: 'c1', nome: 'Gato Malhado',  e: '🐈', rar: 'comum',    b: { coins: 0,  raid: 0,  luck: 0 },  desc: 'O queridinho da vila.' },
  { id: 'c2', nome: 'Gato Branco',   e: '🐱', rar: 'comum',    b: { coins: 2,  raid: 0,  luck: 0 },  desc: 'Dorminhoco profissional.' },
  { id: 'c3', nome: 'Gato Aventureiro', e: '🧭', rar: 'raro',  b: { coins: 5,  raid: 0,  luck: 0 },  desc: '+5% moedas nos giros.' },
  { id: 'c4', nome: 'Gato Pirata',   e: '🏴‍☠️', rar: 'raro',    b: { coins: 0,  raid: 10, luck: 0 },  desc: '+10% recompensa de saque.' },
  { id: 'c5', nome: 'Gato Mágico',   e: '✨', rar: 'raro',     b: { coins: 0,  raid: 0,  luck: 5 },   desc: '+5% chance de bônus.' },
  { id: 'c6', nome: 'Gato Ninja',    e: '🥷', rar: 'epico',    b: { coins: 8,  raid: 0,  luck: 0 },  desc: '+8% moedas. Silencioso.' },
  { id: 'c7', nome: 'Gato Real',     e: '👑', rar: 'epico',    b: { coins: 0,  raid: 15, luck: 0 },  desc: '+15% recompensa de saque.' },
  { id: 'c8', nome: 'Gato Estrela',  e: '🌟', rar: 'epico',    b: { coins: 0,  raid: 0,  luck: 8 },   desc: '+8% chance de bônus.' },
  { id: 'c9', nome: 'Gato Dragão',   e: '🐉', rar: 'lendario', b: { coins: 15, raid: 10, luck: 0 },  desc: '+15% moedas e +10% saque.' },
  { id: 'c10',nome: 'Gato Galáctico',e: '🌌', rar: 'lendario', b: { coins: 20, raid: 20, luck: 10 }, desc: '+20% tudo. Lenda total.' }
];
const RAR_LABEL = { comum: 'Comum', raro: 'Raro', epico: 'Épico', lendario: 'Lendário' };

// ---- MISSÕES DIÁRIAS (configuráveis) -------------------------------------
const MISSIONS = [
  { id: 'm1', name: 'Faça 10 giros',        type: 'spins',   target: 10, reward: 120, icon: '🎰' },
  { id: 'm2', name: 'Construa 3 edifícios', type: 'builds',  target: 3,  reward: 150, icon: '🔨' },
  { id: 'm3', name: 'Faça 2 ataques',       type: 'attacks', target: 2,  reward: 200, icon: '🥷' },
  { id: 'm4', name: 'Complete uma vila',    type: 'villas',  target: 1,  reward: 250, icon: '🚀' }
];

let stats = { spins: 0, coinsSpent: 0, coinsWon: 0, players: 0, villages: 0, advances: 0,
              raids: 0, attacks: 0, shields: 0, defenses: 0, cats: 0, dupes: 0, missions: 0 };
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

function todayStr() { return new Date().toISOString().slice(0, 10); }
function yesterdayStr() { return new Date(Date.now() - 86400000).toISOString().slice(0, 10); }

// ---- EVENTOS (modulares; ativados/desativados pelo servidor por data) ----
// Ligar/desligar tudo de uma vez: env GATO_EVENTOS=off. Sem app separado.
const EVENTS = [
  { id: 'gatos', nome: 'Evento dos Gatos',    e: '🐈', de: '2026-01-01', ate: '2030-12-31', efeito: { catMult: 1.5 },  txt: '+50% chance de achar gatos 🐾' },
  { id: 'sorte', nome: 'Evento da Sorte',     e: '🍀', de: '2026-09-01', ate: '2026-10-01', efeito: { coinsMult: 1.2 }, txt: '+20% moedas nos giros 🪙' },
  { id: 'saque', nome: 'Evento do Saque',     e: '🎁', de: '2026-09-05', ate: '2026-09-12', efeito: { raidMult: 1.3 },  txt: '+30% recompensa de saque' }
];
function eventosAtivos() {
  if (process.env.GATO_EVENTOS === 'off') return [];
  const hoje = todayStr();
  return EVENTS.filter(e => e.de <= hoje && hoje <= e.ate).map(e => ({
    id: e.id, nome: e.nome, e: e.e, txt: e.txt, ate: e.ate,
    dias: Math.max(0, Math.ceil((new Date(e.ate + 'T23:59:59Z') - Date.now()) / 86400000)),
    efeito: e.efeito
  }));
}
function efeitoTotal(key) {
  let mult = 1;
  for (const ev of eventosAtivos()) if (ev.efeito && ev.efeito[key]) mult += (ev.efeito[key] - 1);
  return mult;
}

// ---- DESBLOQUEIOS POR NÍVEL (dicas de progressão do jogador) -------------
const UNLOCKS = [
  { lvl: 2,  txt: 'Gato Aventureiro mais fácil de achar 🐈' },
  { lvl: 4,  txt: 'Escudos protegem mais vezes 🛡️' },
  { lvl: 6,  txt: 'Prêmios de saque maiores 🎁' },
  { lvl: 8,  txt: 'Gatos Épicos mais comuns ✨' },
  { lvl: 12, txt: 'Novos mundos revelados 🌌' },
  { lvl: 20, txt: 'Gatos Lendários mais comuns 🌟' }
];

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
    id: n, world: CFG.worlds[wIdx], worldEmoji: CFG.worldEmoji[wIdx],
    name: `${CFG.worldEmoji[wIdx]} Vila ${n}`, inWorld, buildings: blds
  };
}

// aposta da máquina cresce com a vila → giro continua relevante no late game
function stakePara(vid) {
  const n = Math.max(1, Math.min(2000, Number(vid) || 1));
  return Math.round(CFG.spinCost * (1 + (n - 1) * CFG.betGrowth));
}

function defaultVillage() {
  return {
    vid: 1, built: {}, coinsSpent: 0, pp: 0, level: 1, lastDaily: null, advances: 0,
    shields: 0, raid: null, cats: [], collectionRewarded: false, streak: 0, catPity: 0,
    amigos: [], presentes: {},
    missions: { day: todayStr(), spins: 0, builds: 0, attacks: 0, villas: 0, claimed: {} }
  };
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
  return Math.round(vdef.buildings[tier.bi].base * CFG.tierMult[tier.tier - 1]);
}

function makeBuiltMap(v) {
  const out = {};
  const raw = v.built || {};
  if (raw.idx != null && CFG.buildings[raw.idx]) { // migração formato antigo
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
  return -1;
}

function getShields(v) { return Math.min(CFG.maxShields, v.shields || 0); }
function setShields(v, n) { v.shields = Math.max(0, Math.min(CFG.maxShields, n)); }

// bônus somados de toda a coleção (servidor calcula)
function computeBonus(v) {
  const b = { coins: 0, raid: 0, luck: 0 };
  for (const cid of (v.cats || [])) {
    const c = CATS.find(x => x.id === cid);
    if (c) { b.coins += c.b.coins; b.raid += c.b.raid; b.luck += c.b.luck; }
  }
  return b;
}

// roleta de gatos do drop da 🐾 (servidor decide)
function dropCat(v) {
  const owned = v.cats || [];
  const s = seeded((v.vid || 1) * 131 + Date.now() % 100000);
  let r = s() * 100, pool = [], rar = 'comum';
  if (r < CFG.catDrop.comum) pool = CATS.filter(c => c.rar === 'comum');
  else if (r < CFG.catDrop.comum + CFG.catDrop.raro) { pool = CATS.filter(c => c.rar === 'raro'); rar = 'raro'; }
  else if (r < CFG.catDrop.comum + CFG.catDrop.raro + CFG.catDrop.epico) { pool = CATS.filter(c => c.rar === 'epico'); rar = 'epico'; }
  else { pool = CATS.filter(c => c.rar === 'lendario'); rar = 'lendario'; }
  const cat = pool[Math.floor(s() * pool.length)];
  if (owned.includes(cat.id)) return { cat, nova: false, coins: CFG.catDupe[cat.rar] };
  return { cat, nova: true, coins: 0 };
}

function canClaimDaily(v) { return v.lastDaily !== todayStr(); }

function missionDay(v) {
  const m = v.missions || {};
  if (m.day !== todayStr()) return { day: todayStr(), spins: 0, builds: 0, attacks: 0, villas: 0, claimed: {} };
  return m;
}

function missionsSnapshot(v) {
  const m = missionDay(v);
  return MISSIONS.map(md => ({
    id: md.id, name: md.name, icon: md.icon, target: md.target, reward: md.reward,
    current: Math.min(md.target, m[md.type] || 0),
    done: (m[md.type] || 0) >= md.target,
    claimed: !!(m.claimed && m.claimed[md.id])
  }));
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
  const avail = canClaimDaily(v);
  const streak = (v.lastDaily === yesterdayStr()) ? Math.min(CFG.streakMax, v.streak || 0) : 0;
  const day = streak === CFG.streakMax ? CFG.streakMax : streak + 1;
  let reward = CFG.dailyReward;
  if (day > 1) reward = Math.round(reward * (1 + CFG.streakBase * (day - 1)));
  if (day >= CFG.streakMax) reward = Math.round(reward * CFG.streakFinalMult);
  const nextUnlock = UNLOCKS.find(u => u.lvl > level) || null;
  // OBJETIVO ATUAL (seção 49 — o jogador sempre sabe "o que faço agora")
  let faltam = 0;
  for (const b of CFG.buildings) faltam += CFG.tiers - (built[b.id] || 0);
  const recompensaAdvance = Math.round(150 * (1 + (v.vid - 1) * CFG.villageCostGrowth));
  const objetivo = complete
    ? { type: 'advance', txt: `Avançar para a Vila ${v.vid + 1}`, recompensa: recompensaAdvance }
    : { type: 'build', txt: 'Complete sua vila', faltam, proxima: next ? next.nome : '', recompensa: recompensaAdvance };
  return {
    vid: v.vid, world: vdef.world, worldEmoji: vdef.worldEmoji, name: vdef.name,
    inWorld: vdef.inWorld, totalVillages: 2000, maxWorlds: CFG.worlds.length,
    level, pp, ppPerLevel: CFG.ppPerLevel, xpToNext, built, complete, next,
    coinsSpent: v.coinsSpent || 0, advances: v.advances || 0,
    shields: getShields(v), maxShields: CFG.maxShields,
    catPity: Math.min(100, v.catPity || 0),
    hasRaid: !!(v.raid && v.raid.exp > Date.now()),
    cats: (v.cats || []).length, catTotal: CATS.length, catBonus: computeBonus(v),
    unlock: nextUnlock ? { lvl: nextUnlock.lvl, txt: nextUnlock.txt } : null,
    objetivo,
    mesa: stakePara(v.vid),
    missions: missionsSnapshot(v),
    daily: { reward: avail ? reward : 0, day: avail ? day : streak, streak,
             streakMax: CFG.streakMax, available: avail }
  };
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

  for (const e of ['🛡️', '🎁', '🐁', '🐾']) {
    if (groups[e] === 3) {
      if (e === '🛡️') return { win: Math.floor(cost * 0.5), kind: 'shield', guard: CFG.shieldTriple };
      if (e === '🎁') return { win: Math.floor(cost * CFG.raidPrizeMult), kind: 'raid' };
      if (e === '🐁') return { win: 0, kind: 'attack' };
      if (e === '🐾') return { win: Math.floor(cost * CFG.catTripleCoins), kind: 'cat' };
    }
    if (groups[e] === 2) {
      if (e === '🛡️') return { win: 0, kind: 'shield', guard: CFG.shieldPair };
      if (e === '🎁') return { win: 0, kind: 'raid' };
      if (e === '🐾') return { win: 0, kind: 'cat' };
    }
  }
  const sym = uniform ? a : (groups[a.e] === 2 ? a : (groups[b.e] === 2 ? b : (groups[c.e] === 2 ? c : null)));
  if (!sym || sym.kind !== 'coins' || sym.p2 === 0) {
    if (groups['🐾'] > 0) return { win: 0, kind: 'cat', single: groups['🐾'] === 1 };
    return { win: 0, kind: 'none' };
  }
  if (uniform && sym.p3) return { win: Math.floor(cost * sym.p3 * CFG.payoutMult), kind: 'all', e: sym.e };
  if (!uniform) return { win: Math.floor(cost * sym.p2 * CFG.payoutMult), kind: 'pair', e: sym.e };
  return { win: 0, kind: 'none' };
}

async function collection(db, userId) {
  if (!userId) return { error: 'userId obrigatório' };
  const char = await db.dbGetCharacter(userId);
  const v = { ...defaultVillage(), ...((char && char.village) || {}) };
  const owned = v.cats || [];
  return {
    cats: CATS.map(c => ({
      id: c.id, nome: c.nome, e: c.e, rar: c.rar, rarLabel: RAR_LABEL[c.rar], desc: c.desc, b: c.b,
      owned: owned.includes(c.id)
    })),
    owned: owned.length, total: CATS.length,
    complete: owned.length >= CATS.length,
    rewardAwarded: !!v.collectionRewarded,
    bonus: computeBonus(v)
  };
}

// ---- AÇÕES --------------------------------------------------------------

async function spin(db, userId, nick) {
  if (!userId) return { error: 'userId obrigatório' };
  const user = await db.dbGetUser(userId);
  const char = await db.dbGetCharacter(userId);
  const vSave = { ...defaultVillage(), ...((char && char.village) || {}) };
  const mesa = stakePara(vSave.vid);
  if (user.balance < mesa) return { error: `Você precisa de ${mesa} moedas pra girar` };
  await db.dbSpendCoins(userId, mesa);

  const rollRes = roll();
  const { win, kind, guard, e } = computeWin(rollRes, mesa);
  let credited = null;
  const out = { ok: true, syms: rollRes.map(s => s.e), kind, e, win: 0, guard: 0, balance: null, defense: null, mesa };

  const v = vSave;
  const bonus = computeBonus(v);
  let changed = false;

  // contadores de missão (resetam no dia)
  const mm = missionDay(v);
  mm.spins += 1; v.missions = mm; changed = true;

  // prêmio em moedas imediato (baú paga só na abertura do saque)
  const evCoins = efeitoTotal('coinsMult');
  const evCat = efeitoTotal('catMult');
  let rawWin = win;
  if (win > 0 && kind !== 'raid') rawWin = Math.floor(win * (1 + bonus.coins / 100) * evCoins);
  if (rawWin > 0 && kind !== 'raid') { credited = await db.dbAddCoins(userId, rawWin); out.win = rawWin; }

  if (kind === 'cat') {
    let drop = out.single !== true;
    if (!drop) {
      const pity = (v.catPity || 0) + CFG.catSinglePity * evCat;
      if (pity >= 100) { v.catPity = 0; drop = true; }
      else v.catPity = pity;
    }
    out.catPity = Math.min(100, v.catPity || 0);
    if (drop) {
      const d = dropCat(v);
      out.cat = { id: d.cat.id, nome: d.cat.nome, e: d.cat.e, rar: d.cat.rar, rarLabel: RAR_LABEL[d.cat.rar], nova: d.nova };
      if (d.nova) {
        v.cats = (v.cats || []).concat(d.cat.id);
        if (v.cats.length >= CATS.length && !v.collectionRewarded) {
          v.collectionRewarded = true;
const col = Math.floor((200 + Math.round(100 * (1 + bonus.coins / 100))) * evCoins);
        await db.dbAddCoins(userId, col);
          out.collection = { complete: true, reward: col };
        }
        stats.cats++;
} else {
      const dup = Math.round(d.coins * (1 + bonus.raid / 100) * evCoins);
      credited = await db.dbAddCoins(userId, dup);
      out.win += dup;
      stats.dupes++;
    }
      v.pp = (v.pp || 0) + 6;
    }
  } else if (kind === 'shield') {
    setShields(v, getShields(v) + guard);
    out.guard = guard;
    v.pp = (v.pp || 0) + 5;
    stats.shields += guard;
  } else if (kind === 'raid') {
    const s = seeded(userId.length * 31 + Date.now() % 100000);
    const loot = s() * 0.4 + 0.3;
    const coins = Math.max(10, Math.round(loot * win) || 20);
    v.raid = { i: Math.floor(s() * 3), coins, exp: Date.now() + CFG.raidExpiryMs };
    stats.raids++;
  } else if (kind === 'attack') {
    mm.attacks += 1;
    const target = v.vid < 2000 ? v.vid + 1 : 1;
    const loot = enemyLoot(target);
    let gain = Math.max(10, Math.round(loot * CFG.enemyStealPct));
    gain = Math.floor(gain * (1 + bonus.coins / 100) * evCoins);
    credited = await db.dbAddCoins(userId, gain);
    out.win = gain; out.attack = { target, loot, gain };
    v.pp = (v.pp || 0) + 10;
    stats.attacks++;
  } else if (kind === 'none' && bonus.luck > 0 && Math.random() < (bonus.luck * 0.006)) {
    // sorte dos gatos mágicos: um consolo cai
    const consolo = Math.round(mesa * 0.5);
    credited = await db.dbAddCoins(userId, consolo);
    out.win = consolo; out.luck = true;
  }

  // contra-ataque de bot: escudo bloqueia, senão perde pouco
  if (Math.random() < CFG.defenseChance) {
    if (getShields(v) > 0) {
      setShields(v, getShields(v) - 1);
      out.defense = { blocked: true, lost: 0 };
      stats.defenses++;
    } else {
      const balance = credited ? credited.balance : user.balance - mesa;
      const lost = Math.min(balance, Math.max(CFG.defenseLossMin, Math.round(balance * CFG.defenseLossPct)));
      if (lost > 0) {
        await db.dbSpendCoins(userId, lost);
        out.defense = { blocked: false, lost };
        stats.defenses++;
      }
    }
  }

  await db.dbSetCharacter(userId, { ...(char || {}), village: v });

  stats.spins++;
  stats.coinsSpent += mesa;
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
  out.missions = missionsSnapshot(v);
  out.catPity = Math.min(100, v.catPity || 0);
  return out;
}

// Abrir o baú escolhido do SAQUE (o prêmio foi decidido no giro)
async function raid(db, userId, pick) {
  if (!userId) return { error: 'userId obrigatório' };
  if (![0, 1, 2].includes(Number(pick))) return { error: 'Escolha inválida' };
  const char = await db.dbGetCharacter(userId);
  const v = { ...defaultVillage(), ...((char && char.village) || {}) };
  const r = v.raid;
  if (!r || r.exp < Date.now()) return { error: 'Este saque expirou. Gire um baú de novo!' };
  if (r.i !== Number(pick)) return { error: 'Tente novamente! Nesse baú tinha poeira 🕸️' };
  const bonus = computeBonus(v);
  const prize = Math.round(r.coins * (1 + bonus.raid / 100) * efeitoTotal('raidMult'));
  v.raid = null;
  await db.dbAddCoins(userId, prize);
  await db.dbSetCharacter(userId, { ...(char || {}), village: v });
  return { ok: true, prize, balance: (await db.dbGetUser(userId)).balance };
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

  const mm = missionDay(v);
  mm.builds += 1;
  if (nextBuildIndex(vdef, { ...built, [b.id]: tier }) === -1) mm.villas += 1; // completou a vila
  v.missions = mm;

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

  const mm = missionDay(v);
  mm.villas += 1; v.missions = mm;

  const bonus = Math.round(150 * (1 + (v.vid - 1) * CFG.villageCostGrowth));
  await db.dbAddCoins(userId, bonus);
  const oldWorld = vdef.world;
  v.vid = Math.min(2000, v.vid + 1);
  v.built = {};
  v.advances = (v.advances || 0) + 1;
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

  // calendário de 7 dias: vem de ontem → mantém/avança sequência, senão recomeça
  let streak = v.lastDaily === yesterdayStr() ? (v.streak || 0) : 0;
  streak = Math.min(CFG.streakMax, streak + 1);
  let reward = streak > 1 ? Math.round(CFG.dailyReward * (1 + CFG.streakBase * (streak - 1))) : CFG.dailyReward;
  if (streak >= CFG.streakMax) reward = Math.round(reward * CFG.streakFinalMult);

  v.lastDaily = todayStr();
  v.streak = streak;
  await db.dbAddCoins(userId, reward);
  await db.dbSetCharacter(userId, { ...(char || {}), village: v });
  return {
    ok: true,
    reward,
    streak,
    streakMax: CFG.streakMax,
    balance: (await db.dbGetUser(userId)).balance
  };
}

async function missionClaim(db, userId, id) {
  if (!userId) return { error: 'userId obrigatório' };
  const md = MISSIONS.find(x => x.id === id);
  if (!md) return { error: 'Missão inválida' };
  const char = await db.dbGetCharacter(userId);
  const v = { ...defaultVillage(), ...((char && char.village) || {}) };
  const mm = missionDay(v);
  if ((mm[md.type] || 0) < md.target) return { error: `Faltam completar: ${md.name}` };
  if (mm.claimed && mm.claimed[md.id]) return { error: 'Recompensa já coletada' };
  mm.claimed = { ...(mm.claimed || {}), [md.id]: true };
  v.missions = mm;
  v.pp = (v.pp || 0) + 10;
  await db.dbAddCoins(userId, md.reward);
  await db.dbSetCharacter(userId, { ...(char || {}), village: v });
  stats.missions++;
  return {
    ok: true,
    reward: md.reward,
    xp: 10,
    balance: (await db.dbGetUser(userId)).balance,
    missions: missionsSnapshot(v)
  };
}

const GIFT_COST = Number(process.env.GT_GIFT_COST) || 50;

// Anúncio recompensado (seção 47): o servidor decide valor, cooldown e teto diário.
// O cliente nunca informa o montante — impede "manipular anúncios".
CFG.adReward = Number(process.env.GT_AD_REWARD) || 50;
CFG.adCooldownSec = Number(process.env.GT_AD_COOLDOWN) || 30;
CFG.adDailyCap = Number(process.env.GT_AD_DAILY_CAP) || 40;

async function adReward(db, userId) {
  if (!userId) return { error: 'userId obrigatório' };
  const char = await db.dbGetCharacter(userId);
  const v = { ...defaultVillage(), ...((char && char.village) || {}) };
  const now = Date.now();
  const meta = v.ads || {};
  const wait = Math.ceil(((meta.last || 0) + CFG.adCooldownSec * 1000 - now) / 1000);
  if (wait > 0) return { error: 'Anúncio já contabilizado — aguarde', retryIn: wait, cooldownSec: wait };
  const today = todayStr();
  const count = meta.today === today ? (meta.count || 0) : 0;
  if (count >= CFG.adDailyCap) return { error: 'Limite de anúncios do dia atingido' };
  v.ads = { last: now, today, count: count + 1 };
  const credited = await db.dbAddCoins(userId, CFG.adReward);
  await db.dbSetCharacter(userId, { ...(char || {}), village: v });
  stats.ads = (stats.ads || 0) + 1;
  return {
    ok: true,
    reward: CFG.adReward,
    balance: credited.balance,
    cooldownSec: CFG.adCooldownSec,
    leftToday: CFG.adDailyCap - (count + 1)
  };
}

// Pareamento celular ↔ Smart TV (código curto + validação no servidor)
const tvPairs = new Map();
function tvCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

async function amigoRef(db, id) {
  const char = await db.dbGetCharacter(id);
  const v = { ...defaultVillage(), ...((char && char.village) || {}) };
  const user = await db.dbGetUser(id);
  return { id, nick: id.slice(0, 14), level: Math.floor((v.pp || 0) / CFG.ppPerLevel) + 1,
           vid: v.vid, cats: (v.cats || []).length, coins: user.balance };
}

async function amigosList(db, userId) {
  if (!userId) return { error: 'userId obrigatório' };
  const char = await db.dbGetCharacter(userId);
  const v = { ...defaultVillage(), ...((char && char.village) || {}) };
  const ids = v.amigos || [];
  const list = [];
  for (const id of ids) list.push(await amigoRef(db, id));
  return { amigos: list, limite: 20, presenteHoje: Object.keys(v.presentes || {}).filter(pid => v.presentes[pid] === todayStr()) };
}

async function amigoAdd(db, userId, codigo) {
  if (!userId) return { error: 'userId obrigatório' };
  const alvo = String(codigo || '').trim();
  if (!alvo) return { error: 'Digite o código do amigo' };
  if (alvo === userId) return { error: 'Você não pode ser seu próprio amigo 😸' };
  if (!(await db.dbUserExists(alvo))) return { error: 'Este código não existe. Já jogou alguma vez?' };
  const char = await db.dbGetCharacter(userId);
  const v = { ...defaultVillage(), ...((char && char.village) || {}) };
  v.amigos = v.amigos || [];
  if (v.amigos.includes(alvo)) return { error: 'Já é seu amigo!' };
  if (v.amigos.length >= 20) return { error: 'Limite de 20 amigos atingido' };
  v.amigos.push(alvo);
  await db.dbSetCharacter(userId, { ...(char || {}), village: v });
  const ref = await amigoRef(db, alvo);
  return { ok: true, amigo: ref };
}

async function amigoRemove(db, userId, codigo) {
  if (!userId) return { error: 'userId obrigatório' };
  const char = await db.dbGetCharacter(userId);
  const v = { ...defaultVillage(), ...((char && char.village) || {}) };
  v.amigos = (v.amigos || []).filter(x => x !== codigo);
  delete (v.presentes)[codigo];
  await db.dbSetCharacter(userId, { ...(char || {}), village: v });
  return { ok: true };
}

async function presente(db, userId, codigo) {
  if (!userId) return { error: 'userId obrigatório' };
  const alvo = String(codigo || '').trim();
  if (!alvo) return { error: 'Convida um amigo primeiro' };
  const char = await db.dbGetCharacter(userId);
  const v = { ...defaultVillage(), ...((char && char.village) || {}) };
  if (!(v.amigos || []).includes(alvo)) return { error: 'Só dá presente pra amigo 😊' };
  const user = await db.dbGetUser(userId);
  if (user.balance < GIFT_COST) return { error: `Precisa de ${GIFT_COST} moedas pra presentear` };
  v.presentes = v.presentes || {};
  if (v.presentes[alvo] === todayStr()) return { error: 'Você já mandou presente hoje. Volta amanhã!' };
  const ok = await db.dbSpendCoins(userId, GIFT_COST);
  if (!ok) return { error: 'Saldo insuficiente' };
  await db.dbAddCoins(alvo, GIFT_COST);
  v.presentes[alvo] = todayStr();
  await db.dbSetCharacter(userId, { ...(char || {}), village: v });
  const ref = await amigoRef(db, alvo);
  return { ok: true, custo: GIFT_COST, amigo: ref, balance: (await db.dbGetUser(userId)).balance };
}

function tvRegister(tvId) {
  if (!tvId) return { error: 'tvId obrigatório' };
  let p = [...tvPairs.values()].find(x => x.tvId === tvId);
  if (p && p.exp > Date.now()) return { ok: true, code: p.code, expiraSec: Math.floor((p.exp - Date.now()) / 1000) };
  const code = tvCode();
  tvPairs.set(code, { tvId, userId: null, exp: Date.now() + 120000, code });
  return { ok: true, code, expiraSec: 120 };
}

function tvConnect(code, userId) {
  if (!code) return { error: 'Digite o código mostrado na TV' };
  if (!userId) return { error: 'userId obrigatório' };
  const p = tvPairs.get(String(code));
  if (!p || p.exp < Date.now()) return { error: 'Código inválido ou expirado. Tenta de novo na TV!' };
  p.userId = userId;
  return { ok: true, tvId: p.tvId };
}

async function tvStatus(db, tvId) {
  if (!tvId) return { error: 'tvId obrigatório' };
  const reg = tvRegister(tvId);
  if (reg.error) return reg;
  const p = [...tvPairs.values()].find(x => x.tvId === tvId);
  const base = { ok: true, code: p.code, expiraSec: reg.expiraSec, connected: !!p.userId, userId: p.userId };
  if (p.userId) {
    const char = await db.dbGetCharacter(p.userId);
    const v = { ...defaultVillage(), ...((char && char.village) || {}) };
    const user = await db.dbGetUser(p.userId);
    base.village = { village: villageSnapshot(v), balance: user.balance };
  }
  return base;
}

async function ranking(db, userId, limit = 20) {
  const rows = await db.dbLeaderboard(limit);
  const list = rows.map((r, i) => ({
    pos: i + 1, id: r.id, nick: r.id.slice(0, 14),
    balance: r.balance, level: r.level, vid: r.vid, cats: r.cats
  }));
  const idx = userId ? list.findIndex(r => r.id === userId) : -1;
  return { top: list, rank: idx === -1 ? null : idx + 1, total: rows.length };
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
    catTotal: CATS.length,
    missions: MISSIONS.map(m => ({ id: m.id, name: m.name, icon: m.icon, target: m.target, reward: m.reward })),
    eventos: eventosAtivos(),
    unlocks: UNLOCKS,
    recent,
    stats
  };
}

module.exports = {
  CFG, getConfig, villaDef, collection, spin, raid, build, advance, daily, missionClaim,
  village, ranking, amigosList, amigoAdd, amigoRemove, presente, tvRegister, tvConnect, tvStatus,
  snapshot, status: snapshot, computeWin, dropCat, roll, missionsSnapshot, eventosAtivos,
  enemyLoot, stakePara, adReward,
  GIFT_COST
};