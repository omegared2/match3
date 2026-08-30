// ============================================================
//  RPG DO CAVALEIRO — mundo aberto
//  Você CAMAINHA pelo mapa, compra poções/armaduras/classes nos NPCs,
//  luta com monstros e vence o Cavaleiro da Fase (o chefe) para avançar.
//  Moedas (vindas do Pix) deixam seu personagem mais forte.
// ============================================================

const N_PHASES = 20;
const battles = new Map(); // userId -> batalha em andamento
const worlds = new Map();  // userId -> estado do mundo (monstros e npcs)

// Catálogo de equipamentos (Ferreiro)
const GEAR = {
  sword: [
    { name: 'Espada de Ferro',   icon: '🗡️', atk: 8,  cost: 120 },
    { name: 'Espada de Aço',     icon: '⚔️', atk: 16, cost: 300 },
    { name: 'Espada Lendária',   icon: '🌟', atk: 30, cost: 700 }
  ],
  armor: [
    { name: 'Armadura de Couro', icon: '🛡️', def: 5,  cost: 100 },
    { name: 'Armadura de Placa', icon: '🛡️', def: 12, cost: 280 },
    { name: 'Armadura de Dragão',icon: '🐉', def: 22, cost: 650 }
  ],
  tool: [
    { name: 'Amuleto Dourado',   icon: '📿', hp: 30,  cost: 90 },
    { name: 'Cristal Místico',   icon: '🔮', hp: 70,  cost: 260 },
    { name: 'Coração Reforçado', icon: '❤️', hp: 140, cost: 600 }
  ]
};

// Classes do Treinador (melhora de classe deixa tudo mais forte)
const CLASSES = [
  { name: 'Cavaleiro Novato',     icon: '🛡️', bonus: { atk: 0, def: 0, hp: 0 },   cost: 0,    lvl: 1 },
  { name: 'Cavaleiro de Ferro',   icon: '🛡️', bonus: { atk: 4, def: 3, hp: 30 },  cost: 300,  lvl: 2 },
  { name: 'Cavaleiro de Aço',     icon: '⚔️', bonus: { atk: 8, def: 6, hp: 70 },  cost: 700,  lvl: 4 },
  { name: 'Cavaleiro de Ouro',    icon: '🛡️', bonus: { atk: 14, def: 10, hp: 130 }, cost: 1400, lvl: 7 },
  { name: 'Cavaleiro Lendário',   icon: '💫', bonus: { atk: 22, def: 16, hp: 220 }, cost: 2500, lvl: 11 },
  { name: 'Campeão Real',         icon: '👑', bonus: { atk: 32, def: 24, hp: 340 }, cost: 4000, lvl: 16 }
];

// Poções do Vendedor
const POTIONS = {
  heal: { name: 'Poção de Vida',   icon: '🧪', cost: 40, heal: 1 },
  buff: { name: 'Poção de Força',  icon: '🔥', cost: 60, atkBoost: 0.5, turns: 5 }
};

function entryCost(phase) { return 30 + phase * 20; }
function xpNeed(level) { return level * 80; }

const START_POS = { x: 17, y: 15 };

// Garante que personagens antigos tenham os campos novos
function normalizeChar(ch) {
  if (!ch.pos) ch.pos = { ...START_POS };
  if (typeof ch.hp !== 'number') ch.hp = (80 + ch.level * 18);
  if (!ch.potions) ch.potions = { heal: 0, buff: 0 };
  if (!ch.classIdx) ch.classIdx = 0;
  if (!ch.phase) ch.phase = 1;
  if (!ch.wins) ch.wins = 0;
  if (!ch.gear) ch.gear = { sword: -1, armor: -1, tool: -1 };
  return ch;
}

// Estatísticas finais do personagem (nível + equipamento + classe)
function charStats(ch) {
  ch = normalizeChar(ch);
  const sword = ch.gear.sword >= 0 ? GEAR.sword[ch.gear.sword] : null;
  const armor = ch.gear.armor >= 0 ? GEAR.armor[ch.gear.armor] : null;
  const tool  = ch.gear.tool  >= 0 ? GEAR.tool[ch.gear.tool]  : null;
  const cls   = CLASSES[ch.classIdx] || CLASSES[0];
  return {
    atk: (10 + ch.level * 5) + (sword ? sword.atk : 0) + cls.bonus.atk,
    def: (4 + ch.level * 2) + (armor ? armor.def : 0) + cls.bonus.def,
    maxhp: (80 + ch.level * 18) + (tool ? tool.hp : 0) + cls.bonus.hp,
    sword: sword ? sword.name : 'Nenhuma',
    armor: armor ? armor.name : 'Nenhuma',
    tool: tool ? tool.name : 'Nenhum',
    className: cls.name,
    classIcon: cls.icon
  };
}

