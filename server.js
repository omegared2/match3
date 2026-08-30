require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const pix = require('./pix');
const db = require('./db');
const arena = require('./arena');

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
        // Aprovado: entrega as moedas
        await db.dbAddCoins(stored.userId, stored.coins);
        credited = true;
        coins = stored.coins;
        notifyTelegram(`💰 Pix PAGO! Compra ${packLabel(stored.packId)} · +${stored.coins} moedas\n👤 Jogador: ${stored.userId}\n🧾 Pagamento: ${paymentId}`);
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
            await db.dbAddCoins(stored.userId, stored.coins);
            console.log(`Pagamento ${paymentId} aprovado +${stored.coins} moedas para ${stored.userId}`);
            notifyTelegram(`💰 Pix PAGO! Compra ${packLabel(stored.packId)} · +${stored.coins} moedas\n👤 Jogador: ${stored.userId}\n🧾 Pagamento: ${paymentId}`);
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
    const { userId, cost } = req.body;
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
// -------------------------------------------------------
app.post('/api/add', async (req, res) => {
  try {
    const { userId, amount } = req.body;
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
  app.listen(PORT, () => {
    console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
    console.log(`   Jogo servido de: ${GAME_DIR}`);
    console.log(`   URL pública (produção): ${process.env.BASE_URL}`);
    console.log(`   Banco de dados: ${process.env.DATABASE_URL ? 'Postgres' : 'memória'}`);
    console.log('');
    if (!process.env.MP_ACCESS_TOKEN) {
      console.log('⚠️  MP_ACCESS_TOKEN não configurado! Edite o arquivo .env');
    }
  });
});