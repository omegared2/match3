require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const pix = require('./pix');
const db = require('./db');
const arena = require('./arena');
const rpg = require('./rpg');
const bingo = require('./bingo');
const roda = require('./roda');
const cartas = require('./cartas');
const loteria = require('./loteria');
const turbo = require('./turbo');
const gato = require('./gato');
const wscl = require('./wscl');
const criador = require('./criador');
const limit = require('./limiter');
const adminseg = require('./admin');

const app = express();
const PORT = process.env.PORT || 3000;
const GAME_DIR = process.env.GAME_DIR || path.join(__dirname, 'public');

// Envia um aviso para o Telegram do dono (se configurado)
async function notifyTelegram(text) {
  const token = process.env.BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch (err) {
    console.error('Erro ao notificar Telegram:', err.message);
  }
}
function packLabel(packId) {
  const pp = PACKS.find(p => p.id === packId);
  return pp ? `R$ ${pp.brl.toFixed(2).replace('.', ',')} (${pp.coins} moedas)` : packId || '';
}

// ---- Proteção contra manipulação (seção 47) ----

// Lock por usuário: serializa mutações para impedir recompensa duplicada em paralelo.
const locks = new Map();
function runExclusive(userId, fn) {
  const prev = locks.get(userId) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  locks.set(userId, run.then(() => {}, () => {}));
  return run;
}

// Normaliza e valida userId (rejeita valores inválidos no cliente).
const UID_RE = /^[A-Za-z0-9._-]{1,40}$/;
function uid(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return UID_RE.test(s) ? s : null;
}

// Sanitiza nick (sem caracteres de controle, máx 24).
function nickSan(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
}

// IP real (atrás de proxy).
function ipReq(req) {
  return String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '?').trim();
}

const APP_SECRET = process.env.GT_APP_SECRET || null;

// Limite por IP nos endpoints sensíveis.
function limitaIp(max, windowMs) {
  return (req, res, next) => {
    const b = limit.rate('ip:' + ipReq(req), max, windowMs);
    if (!b.ok) return res.status(429).json({ error: 'Muitas requisições — aguarde um pouco', retryAfter: b.retryAfter });
    next();
  };
}

// ---- Painel administrativo (seções 36-39) ----
function adToken(req) {
  return String(req.headers['x-admin'] || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, ''));
}
function adminOnly(req, res, next) {
  if (!adminseg.auth(adToken(req))) return res.status(401).json({ error: 'não autorizado' });
  next();
}
const ANALYTICS_TYPES = ['game_open', 'spin_start', 'spin_result', 'building_upgrade', 'village_complete',
  'attack', 'raid', 'mission_complete', 'rewarded_ad_started', 'rewarded_ad_completed', 'ad_reward_claimed'];

// Se for compra do Criador de Vídeos, libera o usuário em vez de dar moedas
function aplicarCredito(stored) {
  if (stored && String(stored.packId).startsWith('CRIADOR_')) {
    const u = criador.getUso(stored.userId);
    u.liberado = true;
    const plano = String(stored.packId).replace('CRIADOR_', '');
    return { liberado: true, plano };
  }
  return null;
}

// -------------------------------------------------------
// Rastreio de renda de anúncios (AdMob) — o app manda cada
// impressão paga pra cá, a gente acumula e avisa o dono.
// -------------------------------------------------------
const adState = {
  totals: {
    banner: { imps: 0, revenue: 0 },
    interstitial: { imps: 0, revenue: 0 },
    recompensado: { imps: 0, revenue: 0 }
  },
  totalRevenue: 0,
  day: new Date().toISOString().slice(0, 10),
  dayRevenue: 0,
  events: [],
  lastMilestone: 0
};
function adTodayKey() {
  return new Date().toISOString().slice(0, 10);
}
function adNotifyMilestone() {
  if (adState.totalRevenue - adState.lastMilestone >= 1) {
    adState.lastMilestone = adState.totalRevenue;
    const r = adState.totalRevenue;
    const b = adState.totals.banner, i = adState.totals.interstitial, rc = adState.totals.recompensado;
    notifyTelegram(
      `📈 ANÚNCIOS: R$ ${r.toFixed(2).replace('.', ',')} acumulado!\n` +
      `🟧 banner ${b.imps} imp · ${b.revenue.toFixed(2).replace('.', ',')}\n` +
      `🟦 cheio ${i.imps} imp · ${i.revenue.toFixed(2).replace('.', ',')}\n` +
      `🎁 recompensado ${rc.imps} imp · ${rc.revenue.toFixed(2).replace('.', ',')}\n` +
      `💰 Hoje: R$ ${adState.dayRevenue.toFixed(2).replace('.', ',')}`
    );
  }
}
app.post('/api/ad-event', express.json(), limitaIp(60, 30000), (req, res) => {
  const { type, valueMicros, currencyCode, networkName } = req.body || {};
  const t = ['banner', 'interstitial', 'recompensado'].includes(type) ? type : 'outros';
  const value = Number(valueMicros) || 0;
  const rev = value / 1e6;
  adState.totals[t] = adState.totals[t] || { imps: 0, revenue: 0 };
  adState.totals[t].imps += 1;
  adState.totals[t].revenue += rev;
  adState.totalRevenue += rev;
  if (adTodayKey() !== adState.day) {
    adState.day = adTodayKey();
    adState.dayRevenue = 0;
  }
  adState.dayRevenue += rev;
  if (t === 'recompensado') adminseg.log('rewarded_ad_completed', networkName || '');
  adState.events.unshift({
    ts: Date.now(),
    type: t,
    value: rev,
    currency: currencyCode || 'BRL',
    network: networkName || ''
  });
  if (adState.events.length > 200) adState.events.pop();
  if (rev > 0) console.log(`[ads] ${t} +R$ ${rev.toFixed(4)} (${networkName || '?'}) total R$ ${adState.totalRevenue.toFixed(2)}`);
  adNotifyMilestone();
  res.json({ ok: true });
});

