// Persistência do backend.
// Se DATABASE_URL existir -> usa Postgres (produção).
// Senão -> usa memória, com SNAPSHOT EM ARQUIVO atômico (sobrevive a restart).
// Desligar snapshot: GT_STATE_FILE=off. Caminho custom: GT_STATE_FILE=/caminho/state.json.

const fs = require('fs');
const path = require('path');

let pool = null;
let mode = 'memory';

const memUsers = new Map();
const memPayments = new Map();
const memChars = new Map();

// ---- snapshot em arquivo ----
let stateFile = null;
let dirty = false;
let flushTimer = null;
let writeChain = Promise.resolve();

function memoryUser(id) {
  if (!memUsers.has(id)) { memUsers.set(id, { balance: 100 }); mark(); }
  return memUsers.get(id);
}

function mark() {
  if (!stateFile) return;
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flushNow(); }, 1500);
}

async function flushNow() {
  if (!stateFile || !dirty) return;
  dirty = false;
  writeChain = writeChain.then(async () => {
    try {
      const data = JSON.stringify({
        version: 1,
        users: [...memUsers.entries()],
        payments: [...memPayments.entries()],
        chars: [...memChars.entries()]
      });
      const tmp = stateFile + '.tmp';
      await fs.promises.mkdir(path.dirname(stateFile), { recursive: true });
      await fs.promises.writeFile(tmp, data, 'utf8');
      await fs.promises.rename(tmp, stateFile);
    } catch (err) {
      console.error('⚠️  Falha ao salvar snapshot:', err.message);
    }
  });
}

// Síncrono, para desligamento limpo (SIGTERM/SIGINT).
function flushSync() {
  if (!stateFile || !dirty) return;
  try {
    const data = JSON.stringify({
      version: 1,
      users: [...memUsers.entries()],
      payments: [...memPayments.entries()],
      chars: [...memChars.entries()]
    });
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile + '.tmp', data, 'utf8');
    fs.renameSync(stateFile + '.tmp', stateFile);
    dirty = false;
  } catch (err) {
    console.error('⚠️  Falha ao salvar snapshot final:', err.message);
  }
}

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (data && Array.isArray(data.users)) for (const [k, v] of data.users) memUsers.set(k, v);
    if (data && Array.isArray(data.payments)) for (const [k, v] of data.payments) memPayments.set(k, v);
    if (data && Array.isArray(data.chars)) for (const [k, v] of data.chars) memChars.set(k, JSON.parse(JSON.stringify(v)));
    console.log(`💾 Snapshot carregado (${memUsers.size} usuários, ${memPayments.size} pagamentos, ${memChars.size} personagens)`);
  } catch (_) { /* primeiro boot: sem arquivo ainda */ }
}

// Cria as tabelas caso não existam. Retorna o modo ativo.
async function initDb() {
  if (!process.env.DATABASE_URL) {
    if (process.env.GT_STATE_FILE !== 'off') {
      stateFile = process.env.GT_STATE_FILE || path.join(__dirname, 'data', 'state.json');
      try { await fs.promises.mkdir(path.dirname(stateFile), { recursive: true }); } catch (_) {}
      loadState();
      const iv = setInterval(() => flushNow(), 30000);
      if (iv.unref) iv.unref();
    }
    return 'memory';
  }
  try {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(
      `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 100)`
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        pack_id TEXT,
        coins INTEGER,
        status TEXT DEFAULT 'pending'
      )`
    );
    await pool.query(
      `ALTER TABLE payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()`
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL
      )`
    );
    mode = 'postgres';
  } catch (err) {
    console.error('⚠️  Falha ao conectar no Postgres, usando memória:', err.message);
    pool = null;
  }
  return mode;
}

async function dbGetUser(id) {
  if (mode === 'memory') return { balance: memoryUser(id).balance };
  const r = await pool.query('SELECT balance FROM users WHERE id=$1', [id]);
  if (r.rowCount === 0) {
    await pool.query('INSERT INTO users(id,balance) VALUES($1,100) ON CONFLICT(id) DO NOTHING', [id]);
    return { balance: 100 };
  }
  return { balance: r.rows[0].balance };
}

// Existe usuário de verdade? (não cria/registra — usado p/ validar amigos e pareamento)
async function dbUserExists(id) {
  if (mode === 'memory') return memUsers.has(id) || memChars.has(id);
  const r = await pool.query('SELECT 1 FROM users WHERE id=$1', [id]);
  return r.rowCount > 0;
}

async function dbAddCoins(id, amount) {
  if (mode === 'memory') {
    const u = memoryUser(id);
    u.balance += amount;
    mark();
    return { balance: u.balance };
  }
  await pool.query(
    'INSERT INTO users(id,balance) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET balance=users.balance+$2',
    [id, amount]
  );
  const r = await pool.query('SELECT balance FROM users WHERE id=$1', [id]);
  return { balance: r.rows[0].balance };
}

// Retorna null se não tiver saldo suficiente.
async function dbSpendCoins(id, cost) {
  if (mode === 'memory') {
    const u = memoryUser(id);
    if (u.balance < cost) return null;
    u.balance -= cost;
    mark();
    return { balance: u.balance };
  }
  const r = await pool.query(
    'UPDATE users SET balance=balance-$2 WHERE id=$1 AND balance>=$2 RETURNING balance',
    [id, cost]
  );
  if (r.rowCount === 0) return null;
  return { balance: r.rows[0].balance };
}