async function profile(db, userId) {
  const ch = normalizeChar(await db.dbGetCharacter(userId));
  const st = charStats(ch);
  const next = CLASSES[ch.classIdx + 1] || null;
  return {
    phase: ch.phase,
    level: ch.level,
    xp: ch.xp,
    xpNeed: xpNeed(ch.level),
    wins: ch.wins,
    hp: ch.hp || st.maxhp,
    maxhp: st.maxhp,
    pos: ch.pos,
    potions: ch.potions,
    gear: ch.gear,
    gearNames: { sword: st.sword, armor: st.armor, tool: st.tool },
    stats: { atk: st.atk, def: st.def, maxhp: st.maxhp },
    classIdx: ch.classIdx,
    className: st.className,
    classIcon: st.classIcon,
    nextClass: next,
    maxPhase: N_PHASES,
    kit: kit()
  };
}

function kit() {
  return {
    gear: GEAR,
    kinds: [
      { slot: 'sword', label: 'ESPADAS',     icon: '🗡️' },
      { slot: 'armor', label: 'ARMADURAS',   icon: '🛡️' },
      { slot: 'tool',  label: 'FERRAMENTAS', icon: '🧰' }
    ]
  };
}

// Inimigos
function bossStats(phase) {
  return { name: `Cavaleiro da Fase ${phase}`, hp: 65 + phase * 20, atk: 8 + phase * 4, def: 4 + phase * 3 };
}
function monsterStats(phase) {
  return {
    name: `Monstro da Fase ${phase}`,
    hp: 50 + phase * 14,
    atk: 7 + phase * 3,
    def: 3 + phase * 2,
    reward: 15 + phase * 4,
    xp: 8 + phase * 5
  };
}

function enemyOf(b) {
  return b.type === 'boss' ? bossStats(b.phase) : monsterStats(b.phase);
}

// ---------------- Batalhas ----------------

// Chefe: cobra a entrada e inicia a luta
async function startBoss(db, userId) {
  const ch = normalizeChar(await db.dbGetCharacter(userId));
  const P = ch.phase;
  const st = charStats(ch);
  const fee = entryCost(P);
  const r = await db.dbSpendCoins(userId, fee);
  if (!r) return { error: `Moedas insuficientes (entrada da Fase ${P}: ${fee}). Compre moedas na loja!` };
  const k = bossStats(P);
  battles.set(userId, {
    type: 'boss', phase: P, fee, entry: fee,
    playerHp: Math.max(1, ch.hp || st.maxhp), enemyHp: k.hp,
    block: false, atkBoost: 0, over: false, win: false,
    log: [`⚔️ Fase ${P}: você enfrenta o ${k.name}! (entrada ${fee})`]
  });
  return { ok: true, balance: r.balance, battle: snapshot(db, userId, ch) };
}

// Monstro: não cobra entrada (você tocou nele)
function startMonster(db, userId, ch, monsterId) {
  const k = monsterStats(ch.phase);
  const st = charStats(ch);
  battles.set(userId, {
    type: 'monster', phase: ch.phase, fee: 0, entry: 0, monsterId,
    playerHp: Math.max(1, ch.hp || st.maxhp), enemyHp: k.hp,
    block: false, atkBoost: 0, over: false, win: false,
    log: [`💥 Você encontrou um ${k.name}! Lute!`]
  });
  return { ok: true, battle: snapshot(db, userId, ch) };
}