// Para o webhook do Mercado Pago precisamos dos dados brutos (raw body)
app.use('/api/webhook', express.raw({ type: '*/*' }));
app.use(express.json());
app.use(cors());

// -------------------------------------------------------
// Jogo (arquivo estático)
// -------------------------------------------------------
app.use(express.static(GAME_DIR));

// Cash Royale (battle royale) também é servido por este mesmo serviço
app.use('/royale', express.static(path.join(__dirname, 'cash-royale', 'public')));

// Batalha do Cavaleiro (mundo aberto)
app.get('/batalha', (req, res) => res.sendFile(path.join(__dirname, 'public', 'aventura.html')));
app.get('/aventura', (req, res) => res.sendFile(path.join(__dirname, 'public', 'aventura.html')));
app.get('/jogos', (req, res) => res.sendFile(path.join(__dirname, 'public', 'jogos.html')));
app.get('/bingo', (req, res) => res.sendFile(path.join(__dirname, 'public', 'bingo.html')));
app.get('/roda', (req, res) => res.sendFile(path.join(__dirname, 'public', 'roda.html')));
app.get('/cartas', (req, res) => res.sendFile(path.join(__dirname, 'public', 'cartas.html')));
app.get('/loteria', (req, res) => res.sendFile(path.join(__dirname, 'public', 'loteria.html')));
app.get('/turbo', (req, res) => res.sendFile(path.join(__dirname, 'public', 'turbo.html')));
app.get('/gato', (req, res) => res.sendFile(path.join(__dirname, 'public', 'gato.html')));
app.get('/gato-tv', (req, res) => res.sendFile(path.join(__dirname, 'public', 'gato-tv.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/criador', (req, res) => res.sendFile(path.join(__dirname, 'public', 'criador.html')));
app.get('/pisstoll', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pisstoll.html')));
app.get('/divulgar', (req, res) => res.sendFile(path.join(__dirname, 'public', 'divulgar.html')));

// -------------------------------------------------------
// PACKS: pacotes de moedas vendidos via Pix
// -------------------------------------------------------
const PACKS = [
  { id: 'p1', name: '100 Moedas', brl: 1.00, coins: 100 },
  { id: 'p3', name: '400 Moedas', brl: 3.00, coins: 400 },
  { id: 'p5', name: '1000 Moedas', brl: 5.00, coins: 1000 }
];

// -------------------------------------------------------
// 1) Criar pagamento Pix
//    POST /api/create-pix  { userId, packId }
// -------------------------------------------------------
app.post('/api/create-pix', async (req, res) => {
  try {
    const { userId, packId } = req.body;
    if (!userId || !packId) return res.status(400).json({ error: 'userId e packId são obrigatórios' });

    const pack = PACKS.find(p => p.id === packId);
    if (!pack) return res.status(400).json({ error: 'Pacote inválido' });

    // Cria a ordem Pix no Mercado Pago
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const result = await pix.createPayment(pack, baseUrl);
    const paymentId = String(result.id);

    // Guarda o pagamento pendente
    await db.dbSavePayment(paymentId, {
      userId,
      packId,
      coins: pack.coins
    });

    res.json({
      paymentId,
      qrCode: result.point_of_interaction.transaction_data.qr_code,
      qrCodeBase64: result.point_of_interaction.transaction_data.qr_code_base64,
      expiresIn: result.date_of_expiration
    });
  } catch (err) {
    console.error('Erro ao criar Pix:', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao criar pagamento' });
  }
});

// -------------------------------------------------------
// 2) Consultar status de um pagamento (polling do jogo)
//    GET /api/payment-status/:paymentId
// -------------------------------------------------------
app.get('/api/payment-status/:paymentId', async (req, res) => {
  try {
    const paymentId = String(req.params.paymentId);
    // Primeiro consulta no Mercado Pago o status atual
    const status = await pix.getStatus(paymentId);

    let credited = false;
    let coins = 0;
    if (status === 'approved') {
      const stored = await db.dbApprovePayment(paymentId);
      if (stored) {
        const lib = aplicarCredito(stored);
        if (lib) {
          credited = true;
          coins = lib.liberado ? 1 : 0;
          notifyTelegram(`🎬 CRIADOR DE VÍDEOS LIBERADO!\n💲 Plano: ${lib.plano}\n👤 Usuário: ${stored.userId}\n🧾 Pagamento: ${paymentId}`);
        } else {
          await db.dbAddCoins(stored.userId, stored.coins);
          credited = true;
          coins = stored.coins;
          notifyTelegram(`💰 Pix PAGO! Compra ${packLabel(stored.packId)} · +${stored.coins} moedas\n👤 Jogador: ${stored.userId}\n🧾 Pagamento: ${paymentId}`);
        }
      } else {
        const p = await db.dbGetPayment(paymentId);
        coins = p ? p.coins : 0;
      }
    } else {
      const p = await db.dbGetPayment(paymentId);
      coins = p ? p.coins : 0;
    }

    res.json({ paymentId, status, credited, coins });
  } catch (err) {
    console.error('Erro ao consultar pagamento:', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao consultar pagamento' });
  }
});

// -------------------------------------------------------
// 3) Webhook: o Mercado Pago avisa quando o Pix é pago
//    POST /api/webhook/mp  (configure no painel MP)
// -------------------------------------------------------
app.post('/api/webhook/mp', (req, res) => {
  try {
    const body = req.body;
    const data = typeof body === 'string' ? JSON.parse(body) : body;

    const paymentId = data?.data?.id || body?.data?.id;
    if (paymentId) {
      console.log('Webhook recebido para pagamento', paymentId);
      // Processa de forma assíncrona, consultando o status real
      pix.getStatus(String(paymentId)).then(async status => {
        if (status === 'approved') {
          const stored = await db.dbApprovePayment(String(paymentId));
          if (stored) {
            const lib = aplicarCredito(stored);
            if (lib) {
              console.log(`Criador liberado ${stored.userId} (${lib.plano})`);
              notifyTelegram(`🎬 CRIADOR DE VÍDEOS LIBERADO!\n💲 Plano: ${lib.plano}\n👤 Usuário: ${stored.userId}\n🧾 Pagamento: ${paymentId}`);
            } else {
              await db.dbAddCoins(stored.userId, stored.coins);
              console.log(`Pagamento ${paymentId} aprovado +${stored.coins} moedas para ${stored.userId}`);
              notifyTelegram(`💰 Pix PAGO! Compra ${packLabel(stored.packId)} · +${stored.coins} moedas\n👤 Jogador: ${stored.userId}\n🧾 Pagamento: ${paymentId}`);
            }
          }
        }
      }).catch(e => console.error('Erro no webhook:', e.message));
    }
    return res.sendStatus(200);
  } catch (err) {
    console.error('Webhook inválido:', err.message);
    return res.sendStatus(200);
  }
});

// -------------------------------------------------------
// 4) Consultar saldo do usuário
//    GET /api/balance/:userId
// -------------------------------------------------------
app.get('/api/balance/:userId', async (req, res) => {
  try {
    const { balance } = await db.dbGetUser(req.params.userId);
    res.json({ balance });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao consultar saldo' });
  }
});

// -------------------------------------------------------
// 5b) Gastar moedas (comprar boost)
//    POST /api/spend  { userId, cost }
// -------------------------------------------------------
app.post('/api/spend', async (req, res) => {
  try {
    const userId = uid(req.body && req.body.userId);
    const cost = req.body && req.body.cost;
    if (!userId) return res.status(400).json({ error: 'userId inválido' });
    if (typeof cost !== 'number' || !Number.isSafeInteger(cost) || cost <= 0 || cost > 1000000) return res.status(400).json({ error: 'valor inválido' });
    if (APP_SECRET && req.headers['x-app-secret'] !== APP_SECRET) return res.status(403).json({ error: 'acesso negado' });
    const lb = limit.rate('sp:' + userId, 10, 10000);
    if (!lb.ok) return res.status(429).json({ error: 'Muito rápido — aguarde um pouco', retryAfter: lb.retryAfter });
    const r = await db.dbSpendCoins(userId, cost);
    if (!r) return res.status(400).json({ error: 'Moedas insuficientes' });
    res.json({ balance: r.balance });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao gastar moedas' });
  }
});

// -------------------------------------------------------
// 5c) Adicionar moedas (ganhas jogando)
//    POST /api/add  { userId, amount }
//    Com GT_APP_SECRET configurado, exige o header x-app-secret
//    (consumidor legítimo = semente pix/plataforma). Sem segredo,
//    fica limitado por valor e teto diário. O jogo Gatinho NÃO usa
//    este endpoint: ganhos de anúncio vêm de /api/gato/ad-reward.
// -------------------------------------------------------
app.post('/api/add', limitaIp(120, 10000), async (req, res) => {
  try {
    const userId = uid(req.body && req.body.userId);
    const amount = req.body && req.body.amount;
    if (!userId) return res.status(400).json({ error: 'userId inválido' });
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) return res.status(400).json({ error: 'valor inválido' });
    if (APP_SECRET && req.headers['x-app-secret'] !== APP_SECRET) return res.status(403).json({ error: 'acesso negado' });
    const lb = limit.rate('ad:' + userId, 20, 10000);
    if (!lb.ok) return res.status(429).json({ error: 'Muito rápido — aguarde um pouco', retryAfter: lb.retryAfter });
    const cap = limit.acc('addtotal:' + userId, amount, 200000, 86400000);
    if (!cap.ok) return res.status(429).json({ error: 'Limite diário excedido' });
    const r = await db.dbAddCoins(userId, amount);
    res.json({ balance: r.balance });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao adicionar moedas' });
  }
});

// -------------------------------------------------------
// 7) Listar pacotes
// -------------------------------------------------------
app.get('/api/packs', (req, res) => {
  res.json(PACKS.map(p => ({ id: p.id, name: p.name, brl: p.brl, coins: p.coins })));
});

// -------------------------------------------------------
// 8) ARENA CASH ROYALE (battle royale)
// -------------------------------------------------------
app.get('/api/arena/status', (req, res) => {
  res.json(arena.status());
});

app.post('/api/arena/join', async (req, res) => {
  try {
    const { userId, nick } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
    const r = await arena.join(db, userId, nick);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro ao entrar na arena:', err.message);
    res.status(500).json({ error: 'Erro ao entrar na arena' });
  }
});

app.post('/api/arena/leave', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
    const r = await arena.leave(db, userId);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao sair' });
  }
});

// -------------------------------------------------------
// 8.5) BINGO DIÁRIO (jackpot acumulativo)
// -------------------------------------------------------
app.get('/api/bingo/status', (req, res) => {
  res.json(bingo.status(String(req.query.userId || '')));
});

app.post('/api/bingo/buy', async (req, res) => {
  try {
    const { userId, nick } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
    const r = await bingo.buyCard(db, userId, nick);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro ao comprar cartela:', err.message);
    res.status(500).json({ error: 'Erro ao comprar cartela' });
  }
});

app.get('/api/admin/bingo', (req, res) => {
  if (!adminKeyOk(req)) return res.status(401).json({ error: 'chave inválida' });
  const s = bingo.status();
  res.json({ round: s.round, jackpot: s.jackpot, cardsSold: s.cardsSold, players: s.players, stats: s.stats });
});

// -------------------------------------------------------
// 8.6) RODA DA FORTUNA
// -------------------------------------------------------
app.get('/api/roda/status', (req, res) => res.json(roda.status()));

app.post('/api/roda/spin', async (req, res) => {
  try {
    const { userId, nick } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
    const r = await roda.spin(db, userId, nick);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro ao girar a roda:', err.message);
    res.status(500).json({ error: 'Erro ao girar a roda' });
  }
});

app.get('/api/admin/roda', (req, res) => {
  if (!adminKeyOk(req)) return res.status(401).json({ error: 'chave inválida' });
  res.json(roda.status());
});

// -------------------------------------------------------
// 8.7) BATALHA 1x1 DE CARTAS (PvP)
// -------------------------------------------------------
app.get('/api/cartas/status', (req, res) => {
  if (req.query.userId) res.json(cartas.status(String(req.query.userId)));
  else res.json(cartas.snapshot());
});

app.post('/api/cartas/join', async (req, res) => {
  try {
    const { userId, nick } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
    const r = await cartas.join(db, userId, nick);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro ao entrar nas cartas:', err.message);
    res.status(500).json({ error: 'Erro ao entrar nas cartas' });
  }
});

app.post('/api/cartas/pick', async (req, res) => {
  try {
    const { userId, cardIdx } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
    const r = cartas.pick(db, userId, Number(cardIdx));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro ao jogar carta:', err.message);
    res.status(500).json({ error: 'Erro ao jogar carta' });
  }
});

app.get('/api/admin/cartas', (req, res) => {
  if (!adminKeyOk(req)) return res.status(401).json({ error: 'chave inválida' });
  res.json(cartas.snapshot());
});

// -------------------------------------------------------
// 8.8) LOTERIA DO SITE (número 00-99)
// -------------------------------------------------------
app.get('/api/loteria/status', (req, res) => res.json(loteria.status(String(req.query.userId || ''))));

app.post('/api/loteria/buy', async (req, res) => {
  try {
    const { userId, num } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
    const r = await loteria.buy(db, userId, num);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro na loteria:', err.message);
    res.status(500).json({ error: 'Erro na loteria' });
  }
});

// -------------------------------------------------------
// 8.9) MODO TURBO (multiplicador estilo crash)
// -------------------------------------------------------
app.get('/api/turbo/status', (req, res) => res.json(turbo.status(String(req.query.userId || ''))));

app.post('/api/turbo/bet', async (req, res) => {
  try {
    const { userId, autoCash } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
    const r = await turbo.bet(db, userId, autoCash);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro no turbo:', err.message);
    res.status(500).json({ error: 'Erro no turbo' });
  }
});

app.post('/api/turbo/cashout', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
    const r = await turbo.cashOut(db, userId, false);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro no resgate:', err.message);
    res.status(500).json({ error: 'Erro no resgate' });
  }
});

