'use strict';

// Sincronização em tempo real celular ↔ Smart TV (WebSocket, seções 31-32 da spec).
// WebSocket só para o que precisa de tempo real: pareamento, sync de sessão e controle remoto.
// REST/API para todas as operações normais.

const { WebSocketServer } = require('ws');
const gato = require('./gato.js');

const televisores = new Map();  // tvId -> Set<ws>

function junta(set, ws) {
  set.add(ws);
  const fora = () => set.delete(ws);
  ws.on('close', fora);
  ws.on('error', fora);
}

function pushTvs(tvId, payload) {
  const set = televisores.get(tvId);
  if (!set) return;
  const msg = JSON.stringify(payload);
  set.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

function iniciar(server, db) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x');
    const tvId = url.searchParams.get('tvId');
    const userId = url.searchParams.get('userId');

    if (tvId) {
      if (!televisores.has(tvId)) televisores.set(tvId, new Set());
      junta(televisores.get(tvId), ws);
      // Ao conectar, informa a TV se já existe um celular pareado.
      gato.tvStatus(db, tvId).then(st => {
        if (ws.readyState === 1 && st && st.connected) ws.send(JSON.stringify({ type: 'paired', userId: st.userId }));
      }).catch(() => {});
      ws.send(JSON.stringify({ type: 'hello', peer: 'tv' }));
      return;
    }

    if (userId) {
      // Celular: pode agir como controle remoto da TV pareada.
      ws.on('message', raw => {
        try {
          const m = JSON.parse(raw.toString());
          if (!m || m.type !== 'ctrl' || !m.tvId || !m.key) return;
          pushTvs(m.tvId, { type: 'ctrl', key: m.key, from: userId });
        } catch (_) {}
      });
      ws.send(JSON.stringify({ type: 'hello', peer: 'cell' }));
      return;
    }

    ws.close(4400, 'role obrigatório');
  });

  return {
    // Notifica as TVs pareadas com o usuário (após ações REST) pra atualizar a sessão.
    pushSync(userId) {
      for (const [tvId] of televisores) {
        if (!televisores.get(tvId).size) continue;
        gato.tvStatus(db, tvId).then(st => {
          if (st && st.connected && st.userId === userId) pushTvs(tvId, { type: 'sync' });
        }).catch(() => {});
      }
    },
    // Empurra pro celular que a TV acabou de parear.
    pushPaired(tvId, userId) {
      pushTvs(tvId, { type: 'paired', userId });
    }
  };
}

module.exports = { iniciar };