async function dbSavePayment(paymentId, data) {
  if (mode === 'memory') {
    memPayments.set(paymentId, { ...data, status: 'pending' });
    mark();
    return;
  }
  await pool.query(
    'INSERT INTO payments(id,user_id,pack_id,coins) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',
    [paymentId, data.userId, data.packId, data.coins]
  );
}

async function dbGetPayment(paymentId) {
  if (mode === 'memory') return memPayments.get(paymentId) || null;
  const r = await pool.query(
    'SELECT user_id AS "userId", pack_id AS "packId", coins, status FROM payments WHERE id=$1',
    [paymentId]
  );
  return r.rowCount ? r.rows[0] : null;
}

// Marca como aprovado só UMA vez. Retorna o pagamento se foi aprovado agora.
async function dbApprovePayment(paymentId) {
  if (mode === 'memory') {
    const p = memPayments.get(paymentId);
    if (p && p.status !== 'approved') {
      p.status = 'approved';
      mark();
      return p;
    }
    return null;
  }
  const r = await pool.query(
    `UPDATE payments SET status='approved'
     WHERE id=$1 AND status<>'approved'
     RETURNING user_id AS "userId", coins`,
    [paymentId]
  );
  return r.rowCount ? r.rows[0] : null;
}

// ---------------- Personagens (Batalha do Cavaleiro) ----------------

function defaultChar() {
  return { level: 1, xp: 0, wins: 0, gear: { sword: -1, armor: -1, tool: -1 } };
}

async function dbGetCharacter(id) {
  if (mode === 'memory') {
    if (!memChars.has(id)) { memChars.set(id, defaultChar()); mark(); }
    return JSON.parse(JSON.stringify(memChars.get(id)));
  }
  const r = await pool.query('SELECT data FROM characters WHERE id=$1', [id]);
  if (r.rowCount === 0) {
    const d = defaultChar();
    await pool.query('INSERT INTO characters(id,data) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [id, JSON.stringify(d)]);
    return d;
  }
  return r.rows[0].data;
}

async function dbSetCharacter(id, data) {
  if (mode === 'memory') {
    memChars.set(id, JSON.parse(JSON.stringify(data)));
    mark();
    return;
  }
  await pool.query(
    'INSERT INTO characters(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',
    [id, JSON.stringify(data)]
  );
}

// Estatísticas gerais (para o bot/administrador)
async function dbAdminStats() {
  if (mode === 'memory') {
    return {
      users: memUsers.size,
      chars: memChars.size,
      payments24h: 0,
      coins24h: 0,
      top: [...memUsers.entries()]
        .map(([id, u]) => ({ id, balance: u.balance }))
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 5)
    };
  }
  const u = await pool.query('SELECT count(*)::int AS c FROM users');
  const c = await pool.query('SELECT count(*)::int AS c FROM characters');
  const p = await pool.query(
    `SELECT count(*)::int AS c, COALESCE(sum(coins),0)::int AS s
     FROM payments WHERE status='approved' AND created_at >= now() - interval '1 day'`
  );
  const top = await pool.query(
    `SELECT u.id, u.balance, ch.data
     FROM users u LEFT JOIN characters ch ON ch.id = u.id
     ORDER BY u.balance DESC LIMIT 5`
  );
  return {
    users: u.rows[0].c,
    chars: c.rows[0].c,
    payments24h: p.rows[0].c,
    coins24h: p.rows[0].s,
    top: top.rows.map(r => ({
      id: r.id,
      balance: r.balance,
      level: r.data ? r.data.level : null,
      phase: r.data ? r.data.phase : null,
      wins: r.data ? r.data.wins : 0
    }))
  };
}

// Leaderboard global do Gatinho: nível (PP) primeiro, depois moedas.
function charRow(id) {
  const ch = memChars.get(id);
  const village = (ch && ch.village) || {};
  const pp = village.pp || 0;
  return {
    id,
    balance: memUsers.has(id) ? memUsers.get(id).balance : 0,
    level: Math.floor(pp / 250) + 1,
    pp,
    vid: village.vid || 1,
    cats: (village.cats || []).length
  };
}
async function dbLeaderboard(limit = 20) {
  if (mode === 'memory') {
    const ids = new Set([...memUsers.keys(), ...memChars.keys()]);
    const rows = [...ids].map(charRow);
    rows.sort((a, b) => (b.level - a.level) || (b.balance - a.balance));
    return rows.slice(0, limit);
  }
  const r = await pool.query(
    `SELECT u.id, u.balance, ch.data
     FROM users u LEFT JOIN characters ch ON ch.id = u.id`
  );
  const rows = r.rows.map(row => {
    const village = (row.data && row.data.village) || {};
    const pp = village.pp || 0;
    return {
      id: row.id,
      balance: row.balance,
      level: Math.floor(pp / 250) + 1,
      pp,
      vid: village.vid || 1,
      cats: (village.cats || []).length
    };
  });
  rows.sort((a, b) => (b.level - a.level) || (b.balance - a.balance));
  return rows.slice(0, limit);
}

module.exports = {
  initDb,
  dbGetUser,
  dbUserExists,
  dbAddCoins,
  dbSpendCoins,
  dbSavePayment,
  dbGetPayment,
  dbApprovePayment,
  dbGetCharacter,
  dbSetCharacter,
  dbAdminStats,
  dbLeaderboard,
  flushSync,
  flushNow,
  defaultChar
};