// Notifica TVs pareadas após ações que mudam o estado (WebSocket de sessão).
function pushSinc(userId) {
  const w = app.get('wsReal');
  if (w) w.pushSync(userId);
}

app.get('/api/gato/status', (req, res) => res.json(gato.status()));
app.use('/api/gato', limitaIp(150, 15000));

// ---- Analytics (38) e Telemetria (39) vindos do cliente ----
app.post('/api/gato/analytics', async (req, res) => {
  try {
    const type = String((req.body && req.body.type) || '');
    const userId = uid(req.body && req.body.userId);
    if (!ANALYTICS_TYPES.includes(type)) return res.status(400).json({ error: 'tipo inválido' });
    adminseg.log(type, userId || '');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'erro ao registrar' });
  }
});
app.post('/api/gato/telemetry', async (req, res) => {
  try {
    const kind = String((req.body && req.body.kind) || 'client');
    const msg = String((req.body && req.body.msg) || '');
    if (!/^[A-Za-z0-9_-]{1,24}$/.test(kind)) return res.status(400).json({ error: 'tipo inválido' });
    adminseg.tele(kind, msg.slice(0, 200));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'erro ao registrar' });
  }
});

// ---- Painel /admin ----
app.post('/api/admin/login', (req, res) => {
  const token = adminseg.login(String((req.body && req.body.pass) || ''));
  if (!token) return res.status(401).json({ error: 'senha incorreta' });
  res.json({ token });
});
app.post('/api/admin/logout', adminOnly, (req, res) => {
  adminseg.logout(adToken(req)); res.json({ ok: true });
});
app.get('/api/admin/config', adminOnly, (req, res) => res.json({ config: gato.getConfig() }));
app.post('/api/admin/config', adminOnly, (req, res) => {
  const r = gato.setConfig(String((req.body && req.body.key) || ''), req.body && req.body.value);
  if (r.error) return res.status(400).json({ error: r.error });
  adminseg.log('config_set', r.key + '=' + r.value);
  res.json({ ok: true, key: r.key, value: r.value, config: gato.getConfig() });
});
app.get('/api/admin/events', adminOnly, (req, res) => res.json({ events: gato.listEvents() }));
app.post('/api/admin/event', adminOnly, (req, res) => {
  const action = String((req.body && req.body.action) || '');
  let r;
  if (action === 'toggle') {
    r = gato.setEvent(String((req.body && req.body.id) || ''), { ligado: !!req.body.ligado });
    if (!r.error) adminseg.log('event_toggle', r.evento.id + '=' + (r.evento.ligado ? 'on' : 'off'));
  } else if (action === 'create') {
    r = gato.addEvent(req.body && req.body.event);
    if (!r.error) adminseg.log('event_create', r.evento.id);
  } else return res.status(400).json({ error: 'ação inválida' });
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true, evento: r.evento });
});
app.get('/api/admin/users', adminOnly, async (req, res) => {
  try {
    const [stats, top] = await Promise.all([db.dbAdminStats(), db.dbLeaderboard(100)]);
    res.json({ stats, top });
  } catch (err) { res.status(500).json({ error: 'erro ao listar usuários' }); }
});
app.get('/api/admin/ads', adminOnly, (req, res) => {
  res.json({ totals: adState.totals, totalRevenue: adState.totalRevenue, dayRevenue: adState.dayRevenue, last: adState.events.slice(0, 20) });
});
app.get('/api/admin/analytics', adminOnly, (req, res) => res.json(adminseg.analytics()));
app.get('/api/admin/errors', adminOnly, (req, res) => res.json({ errors: adminseg.errorsTail(), state: adminseg.state() }));
app.get('/api/admin/audit', adminOnly, (req, res) => res.json({ audit: adminseg.auditTail() }));
app.post('/api/admin/balance', adminOnly, async (req, res) => {
  try {
    const userId = uid(req.body && req.body.userId);
    const delta = Number((req.body && req.body.delta) || 0);
    const motivo = String((req.body && req.body.motivo) || '');
    if (!userId) return res.status(400).json({ error: 'userId inválido' });
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1000000) return res.status(400).json({ error: 'delta inválido' });
    const ant = await db.dbGetUser(userId);
    const r = delta > 0 ? await db.dbAddCoins(userId, delta) : await db.dbSpendCoins(userId, -delta);
    if (!r || !r.balance) return res.status(400).json({ error: 'saldo insuficiente' });
    adminseg.auditAdd(adToken(req).slice(0, 8), userId, delta, motivo, (ant && ant.balance) || 0, r.balance);
    res.json({ ok: true, balance: r.balance, // auditoria registrada
    });
  } catch (err) { res.status(500).json({ error: 'erro ao ajustar saldo' }); }
});

