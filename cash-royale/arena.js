// ============================================================
//  ARENA CASH ROYALE — battle royale de caça-níqueis
//  Todos giram a máquina; o menor número de cada rodada cai fora.
//  O último sobrevivente leva o pote inteiro.
// ============================================================
const crypto = require('crypto');

const CFG = {
  fee: 100,              // custo de entrada (moedas)
  minPlayers: 2,         // precisa de pelo menos 2 para começar
  maxPlayers: 8,
  joinWindowMs: 45000,   // tempo de espera após encher o mínimo
  roundIntervalMs: 12000,// pausa entre uma rodada e outra
  reels: 3,              // quantidade de "roletas" por jogador
  symbols: 10,           // cada roleta sorteia de 0 a 9
  resultHoldMs: 12000    // tempo exibindo o vencedor
};

// Permite ajustar a regra por ambiente (sem editar código).
function envInt(key, fallback) {
  const v = parseInt(process.env['CR_' + key], 10);
  return Number.isFinite(v) ? v : fallback;
}
CFG.fee = envInt('FEE', CFG.fee);
CFG.maxPlayers = envInt('MAX_PLAYERS', CFG.maxPlayers);
CFG.joinWindowMs = envInt('JOIN_WINDOW', CFG.joinWindowMs);
CFG.roundIntervalMs = envInt('ROUND_INTERVAL', CFG.roundIntervalMs);
CFG.resultHoldMs = envInt('RESULT_HOLD', CFG.resultHoldMs);

let arena = newArena();

function newArena(first = true) {
  const a = {
    phase: 'waiting',
    round: 0,
    prizePool: 0,
    players: new Map(),
    log: [],
    winnerId: null,
    phaseEndAt: Date.now() + CFG.joinWindowMs,
    startedAt: null
  };
  if (first) {
    a.log = [`🆕 Arena aberta! Entre por ${CFG.fee} moedas. Quem ficar por último leva tudo!`];
  }
  return a;
}

function activePlayersCount() {
  let n = 0;
  for (const p of arena.players.values()) if (p.alive) n++;
  return n;
}
function logPush(msg) {
  arena.log.push(msg);
  if (arena.log.length > 60) arena.log.splice(0, arena.log.length - 60);
}

function snapshot() {
  const players = [...arena.players.values()].map(p => ({
    id: p.id,
    nick: p.nick,
    alive: p.alive,
    reels: p.reels || null,
    sum: p.sum === null ? null : p.sum,
    eliminatedRound: p.eliminatedRound || null,
    winner: p.id === arena.winnerId
  }));
  return {
    phase: arena.phase,
    round: arena.round,
    prizePool: arena.prizePool,
    fee: CFG.fee,
    minPlayers: CFG.minPlayers,
    maxPlayers: CFG.maxPlayers,
    countdownMs: Math.max(0, arena.phaseEndAt - Date.now()),
    players,
    log: arena.log.slice(-20),
    winnerId: arena.winnerId,
    roundIntervalMs: CFG.roundIntervalMs
  };
}

// Entrar na arena: gasta as moedas da entrada.
async function join(db, userId, nickRaw) {
  if (arena.phase !== 'waiting') return { error: '🏁 A partida já começou! Espere a próxima arena.' };
  if (arena.players.has(userId)) return { error: 'Você já está na partida.' };
  if (arena.players.size >= CFG.maxPlayers) return { error: 'Sala cheia! Aguarde a próxima arena.' };

  const r = await db.dbSpendCoins(userId, CFG.fee);
  if (!r) return { error: `Moedas insuficientes (precisa de ${CFG.fee}). Compre um pacote!` };

  const clean = String(nickRaw || '').replace(/[^\p{L}\p{N} _\-]/gu, '').slice(0, 16) || 'Jogador';
  arena.players.set(userId, { id: userId, nick: clean, alive: true, eliminatedRound: null, reels: null, sum: null });
  arena.prizePool += CFG.fee;
  logPush(`🎟️ ${clean} entrou na arena (${arena.players.size}/${CFG.maxPlayers})`);

  // quando atinge o mínimo, abre a contagem para começar
  if (arena.players.size >= CFG.minPlayers && (arena.phaseEndAt - Date.now()) > CFG.joinWindowMs) {
    arena.phaseEndAt = Date.now() + CFG.joinWindowMs;
  }
  return { ok: true, balance: r.balance };
}

// Sair antes de começar: devolve a entrada.
async function leave(db, userId) {
  if (arena.phase !== 'waiting') return { error: 'A partida já está rolando. Não é possível sair com reembolso.' };
  const p = arena.players.get(userId);
  if (!p) return { error: 'Você não está na partida.' };
  arena.players.delete(userId);
  arena.prizePool = Math.max(0, arena.prizePool - CFG.fee);
  const r = await db.dbAddCoins(userId, CFG.fee);
  logPush(`🚪 ${p.nick} saiu (entrada devolvida)`);
  return { ok: true, balance: r.balance };
}

