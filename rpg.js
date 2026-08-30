// ============================================================
//  RPG DO CAVALEIRO — "Tiago Cash Royale: Batalha do Cavaleiro"
//  Você sobe de nível vencendo cavaleiros; moedas (vindas do Pix)
//  compram espada, armadura e ferramentas para ficar mais forte.
//  O combate é por turnos e todo resultado é decidido no servidor.
// ============================================================

const N_LEVELS = 20;
const battles = new Map(); // userId -> batalha em andamento

// Catálogo de equipamentos
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

function entryCost(level) { return 30 + level * 20; }
function xpNeed(level) { return level * 80; }

// Estatísticas finais do personagem
function charStats(ch) {
  const sword = ch.gear.sword >= 0 ? GEAR.sword[ch.gear.sword] : null;
  const armor = ch.gear.armor >= 0 ? GEAR.armor[ch.gear.armor] : null;
  const tool  = ch.gear.tool  >= 0 ? GEAR.tool[ch.gear.tool]  : null;
  return {
    atk: (10 + ch.level * 5) + (sword ? sword.atk : 0),
    def: (4 + ch.level * 2) + (armor ? armor.def : 0),
    maxhp: (80 + ch.level * 18) + (tool ? tool.hp : 0),
    sword: sword ? sword.name : 'Nenhuma',
    armor: armor ? armor.name : 'Nenhuma',
    tool: tool ? tool.name : 'Nenhum'
  };
}

// Perfil completo (para a tela do personagem e do cliente)
async function profile(db, userId) {
  const ch = await db.dbGetCharacter(userId);
  const st = charStats(ch);
  return {
    level: ch.level,
    xp: ch.xp,
    xpNeed: xpNeed(ch.level),
    wins: ch.wins,
    gear: ch.gear,
    gearNames: { sword: st.sword, armor: st.armor, tool: st.tool },
    stats: { atk: st.atk, def: st.def, maxhp: st.maxhp },
    maxLevel: N_LEVELS
  };
}

function kit(ctx) {
  return {
    gear: GEAR,
    kinds: [
      { slot: 'sword', label: 'ESPADAS',     icon: '🗡️' },
      { slot: 'armor', label: 'ARMADURAS',   icon: '🛡️' },
      { slot: 'tool',  label: 'FERRAMENTAS', icon: '🧰' }
    ]
  };
}

// Inimigo de determinado nível
function knight(level) {
  return {
    name: `Cavaleiro Nível ${level}`,
    hp: 65 + level * 20,
    atk: 8 + level * 4,
    def: 4 + level * 3
  };
}

// ---------------- Batalha ----------------
// Inicia lutando contra o cavaleiro do seu nível atual.
async function startBattle(db, userId) {
  const ch = await db.dbGetCharacter(userId);
  const L = ch.level;
  const st = charStats(ch);
  const fee = entryCost(L);

  const r = await db.dbSpendCoins(userId, fee);
  if (!r) return { error: `Moedas insuficientes (entrada da Fase ${L}: ${fee}). Compre moedas na loja!` };

  const k = knight(L);
  battles.set(userId, {
    level: L,
    fee,
    playerHp: st.maxhp,
    enemyHp: k.hp,
    block: false,
    over: false,
    win: false,
    log: [`⚔️ Fase ${L}: você enfrenta o ${k.name}!`]
  });
  return { ok: true, balance: r.balance, battle: snapshot(db, userId, ch) };
}