app.get('/api/gato/ranking', async (req, res) => {
  try {
    const r = await gato.ranking(db, String(req.query.userId || ''));
    res.json(r);
  } catch (err) {
    console.error('Erro no ranking do gato:', err.message);
    res.status(500).json({ error: 'Erro no ranking' });
  }
});

// ---- Amigos e presentes ----
app.get('/api/gato/amigos', async (req, res) => {
  try {
    const r = await gato.amigosList(db, String(req.query.userId || ''));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro nos amigos do gato:', err.message);
    res.status(500).json({ error: 'Erro nos amigos' });
  }
});

app.post('/api/gato/amigos/add', async (req, res) => {
  try {
    const me = uid(req.body && req.body.userId);
    const alvo = uid(req.body && req.body.codigo);
    if (!me) return res.status(400).json({ error: 'userId inválido' });
    if (!alvo) return res.status(400).json({ error: 'código inválido' });
    const lb = limit.rate('u:' + me, 30, 15000);
    if (!lb.ok) return res.status(429).json({ error: 'Muito rápido — aguarde um pouco', retryAfter: lb.retryAfter });
    const r = await runExclusive(me, () => gato.amigoAdd(db, me, alvo));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro ao adicionar amigo:', err.message);
    adminseg.tele('adicionar', err.message);
    res.status(500).json({ error: 'Erro ao adicionar amigo' });
  }
});

