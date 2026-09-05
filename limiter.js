'use strict';

// limiter.js — proteção contra repetição de requests (seção 47).
// Janelas fixas em memória: contagem de chamadas (rate) e soma de valores (acc).

const buckets = new Map();

function winStart(windowMs, now) {
  return Math.floor(now / windowMs);
}

// rate(key, max, windowMs) -> { ok, c, retryAfter }
function rate(key, max, windowMs) {
  const now = Date.now();
  const w = winStart(windowMs, now);
  const e = buckets.get(key);
  if (!e || e.w !== w) {
    buckets.set(key, { w, c: 1, sum: 0 });
    return { ok: true, c: 1, retryAfter: 0 };
  }
  if (e.c >= max) {
    return { ok: false, c: e.c, retryAfter: Math.max(1, Math.ceil(((e.w + 1) * windowMs - now) / 1000)) };
  }
  e.c++;
  return { ok: true, c: e.c, retryAfter: 0 };
}

// acc(key, amount, max, windowMs) -> { ok, total, retryAfter }
// Limita o TOTAL acumulado (ex.: moedas creditadas por dia) na janela.
function acc(key, amount, max, windowMs) {
  const now = Date.now();
  const w = winStart(windowMs, now);
  let e = buckets.get(key);
  if (!e || e.w !== w) {
    e = { w, c: 1, sum: amount };
    buckets.set(key, e);
    return { ok: amount <= max, total: e.sum, retryAfter: 0 };
  }
  e.sum += amount;
  if (e.sum > max) {
    return { ok: false, total: e.sum, retryAfter: Math.max(1, Math.ceil(((e.w + 1) * windowMs - now) / 1000)) };
  }
  return { ok: true, total: e.sum, retryAfter: 0 };
}

module.exports = { rate, acc, reset: () => buckets.clear() };