async function act(db, userId, action) {
  const b = battles.get(userId);
  if (!b) return { error: 'Nenhuma batalha em andamento.' };
  if (b.over) return { error: 'A batalha já terminou.' };
  const ch = normalizeChar(await db.dbGetCharacter(userId));
  const st = charStats(ch);
  const e = enemyOf(b);

  if (action === 'defender') {
    b.block = true;
    b.log.push('🛡️ Você se defende!');
    const dmg = takeDamage(b, st);
    b.log.push(`💥 O inimigo causa ${dmg} de dano. Você: ${b.playerHp} HP`);
    return checkDeath(db, userId, b, ch);
  }

  if (action === 'potion-heal' || action === 'potion-buff') {
    if (action === 'potion-heal') {
      if (!(ch.potions.heal > 0)) return { error: 'Você não tem Poção de Vida. Compre no Vendedor (🧪)' };
      ch.potions.heal--;
      b.playerHp = Math.min(st.maxhp, b.playerHp + Math.round(st.maxhp * 0.6));
      b.log.push('🧪 Você toma a Poção de Vida e recupera HP!');
    } else {
      if (!(ch.potions.buff > 0)) return { error: 'Você não tem Poção de Força. Compre no Vendedor (🔥)' };
      ch.potions.buff--;
      b.atkBoost = POTIONS.buff.turns;
      b.log.push('🔥 Você toma a Poção de Força! Ataque aumentado por 5 turnos!');
    }
    await db.dbSetCharacter(userId, ch);
    const dmg2 = takeDamage(b, st);
    b.log.push(`💥 O inimigo causa ${dmg2} de dano. Você: ${b.playerHp} HP`);
    return checkDeath(db, userId, b, ch);
  }

  // atacar
  const boost = b.atkBoost > 0 ? 1 + POTIONS.buff.atkBoost : 1;
  const effectiveAtk = Math.round(st.atk * boost);
  const dmg = Math.max(1, Math.round((effectiveAtk - e.def * 0.5) * (0.85 + Math.random() * 0.3)));
  b.enemyHp -= dmg;
  if (b.atkBoost > 0) b.atkBoost--;
  b.log.push(`🗡️ Você acerta ${dmg} de dano! Inimigo: ${Math.max(0, b.enemyHp)} HP${boost > 1 ? ' (🔥)' : ''}`);
  if (b.enemyHp <= 0) return finish(db, userId, b, ch, true);

  const dmg3 = takeDamage(b, st);
  b.log.push(`💥 O inimigo causa ${dmg3} de dano. Você: ${b.playerHp} HP`);
  return checkDeath(db, userId, b, ch);
}

function takeDamage(b, st) {
  const e = enemyOf(b);
  const incoming = b.block ? 0.35 : 1;
  b.block = false;
  const dmg = Math.max(1, Math.round((e.atk - st.def * 0.5) * (0.85 + Math.random() * 0.3) * incoming));
  b.playerHp -= dmg;
  return dmg;
}

async function checkDeath(db, userId, b, ch) {
  if (b.playerHp <= 0) return finish(db, userId, b, ch, false);
  return { ok: true, battle: snapshot(db, userId, ch) };
}

async function finish(db, userId, b, ch, win) {
  b.over = true;
  const st = charStats(ch);
  const prevPhase = b.phase;

  if (win) {
    ch.wins++;
    if (b.type === 'boss') {
      const reward = b.fee * 2;
      const xpGain = 20 + b.phase * 15;
      ch.xp += xpGain;
      await db.dbAddCoins(userId, reward);
      b.log.push(`🏆 Você venceu o Cavaleiro da Fase ${prevPhase}! +${reward} moedas, +${xpGain} XP`);
      ch.phase = Math.min(N_PHASES, prevPhase + 1);
      ch.pos = { ...START_POS };
      b.log.push(`➡️ Fase ${ch.phase} liberada! Você voltou ao acampamento.`);
      resetWorld(userId, true);
    } else {
      const k = monsterStats(b.phase);
      ch.xp += k.xp;
      await db.dbAddCoins(userId, k.reward);
      b.log.push(`🏆 Monstro derrotado! +${k.reward} moedas, +${k.xp} XP`);
      const mk = b.monsterId != null && worlds.has(userId)
        ? worlds.get(userId).monsters.find(m => m.id === b.monsterId) : null;
      if (mk) { mk.alive = false; mk.respawnAt = Date.now() + 45000; mk.x = mk.home.x; mk.y = mk.home.y; }
    }
    ch.hp = Math.min(st.maxhp, Math.max(1, b.playerHp));
} else {
      ch.hp = 1;
      if (b.type === 'boss') {
        b.log.push('💀 O chefe venceu… a entrada ficou com ele. Tente de novo (beba poção antes!).');
      } else {
        ch.pos = { ...START_POS };
        b.log.push('💀 Você caiu em batalha e fugiu para o acampamento (HP 1).');
      }
  }

  let leveled = false;
  while (ch.xp >= xpNeed(ch.level) && ch.level < N_PHASES) {
    ch.xp -= xpNeed(ch.level);
    ch.level++;
    leveled = true;
  }
  if (leveled) b.log.push(`🆙 SUBIU PARA O NÍVEL ${ch.level}! Você está mais forte!`);

  await db.dbSetCharacter(userId, ch);
  battles.delete(userId);

  const snap = snapshot(db, userId, ch);
  snap.reward = win && b.type === 'boss' ? b.fee * 2 : 0;
  snap.leveled = leveled;
  return { ok: true, win, battle: snap };
}