app.post('/api/gato/amigos/remove', async (req, res) => {
  try {
    const me = uid(req.body && req.body.userId);
    const alvo = uid(req.body && req.body.codigo);
    if (!me) return res.status(400).json({ error: 'userId inválido' });
    if (!alvo) return res.status(400).json({ error: 'código inválido' });
    const lb = limit.rate('u:' + me, 30, 15000);
    if (!lb.ok) return res.status(429).json({ error: 'Muito rápido — aguarde um pouco', retryAfter: lb.retryAfter });
    const r = await runExclusive(me, () => gato.amigoRemove(db, me, alvo));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro ao remover amigo:', err.message);
    adminseg.tele('remover', err.message);
    res.status(500).json({ error: 'Erro ao remover amigo' });
  }
});

app.post('/api/gato/presente', async (req, res) => {
  try {
    const me = uid(req.body && req.body.userId);
    const alvo = uid(req.body && req.body.codigo);
    if (!me) return res.status(400).json({ error: 'userId inválido' });
    if (!alvo) return res.status(400).json({ error: 'código inválido' });
    const lb = limit.rate('u:' + me, 30, 15000);
    if (!lb.ok) return res.status(429).json({ error: 'Muito rápido — aguarde um pouco', retryAfter: lb.retryAfter });
    const r = await runExclusive(me, () => gato.presente(db, me, alvo));
    if (r.error) return res.status(400).json({ error: r.error });
    pushSinc(me);
    res.json(r);
  } catch (err) {
    console.error('Erro no presente do gato:', err.message);
    adminseg.tele('presente', err.message);
    res.status(500).json({ error: 'Erro no presente' });
  }
});

