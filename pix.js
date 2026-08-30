const axios = require('axios');
const crypto = require('crypto');

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const API = 'https://api.mercadopago.com';

/**
 * Cria um pagamento Pix no Mercado Pago.
 * Retorna os dados da transação + QR Code.
 */
async function createPayment(pack) {
  if (!ACCESS_TOKEN) {
    throw new Error('MP_ACCESS_TOKEN não configurado no arquivo .env');
  }

  const body = {
    transaction_amount: pack.brl,
    description: `Match-3: ${pack.coins} moedas (${pack.name})`,
    payment_method_id: 'pix',
    payer: {
      email: 'comprador@exemplo.com.br' // ideal: email do jogador
    },
    notification_url: `${BASE_URL}/api/webhook/mp`
  };

  const res = await axios.post(`${API}/v1/payments`, body, {
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'X-Idempotency-Key': crypto.randomUUID()
    }
  });

  return res.data;
}

/**
 * Consulta o status atual de um pagamento no Mercado Pago.
 */
async function getStatus(paymentId) {
  if (!ACCESS_TOKEN) {
    throw new Error('MP_ACCESS_TOKEN não configurado no arquivo .env');
  }

  const res = await axios.get(`${API}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
  });

  return res.data.status; // approved | pending | rejected | ...
}

module.exports = { createPayment, getStatus };