function snapshot(db, userId, ch) {
  const b = battles.get(userId);
  const st = charStats(ch);
  return {
    phase: b ? (b.over ? 'over' : 'fighting') : 'idle',
    type: b ? b.type : null,
    level: b ? b.phase : ch.phase,
    enemyName: b ? enemyOf(b).name : '',
    playerHp: b ? Math.max(0, b.playerHp) : (ch.hp || st.maxhp),
    maxhp: st.maxhp,
    hp: ch.hp || st.maxhp,
    enemyHp: b ? Math.max(0, b.enemyHp) : 0,
    enemyMaxHp: b ? enemyOf(b).hp : 0,
    entry: b ? b.entry : 0,
    atkBoost: b ? b.atkBoost : 0,
    potions: ch.potions,
    log: b ? b.log.slice(-20) : [],
    win: b ? b.win : false
  };
}

// ---------------- Equipamento / poção / classe ----------------
async function buyShop(db, userId, type, arg) {
  if (battles.has(userId)) return { error: 'Você está em batalha! Compre depois.' };
  const ch = normalizeChar(await db.dbGetCharacter(userId));
  const st = charStats(ch);

  if (type === 'potion') {
    const p = POTIONS[arg];
    if (!p) return { error: 'Poção inválida' };
    const r = await db.dbSpendCoins(userId, p.cost);
    if (!r) return { error: `Moedas insuficientes (${p.name}: ${p.cost}). Compre moedas na loja!` };
    ch.potions[arg]++;
    await db.dbSetCharacter(userId, ch);
    return { ok: true, balance: r.balance, name: p.name, potions: ch.potions };
  }

  if (type === 'gear') {
    const [slot, idx] = arg.split(':');
    const list = GEAR[slot];
    if (!list || !list[+idx]) return { error: 'Item inválido' };
    const item = list[+idx];
    if (ch.gear[slot] >= +idx) return { error: 'Você já tem equipamento melhor ou igual a esse.' };
    const r = await db.dbSpendCoins(userId, item.cost);
    if (!r) return { error: `Moedas insuficientes (${item.name}: ${item.cost}). Compre moedas na loja!` };
    ch.gear[slot] = +idx;
    await db.dbSetCharacter(userId, ch);
    const s2 = charStats(ch);
    return { ok: true, balance: r.balance, name: item.name, stats: { atk: s2.atk, def: s2.def, maxhp: s2.maxhp }, gear: ch.gear };
  }

  if (type === 'class') {
    const next = CLASSES[ch.classIdx + 1];
    if (!next) return { error: 'Você já é o Campeão Real (classe máxima)!' };
    if (ch.level < next.lvl) return { error: `Prefere o Nível ${next.lvl} para virar ${next.name} (você é nível ${ch.level}).` };
    const r = await db.dbSpendCoins(userId, next.cost);
    if (!r) return { error: `Moedas insuficientes (${next.name}: ${next.cost}). Compre moedas na loja!` };
    ch.classIdx++;
    await db.dbSetCharacter(userId, ch);
    const s3 = charStats(ch);
    return { ok: true, balance: r.balance, name: s3.className, stats: { atk: s3.atk, def: s3.def, maxhp: s3.maxhp }, classIdx: ch.classIdx };
  }

  return { error: 'Tipo inválido' };
}

// Usar poção fora de batalha
async function usePotion(db, userId, which) {
  const ch = normalizeChar(await db.dbGetCharacter(userId));
  const st = charStats(ch);
  if (which === 'heal') {
    if (!(ch.potions.heal > 0)) return { error: 'Você não tem Poção de Vida.' };
    ch.potions.heal--;
    ch.hp = st.maxhp;
  } else if (which === 'buff') {
    return { error: 'Poção de Força só funciona durante a batalha.' };
  } else {
    return { error: 'Poção inválida' };
  }
  await db.dbSetCharacter(userId, ch);
  return { ok: true, hp: ch.hp, potions: ch.potions };
}