// ---- Pareamento celular ↔ Smart TV ----
app.post('/api/gato/tv/register', (req, res) => {
  const { tvId } = req.body;
  res.json(gato.tvRegister(tvId));
});
app.post('/api/gato/tv/connect', (req, res) => {
  const { code, userId } = req.body;
  const r = gato.tvConnect(code, userId);
  if (!r.error && r.tvId) { const w = app.get('wsReal'); if (w) w.pushPaired(r.tvId, userId); }
  res.status(r.error ? 400 : 200).json(r);
});
app.get('/api/gato/tv/status', async (req, res) => {
  try {
    const r = await gato.tvStatus(db, String(req.query.tvId || ''));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro no status da TV:', err.message);
    res.status(500).json({ error: 'Erro no status da TV' });
  }
});

app.get('/api/gato/collection', async (req, res) => {
  try {
    const r = await gato.collection(db, String(req.query.userId || ''));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro na coleção do gato:', err.message);
    res.status(500).json({ error: 'Erro na coleção' });
  }
});

app.post('/api/gato/mission-claim', async (req, res) => {
  try {
    const userId = uid(req.body && req.body.userId);
    const id = String((req.body && req.body.id) || '');
    if (!userId) return res.status(400).json({ error: 'userId inválido' });
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(id)) return res.status(400).json({ error: 'missão inválida' });
    const lb = limit.rate('u:' + userId, 30, 15000);
    if (!lb.ok) return res.status(429).json({ error: 'Muito rápido — aguarde um pouco', retryAfter: lb.retryAfter });
    const r = await runExclusive(userId, () => gato.missionClaim(db, userId, id));
    if (r.error) return res.status(400).json({ error: r.error });
    adminseg.log('mission_complete', id);
    pushSinc(userId);
    res.json(r);
  } catch (err) {
    console.error('Erro na missão do gato:', err.message);
    adminseg.tele('missao', err.message);
    res.status(500).json({ error: 'Erro na missão' });
  }
});

app.get('/api/gato/village', async (req, res) => {
  try {
    const r = await gato.village(db, String(req.query.userId || ''));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro ao buscar vila do gato:', err.message);
    res.status(500).json({ error: 'Erro ao buscar vila' });
  }
});

app.post('/api/gato/spin', async (req, res) => {
  try {
    const userId = uid(req.body && req.body.userId);
    if (!userId) return res.status(400).json({ error: 'userId inválido' });
    const nick = nickSan(req.body && req.body.nick);
    const lb = limit.rate('u:' + userId, 30, 15000);
    if (!lb.ok) return res.status(429).json({ error: 'Muito rápido — aguarde um pouco', retryAfter: lb.retryAfter });
    adminseg.log('spin_start', userId);
    const r = await runExclusive(userId, () => gato.spin(db, userId, nick));
    if (r.error) return res.status(400).json({ error: r.error });
    adminseg.log('spin_result', r.kind || '?');
    if (r.kind === 'attack') adminseg.log('attack', userId);
    pushSinc(userId);
    res.json(r);
  } catch (err) {
    console.error('Erro no gato:', err.message);
    adminseg.tele('spin', err.message);
    res.status(500).json({ error: 'Erro no gato' });
  }
});

app.post('/api/gato/raid', async (req, res) => {
  try {
    const userId = uid(req.body && req.body.userId);
    const pick = req.body && req.body.pick;
    if (!userId) return res.status(400).json({ error: 'userId inválido' });
    if (![0, 1, 2].includes(pick)) return res.status(400).json({ error: 'Escolha inválida' });
    const lb = limit.rate('u:' + userId, 30, 15000);
    if (!lb.ok) return res.status(429).json({ error: 'Muito rápido — aguarde um pouco', retryAfter: lb.retryAfter });
    const r = await runExclusive(userId, () => gato.raid(db, userId, pick));
    if (r.error) return res.status(400).json({ error: r.error });
    adminseg.log('raid', String(r.prize));
    pushSinc(userId);
    res.json(r);
  } catch (err) {
    console.error('Erro no saque do gato:', err.message);
    res.status(500).json({ error: 'Erro no saque' });
  }
});

app.post('/api/gato/build', async (req, res) => {
  try {
    const userId = uid(req.body && req.body.userId);
    if (!userId) return res.status(400).json({ error: 'userId inválido' });
    const lb = limit.rate('u:' + userId, 30, 15000);
    if (!lb.ok) return res.status(429).json({ error: 'Muito rápido — aguarde um pouco', retryAfter: lb.retryAfter });
    const r = await runExclusive(userId, () => gato.build(db, userId));
    if (r.error) return res.status(400).json({ error: r.error });
    adminseg.log('building_upgrade', (r.building && r.building.nome) || '?');
    if (r.complete) adminseg.log('village_complete', userId);
    pushSinc(userId);
    res.json(r);
  } catch (err) {
    console.error('Erro ao construir vila do gato:', err.message);
    adminseg.tele('build', err.message);
    res.status(500).json({ error: 'Erro ao construir' });
  }
});

app.post('/api/gato/advance', async (req, res) => {
  try {
    const userId = uid(req.body && req.body.userId);
    if (!userId) return res.status(400).json({ error: 'userId inválido' });
    const lb = limit.rate('u:' + userId, 30, 15000);
    if (!lb.ok) return res.status(429).json({ error: 'Muito rápido — aguarde um pouco', retryAfter: lb.retryAfter });
    const r = await runExclusive(userId, () => gato.advance(db, userId));
    if (r.error) return res.status(400).json({ error: r.error });
    pushSinc(userId);
    res.json(r);
  } catch (err) {
    console.error('Erro ao avançar vila do gato:', err.message);
    adminseg.tele('avançar', err.message);
    res.status(500).json({ error: 'Erro ao avançar' });
  }
});

