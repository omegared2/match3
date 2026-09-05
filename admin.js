'use strict';

// admin.js — seções 36-39: sessão do painel /admin, analytics (38),
// telemetria de erros (39) e auditoria de edição de saldo (37).

const crypto = require('crypto');

const SESS_MIN = 12 * 3600 * 1000;
const MAX_EV = 5000;
const MAX_ERR = 500;
const MAX_AUDIT = 500;

const sessions = new Map(); // token -> expira
const events = [];          // analytics
const counters = {};        // analytics agrupado
const errors = [];          // telemetria
const audit = [];           // auditoria

function login(pass) {
  const okPass = process.env.GT_ADMIN_PASS || 'gatinho-admin';
  if (!pass || pass !== okPass) return null;
  const t = crypto.randomBytes(24).toString('hex');
  sessions.set(t, Date.now() + SESS_MIN);
  return t;
}
function auth(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(token); return false; }
  return true;
}
function logout(token) { sessions.delete(token); }

function log(kind, detail) {
  events.unshift({ ts: Date.now(), kind: String(kind || '?'), d: String(detail || '').slice(0, 160) });
  counters[kind] = (counters[kind] || 0) + 1;
  if (events.length > MAX_EV) events.pop();
}

function tele(kind, msg) {
  errors.unshift({ ts: Date.now(), kind: String(kind || 'api'), msg: String(msg || '').slice(0, 200) });
  counters['err_' + kind] = (counters['err_' + kind] || 0) + 1;
  if (errors.length > MAX_ERR) errors.pop();
}

function auditAdd(admin, userId, delta, motivo, oldN, newN) {
  audit.unshift({
    ts: Date.now(), admin: String(admin || '?'), userId: String(userId || '?'),
    delta, old: oldN, novo: newN, motivo: String(motivo || '').slice(0, 200)
  });
  if (audit.length > MAX_AUDIT) audit.pop();
}

function analytics() { return { counters, recent: events.slice(0, 80) }; }
function errorsTail() { return errors.slice(0, 120); }
function auditTail() { return audit.slice(0, 120); }
function state() {
  return { sessions: sessions.size, events: events.length, errors: errors.length, audit: audit.length };
}

module.exports = { login, auth, logout, log, tele, auditAdd, analytics, errorsTail, auditTail, state };