function buyGear(db, userId, slot, idx) {
  return buyShop(db, userId, 'gear', `${slot}:${idx}`);
}

// ============================================================
//  MUNDO ABERTO — mapa, NPCs e monstros
// ============================================================

const MH = 18, MW = 25;

function buildMap() {
  const g = [];
  for (let y = 0; y < MH; y++) { g[y] = Array(MW).fill('.'); }
  for (let x = 0; x < MW; x++) { g[0][x] = 'T'; g[MH - 1][x] = 'T'; }
  for (let y = 0; y < MH; y++) { g[y][0] = 'T'; g[y][MW - 1] = 'T'; }
  const dec = [
    [2,2],[3,2],[2,3],[3,3],[5,5],[5,6],[5,7],
    [21,1],[22,1],[21,3],[22,3],[24,4],[23,4],
    [12,7],[13,7],[12,8],[13,8],[11,8],
    [2,8],[2,9],[3,9],[6,9],[6,10],
    [7,3],[7,4],[8,5],
    [2,14],[3,14],[4,14],[2,15],[3,15],[6,15],
    [22,14],[23,14],[22,15],[23,15],[20,16],[21,16],[19,16],
    [16,3],[9,10],[10,10],[14,11],[8,12],[8,13],[18,9],[15,6],[10,4],[19,5],[21,13]
  ];
  for (const [x, y] of dec) g[y][x] = (x + y) % 3 === 0 ? 'R' : 'T';
  // marcas de acampamento (decor das áreas de respawn)
  for (const [x, y] of [[17,15],[18,15],[17,16],[18,16]]) g[y][x] = 'S';
  return g;
}

const MAP = buildMap();

// NPCs (ids fixos; cada um é uma loja/conversa)
const NPCS = [
  { id: 'seller', name: 'Vendedor',   icon: '🧙', x: 19, y: 3, kind: 'seller' },
  { id: 'smith',  name: 'Ferreiro',   icon: '⚒️', x: 4,  y: 9, kind: 'smith' },
  { id: 'trainer',name: 'Treinador',  icon: '🥋', x: 20, y: 12, kind: 'trainer' },
  { id: 'boss',   name: 'Chefe',      icon: '☠️', x: 15, y: 4, kind: 'boss' }
];

function tileAt(x, y) {
  if (y < 0 || y >= MH || x < 0 || x >= MW) return 'T';
  return MAP[y][x];
}
function walkable(x, y) {
  const t = tileAt(x, y);
  return t === '.' || t === 'S';
}

function npcAt(x, y) {
  return NPCS.find(n => n.x === x && n.y === y) || null;
}
function npcBlocks(x, y) {
  return !!npcAt(x, y); // NPC/chefe ocupa o próprio quadrado
}

function resetWorld(userId, force) {
  const w = worlds.get(userId) || { monsters: [] };
  w.monsters = [
    { id: 0, home: { x: 8, y: 3 },  x: 8, y: 3, alive: true, respawnAt: 0 },
    { id: 1, home: { x: 21, y: 8 }, x: 21, y: 8, alive: true, respawnAt: 0 },
    { id: 2, home: { x: 7, y: 13 }, x: 7, y: 13, alive: true, respawnAt: 0 },
    { id: 3, home: { x: 21, y: 2 }, x: 21, y: 2, alive: true, respawnAt: 0 }
  ];
  worlds.set(userId, w);
  return w;
}

function worldFor(db, userId, ch) {
  let w = worlds.get(userId);
  if (!w) w = resetWorld(userId, false);
  const now = Date.now();
  w.monsters.forEach(m => {
    if (!m.alive && now >= m.respawnAt) {
      m.alive = true;
      m.x = m.home.x;
      m.y = m.home.y;
    }
  });
  return w;
}

function occupied(x, y, monsters, ignoreId) {
  if (!walkable(x, y)) return true;
  if (npcBlocks(x, y)) return true;
  return monsters.some(m => m.alive && m.id !== ignoreId && m.x === x && m.y === y);
}