app.post('/api/gato/daily', async (req, res) => {
  try {
    const userId = uid(req.body && req.body.userId);
    if (!userId) return res.status(400).json({ error: 'userId inválido' });
    const lb = limit.rate('u:' + userId, 30, 15000);
    if (!lb.ok) return res.status(429).json({ error: 'Muito rápido — aguarde um pouco', retryAfter: lb.retryAfter });
    const r = await runExclusive(userId, () => gato.daily(db, userId));
    if (r.error) return res.status(400).json({ error: r.error });
    pushSinc(userId);
    res.json(r);
  } catch (err) {
    console.error('Erro na diária do gato:', err.message);
    adminseg.tele('diaria', err.message);
    res.status(500).json({ error: 'Erro na diária' });
  }
});

app.post('/api/gato/ad-reward', async (req, res) => {
  try {
    const userId = uid(req.body && req.body.userId);
    if (!userId) return res.status(400).json({ error: 'userId inválido' });
    const lb = limit.rate('u:' + userId, 10, 15000);
    if (!lb.ok) return res.status(429).json({ error: 'Muito rápido — aguarde um pouco', retryAfter: lb.retryAfter });
    const r = await runExclusive(userId, () => gato.adReward(db, userId));
    if (r.error) return res.status(r.retryIn ? 429 : 400).json({ error: r.error, retryIn: r.retryIn || 0 });
    adminseg.log('ad_reward_claimed', userId);
    pushSinc(userId);
    res.json(r);
  } catch (err) {
    console.error('Erro no anúncio do gato:', err.message);
    adminseg.tele('anuncio', err.message);
    res.status(500).json({ error: 'Erro no anúncio' });
  }
});

// -------------------------------------------------------
// CRIADOR DE VÍDEOS — sugestão, geração, limite e liberação
// -------------------------------------------------------
app.get('/api/criador/sugerir', (req, res) => {
  const tipo = String(req.query.tipo || 'geral');
  res.json(criador.sugerir(tipo));
});

app.get('/api/criador/status', (req, res) => {
  res.json(criador.status(String(req.query.userId || '')));
});

app.post('/api/criador/gerar', async (req, res) => {
  try {
    const { userId, nome, f1, f2, emoji, paleta } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
    if (!criador.podeGerar(userId)) {
      return res.status(403).json({ error: 'Limite grátis atingido! Compre o acesso pra continuar.' });
    }
    const u = criador.getUso(userId);
    const result = await criador.gerarVideo(userId, { nome, f1, f2, emoji, paleta });
    u.count += 1;
    res.json({ ok: true, ...result, status: criador.status(userId) });
  } catch (err) {
    console.error('Erro ao gerar vídeo do criador:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/criador/liberar', async (req, res) => {
  try {
    const { userId, planId } = req.body;
    if (!userId || !planId) return res.status(400).json({ error: 'userId e planId obrigatórios' });
    const plan = criador.CFG.precos.find(p => p.id === planId);
    if (!plan) return res.status(400).json({ error: 'Plano inválido' });

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const result = await pix.createPayment({ name: plan.nome, brl: plan.brl, coins: 1, code: plan.code }, baseUrl);
    const paymentId = String(result.id);

    await db.dbSavePayment(paymentId, { userId, packId: 'CRIADOR_' + plan.id, coins: 1 });

    res.json({
      paymentId,
      qrCode: result.point_of_interaction.transaction_data.qr_code,
      qrCodeBase64: result.point_of_interaction.transaction_data.qr_code_base64,
      status: criador.status(userId)
    });
  } catch (err) {
    console.error('Erro ao criar Pix do criador:', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao gerar Pix' });
  }
});

app.get('/api/criador/video/:arquivo', (req, res) => {
  const nome = path.basename(String(req.params.arquivo));
  const caminho = path.join(criador.videoDir, nome);
  if (fs.existsSync(caminho)) {
    res.sendFile(caminho);
  } else {
    res.status(404).json({ error: 'Vídeo não encontrado' });
  }
});

app.get('/api/admin/jogos', (req, res) => {
  if (!adminKeyOk(req)) return res.status(401).json({ error: 'chave inválida' });
  res.json({
    bingo: { jackpot: bingo.status().jackpot, cardsSold: bingo.status().cardsSold },
    roda: roda.status(),
    cartas: cartas.snapshot(),
    loteria: loteria.status(),
    turbo: turbo.status(),
    gato: gato.status()
  });
});

// -------------------------------------------------------
// 9) MUNDO DO CAVALEIRO (RPG com mapa, NPCs e classes)
// -------------------------------------------------------
app.get('/api/char/:userId', async (req, res) => {
  try {
    const p = await rpg.profile(db, req.params.userId);
    const [coins, world] = await Promise.all([
      db.dbGetUser(req.params.userId).then(u => u.balance),
      rpg.worldState(db, req.params.userId)
    ]);
    res.json({ ...p, coins, entryCost: rpg.entryCost(p.phase), world });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar personagem' });
  }
});

app.post('/api/move', async (req, res) => {
  try {
    const { userId, dx, dy } = req.body;
    if (!userId || dx === undefined || dy === undefined) return res.status(400).json({ error: 'userId, dx e dy obrigatórios' });
    const r = await rpg.move(db, userId, Math.sign(+dx), Math.sign(+dy));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro ao mover:', err.message);
    res.status(500).json({ error: 'Erro ao mover' });
  }
});

app.post('/api/interact', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
    const r = await rpg.interact(db, userId);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro ao interagir:', err.message);
    res.status(500).json({ error: 'Erro ao interagir' });
  }
});

app.post('/api/shop/buy', async (req, res) => {
  try {
    const { userId, type, arg } = req.body;
    if (!userId || !type || !arg) return res.status(400).json({ error: 'userId, type e arg obrigatórios' });
    const r = await rpg.buyShop(db, userId, type, arg);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro na loja:', err.message);
    res.status(500).json({ error: 'Erro na loja' });
  }
});

app.post('/api/potion', async (req, res) => {
  try {
    const { userId, which } = req.body;
    if (!userId || !which) return res.status(400).json({ error: 'userId e which obrigatórios' });
    const r = await rpg.potionOut(db, userId, which);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro ao usar poção:', err.message);
    res.status(500).json({ error: 'Erro ao usar poção' });
  }
});

app.post('/api/battle/start', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
    const r = await rpg.startBossAt(db, userId);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) {
    console.error('Erro ao iniciar batalha:', err.message);
    res.status(500).json({ error: 'Erro ao iniciar batalha' });
  }
});