async function act(db, userId, action) {
  const b = battles.get(userId);
  const ch = await db.dbGetCharacter(userId);
  if (!b) return { error: 'Nenhuma batalha em andamento. Escolha uma fase!' };
  if (b.over) return { error: 'A batalha já terminou. Escolha outra fase.' };

  const st = charStats(ch);
  const kHalf = knight(b.level);

  if (action === 'defender') {
    b.block = true;
    b.log.push('🛡️ Você se defende!');
    const dmg = takeDamage(b, st);
    b.log.push(`💥 O inimigo causa ${dmg} de dano. Você: ${b.playerHp} HP`);
    if (b.playerHp <= 0) return finish(db, userId, b, ch, false);
    return { ok: true, battle: snapshot(db, userId, ch) };
  }

  // atacar (padrão)
  const dmg = Math.max(1, Math.round((st.atk - kHalf.def * 0.5) * (0.85 + Math.random() * 0.3)));
  b.enemyHp -= dmg;
  b.log.push(`🗡️ Você acerta ${dmg} de dano! Inimigo: ${Math.max(0,b.enemyHp)} HP`);
  if (b.enemyHp <= 0) return finish(db, userId, b, ch, true);

  const incoming = b.block ? 0.35 : 1;
  b.block = false;
  const edmg = Math.max(1, Math.round((kHalf.atk - st.def * 0.5) * (0.85 + Math.random() * 0.3) * incoming));
  b.playerHp -= edmg;
  b.log.push(`💥 O inimigo causa ${edmg} de dano. Você: ${b.playerHp} HP`);
  if (b.playerHp <= 0) return finish(db, userId, b, ch, false);

  return { ok: true, battle: snapshot(db, userId, ch) };
}

function takeDamage(b, st) {
  const k = knight(b.level);
  const incoming = b.block ? 0.35 : 1;
  b.block = false;
  const dmg = Math.max(1, Math.round((k.atk - st.def * 0.5) * (0.85 + Math.random() * 0.3) * incoming));
  b.playerHp -= dmg;
  return dmg;
}

async function finish(db, userId, b, ch, win) {
  b.over = true;
  if (win) {
    ch.wins++;
    const reward = b.fee * 2;
    const xpGain = 20 + b.level * 15;
    ch.xp += xpGain;
    let leveled = false;
    while (ch.xp >= xpNeed(ch.level) && ch.level < N_LEVELS) {
      ch.xp -= xpNeed(ch.level);
      ch.level++;
      leveled = true;
    }
    await db.dbAddCoins(userId, reward);
    await db.dbSetCharacter(userId, ch);
    b.win = true;
    b.log.push(`🏆 Vitória! +${reward} moedas, +${xpGain} XP`);
    if (leveled) b.log.push(`🆙 SUBIU PARA O NÍVEL ${ch.level}! Você está mais forte!`);
  } else {
    b.log.push('💀 Você caiu em batalha… (a entrada fica com o inimigo. Tente de novo!)');
  }
  battles.delete(userId);
  const snap = snapshot(db, userId, ch);
  snap.reward = win ? b.fee * 2 : 0;
  snap.leveled = win && ch.level > b.level;
  return { ok: true, win, battle: snap };
}

function snapshot(db, userId, ch) {
  const b = battles.get(userId);
  const st = charStats(ch);
  const k = b ? knight(b.level) : null;
  return {
    phase: b ? (b.over ? 'over' : 'fighting') : 'idle',
    level: b ? b.level : ch.level,
    playerHp: b ? Math.max(0, b.playerHp) : st.maxhp,
    maxhp: st.maxhp,
    enemyHp: b ? Math.max(0, b.enemyHp) : (k ? k.hp : 0),
    enemyMaxHp: k ? k.hp : 0,
    entry: b ? b.fee : 0,
    log: b ? b.log.slice(-20) : [],
    win: b ? b.win : false
  };
}

// ---------------- Equipamentos ----------------
async function buyGear(db, userId, slot, idx) {
  const list = GEAR[slot];
  if (!list) return { error: 'Tipo de equipamento inválido' };
  const item = list[idx];
  if (!item) return { error: 'Item inválido' };

  const ch = await db.dbGetCharacter(userId);
  if (ch.gear[slot] >= idx) return { error: 'Você já tem equipamento melhor ou igual a esse.' };

  const r = await db.dbSpendCoins(userId, item.cost);
  if (!r) return { error: `Moedas insuficientes (${item.name}: ${item.cost}). Compre moedas na loja!` };

  ch.gear[slot] = idx;
  await db.dbSetCharacter(userId, ch);
  const st = charStats(ch);
  return { ok: true, balance: r.balance, name: item.name, stats: { atk: st.atk, def: st.def, maxhp: st.maxhp }, gear: ch.gear };
}

module.exports = {
  N_LEVELS, GEAR, kit, entryCost, xpNeed,
  profile, startBattle, act, buyGear, snapshot, charStats
};