// estado para o cliente
async function worldState(db, userId) {
  const ch = normalizeChar(await db.dbGetCharacter(userId));
  const w = worldFor(db, userId, ch);
  return {
    map: MAP,
    npcs: NPCS.map(n => ({ ...n, phase: n.kind === 'boss' ? ch.phase : null })),
    monsters: w.monsters.map(m => ({ id: m.id, x: m.x, y: m.y, alive: m.alive })),
    pos: ch.pos,
    phase: ch.phase,
    start: START_POS
  };
}

function stepMonsters(w, ch) {
  for (const m of w.monsters) {
    if (!m.alive) continue;
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    const d = dirs[Math.floor(Math.random() * dirs.length)];
    const nx = m.x + d[0], ny = m.y + d[1];
    if (m.x === ch.pos.x && m.y === ch.pos.y) continue; // nunca anda sobre o jogador
    if (occupied(nx, ny, w.monsters, m.id)) continue;
    m.x = nx; m.y = ny;
  }
}

// Movimento de 1 quadrado; monstros também andam (1 passo por movimento)
async function move(db, userId, dx, dy) {
  const ch = normalizeChar(await db.dbGetCharacter(userId));
  const w = worldFor(db, userId, ch);
  const nx = ch.pos.x + dx;
  const ny = ch.pos.y + dy;

  // desvia se o jogador estiver em batalha
  if (battles.has(userId)) return { error: 'Você está em batalha!' };

  if (occupied(nx, ny, w.monsters, null)) {
    return { error: 'Caminho bloqueado!' };
  }

  ch.pos = { x: nx, y: ny };
  await db.dbSetCharacter(userId, ch);
  stepMonsters(w, ch);

  // tocou em monstro -> começa luta
  const hit = w.monsters.find(m => m.alive && m.x === nx && m.y === ny);
  if (hit) {
    const res = startMonster(db, userId, ch, hit.id);
    res.world = await worldState(db, userId);
    return res;
  }
  return { ok: true, moved: true, world: await worldState(db, userId) };
}

// Interagir com o NPC/chefe que estiver do lado
async function interact(db, userId) {
  if (battles.has(userId)) return { error: 'Você está em batalha!' };
  const ch = normalizeChar(await db.dbGetCharacter(userId));
  const { x, y } = ch.pos;
  const around = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => ({ x: x + dx, y: y + dy }));
  const found = around.map(p => npcAt(p.x, p.y)).find(Boolean);
  if (!found) return { error: 'Não há ninguém para conversar por perto.' };

  const resp = { npc: found };

  if (found.kind === 'seller') {
    resp.shop = [
      { type: 'potion', id: 'heal',  ...POTIONS.heal,  desc: 'Recupera 60% do HP na luta' },
      { type: 'potion', id: 'buff',  ...POTIONS.buff,  desc: 'Ataque +50% por 5 turnos na luta' }
    ];
  } else if (found.kind === 'smith') {
    resp.shop = [
      ...GEAR.sword.map((g, i) => ({ type: 'gear', id: `sword:${i}`, slot: 'sword', ...g })),
      ...GEAR.armor.map((g, i) => ({ type: 'gear', id: `armor:${i}`, slot: 'armor', ...g })),
      ...GEAR.tool.map((g, i) => ({ type: 'gear', id: `tool:${i}`, slot: 'tool', ...g }))
    ];
  } else if (found.kind === 'trainer') {
    const next = CLASSES[ch.classIdx + 1];
    resp.current = CLASSES[ch.classIdx];
    resp.next = next || null;
  } else if (found.kind === 'boss') {
    resp.boss = { fee: entryCost(ch.phase), phase: ch.phase, name: bossStats(ch.phase).name };
  }
  return { ok: true, ...resp, pos: ch.pos };
}

// Iniciar luta com o chefe (cobra entrada)
async function startBossAt(db, userId) {
  if (battles.has(userId)) return { error: 'Você está em batalha!' };
  return startBoss(db, userId);
}

// Poção fora de batalha (alias)
async function potionOut(db, userId, which) {
  if (battles.has(userId)) return { error: 'Poções da batalha são usadas no botão 🧪 da luta.' };
  return usePotion(db, userId, which);
}

module.exports = {
  // mapa e utilitários para o cliente
  MAP, MW, MH, NPCS, START_POS, worldState,
  // personagem e batalhas
  N_PHASES, GEAR, CLASSES, POTIONS, kit, entryCost, xpNeed,
  normalizeChar, charStats,
  profile, startBoss, startMonster, startBossAt, act,
  buyShop, buyGear, usePotion, potionOut,
  move, interact, worldState, resetWorld
};