// --------------------------------------------------------------
//  LOOP DO JOGO (roda a cada 500ms)
// --------------------------------------------------------------
async function tick(db) {
  const now = Date.now();

  if (arena.phase === 'waiting') {
    if (arena.players.size < CFG.minPlayers) {
      // sem gente suficiente: fica esperando por mais jogadores
      if ((now - arena.phaseEndAt) > CFG.joinWindowMs) arena.phaseEndAt = now + CFG.joinWindowMs;
      return;
    }
    if (now >= arena.phaseEndAt || arena.players.size >= CFG.maxPlayers) {
      startMatch();
    }
    return;
  }

  if (arena.phase === 'playing') {
    if (now >= arena.phaseEndAt) await playRound(db);
    return;
  }

  // fase 'result': mostra o vencedor e depois abre nova arena
  if (now >= arena.phaseEndAt) {
    arena = newArena(false);
  }
}

function startMatch() {
  // proteção extra: se houver alguém, mas menos que o mínimo
  if (arena.players.size < CFG.minPlayers) {
    for (const [uid, p] of arena.players) {
      arena.players.delete(uid);
      arena.prizePool = Math.max(0, arena.prizePool - CFG.fee);
      db.dbAddCoins(uid, CFG.fee).catch(() => {});
    }
    arena = newArena(false);
    return;
  }
  arena.phase = 'playing';
  arena.round = 0;
  arena.phaseEndAt = Date.now() + 2200;
  logPush(`🏁 COMEÇOU! ${arena.players.size} jogadores na arena. O menor número cai fora a cada rodada!`);
}

async function playRound(db) {
  arena.round++;
  const alive = [...arena.players.values()].filter(p => p.alive);
  if (alive.length <= 1) {
    finishMatch(db, alive[0] || null);
    return;
  }

  let minSum = Infinity;
  for (const p of alive) {
    p.reels = Array.from({ length: CFG.reels }, () => crypto.randomInt(0, CFG.symbols));
    p.sum = p.reels.reduce((a, b) => a + b, 0);
    if (p.sum < minSum) minSum = p.sum;
  }

  let losers = alive.filter(p => p.sum === minSum);

  // MORTE SÚBITA: se todos empataram, re-sorteia até alguém cair (ninguém pode ficar sem vencedor)
  let guard = 0;
  while (losers.length === alive.length && activePlayersCount() > 1 && guard++ < 60) {
    for (const p of alive) {
      p.reels = Array.from({ length: CFG.reels }, () => crypto.randomInt(0, CFG.symbols));
      p.sum = p.reels.reduce((a, b) => a + b, 0);
    }
    minSum = Math.min(...alive.map(p => p.sum));
    losers = alive.filter(p => p.sum === minSum);
    if (losers.length < alive.length) logPush('⚔️ EMPATE TOTAL! Morte súbita: rodada extra!');
  }

  for (const p of losers) {
    p.alive = false;
    p.eliminatedRound = arena.round;
  }

  logPush(`🎰 Rodada ${arena.round}: ${alive.map(p => `${p.nick} ${p.sum}`).join(' · ')}`);
  logPush(`💥 Caiu fora: ${losers.map(p => p.nick).join(', ')}`);

  const survivors = [...arena.players.values()].filter(p => p.alive);
  if (survivors.length <= 1) {
    arena.phaseEndAt = Date.now() + 1500; // pequena pausa para ver o resultado
    setTimeout(() => finishMatch(db, survivors[0] || null), 1500);
  } else {
    arena.phaseEndAt = Date.now() + CFG.roundIntervalMs;
  }
}

async function finishMatch(db, winner) {
  if (arena.phase !== 'playing') return;
  if (winner) {
    await db.dbAddCoins(winner.id, arena.prizePool);
    arena.winnerId = winner.id;
    logPush(`👑 ${winner.nick} VENCEU e levou ${arena.prizePool} moedas do pote!`);
    const token = process.env.BOT_TOKEN, chatId = process.env.TG_CHAT_ID;
    if (token && chatId) {
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `👑 Cash Royale: ${winner.nick} venceu e levou ${arena.prizePool} moedas!` })
      }).catch(() => {});
    }
  } else {
    logPush(`😶 Ninguém sobrou... Arena reiniciada!`);
  }
  arena.phase = 'result';
  arena.phaseEndAt = Date.now() + CFG.resultHoldMs;
}

function startLoop(db) {
  setInterval(() => tick(db).catch(() => {}), 500);
}

module.exports = { CFG, snapshot, join, leave, startLoop, status: snapshot };