app.post('/api/battle/action', async (req, res) => {
  try {
    const { userId, action } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
    const r = await rpg.act(db, userId, action || 'attack');
    if (r.error) return res.status(400).json({ error: r.error });
    if (r.win === true) notifyTelegram(`🏆 BATALHA DO CAVALEIRO: usuário ${userId} venceu o chefe ${r.battle.type === 'boss' ? `da Fase ${r.battle.level}` : 'monstro'}! (+${r.battle.reward} moedas)`);
    if (r.win === false) notifyTelegram(`💀 BATALHA DO CAVALEIRO: usuário ${userId} caiu (${r.battle.level ? 'Fase ' + r.battle.level : 'monstro'}).`);
    res.json(r);
  } catch (err) {
    console.error('Erro na batalha:', err.message);
    res.status(500).json({ error: 'Erro na batalha' });
  }
});

// -------------------------------------------------------
// 9.1) ADMIN (usado pelo bot do Telegram) — exige ADMIN_KEY
// -------------------------------------------------------
function adminKeyOk(req) {
  return req.query.key && req.query.key === process.env.ADMIN_KEY;
}

app.get('/api/admin/stats', async (req, res) => {
  if (!adminKeyOk(req)) return res.status(401).json({ error: 'chave inválida' });
  try {
    res.json(await db.dbAdminStats());
  } catch (err) {
    console.error('Erro admin stats:', err.message);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

app.get('/api/admin/user/:userId', async (req, res) => {
  if (!adminKeyOk(req)) return res.status(401).json({ error: 'chave inválida' });
  try {
    const userId = req.params.userId;
    const [bal, p] = await Promise.all([
      db.dbGetUser(userId),
      rpg.profile(db, userId)
    ]);
    res.json({ balance: bal.balance, profile: p });
  } catch (err) {
    console.error('Erro admin user:', err.message);
    res.status(500).json({ error: 'Erro ao buscar jogador' });
  }
});

app.get('/api/admin/ads', (req, res) => {
  if (!adminKeyOk(req)) return res.status(401).json({ error: 'chave inválida' });
  res.json({
    totals: adState.totals,
    totalRevenue: adState.totalRevenue,
    day: adState.day,
    dayRevenue: adState.dayRevenue,
    events: adState.events.slice(0, 10)
  });
});

// -------------------------------------------------------
// 6) Bônus por vitória (tela de vitória)
//    POST /api/victory-bonus { userId }
// -------------------------------------------------------
app.post('/api/victory-bonus', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
  const r = await db.dbAddCoins(userId, 25);
  res.json({ balance: r.balance, bonus: 25 });
});

db.initDb().then(() => {
  arena.startLoop(db);
  bingo.startLoop(db);
  bingo.onEvent = (ev, info) => {
    if (ev === 'jackpot') {
      notifyTelegram(`🏆 BINGO! ${info.nick} levou ${info.amount} moedas no jackpot!`);
    } else if (ev === 'milestone') {
      notifyTelegram(`📈 BINGO: o pote chegou a ${info.jackpot} moedas!`);
    }
  };
  roda.onEvent = (ev, info) => {
    if (ev === 'jackpot') notifyTelegram(`🎡 JACKPOT NA RODA! ${info.nick} levou ${info.amount} moedas!`);
  };
  cartas.startLoop(db);
  cartas.onEvent = (ev, info) => {
    if (ev === 'winner') notifyTelegram(`🃏 Duelo! ${info.nick} venceu 1x1 e levou ${info.amount} moedas!`);
  };
  loteria.startLoop(db);
  loteria.onEvent = (ev, info) => {
    if (ev === 'winner') notifyTelegram(`🍀 Loteria! Saiu o ${info.num} e ${info.winners} bilhete(s) acertou(aram). Prêmio de ${info.amount} moedas!`);
  };
  turbo.startLoop(db);
  const server = app.listen(PORT, () => {
    console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
    console.log(`   Jogo servido de: ${GAME_DIR}`);
    console.log(`   URL pública (produção): ${process.env.BASE_URL}`);
    console.log(`   Banco de dados: ${process.env.DATABASE_URL ? 'Postgres' : 'memória'}`);
    console.log('');
    if (!process.env.MP_ACCESS_TOKEN) {
      console.log('⚠️  MP_ACCESS_TOKEN não configurado! Edite o arquivo .env');
    }
  });
  const wsReal = wscl.iniciar(server, db);
  app.set('wsReal', wsReal);
});