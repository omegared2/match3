// ads.js — Gerenciador de anúncios (AdSense) compartilhado.
// Modo placeholder quando não há IDs reais; modo real quando houver.
(function () {
  'use strict';

  var CFG = window.ADS_CONFIG || {};        // { banner, rewarded, interstitial, clientId }
  var REAL = window.ADS_REAL_IDS || null;   // ex.: { client: 'ca-pub-XXXX', slots: {...} }
  var ACTIVE = !!(REAL && REAL.client);     // modo real liga só se houver client ID

  var API = (location.origin.indexOf('localhost') !== -1 || location.protocol === 'file:')
    ? 'https://match3-te1c.onrender.com'
    : '';
  var USER_ID = localStorage.getItem('match3_user') ||
    ('player_' + Math.random().toString(36).slice(2, 10));
  localStorage.setItem('match3_user', USER_ID);

  var bannerShown = false;

  // --- configuração da página ---
  function resolveSlot(kind) {
    if (CFG.slots && CFG.slots[kind]) return CFG.slots[kind];
    if (REAL && REAL.slots && REAL.slots[kind]) return REAL.slots[kind];
    return null;
  }

  function loadRealScript(cb) {
    if (window.adsbygoogle) { cb(); return; }
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' +
      encodeURIComponent(REAL.client);
    s.crossOrigin = 'anonymous';
    s.onload = cb;
    s.onerror = function () { /* cai em placeholder silenciosamente */ };
    document.head.appendChild(s);
  }

  // --- modalidades ---
  function renderPlaceholder(containerId, kind) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'ad-ph';
    box.setAttribute('data-kind', kind);
    box.innerHTML = '<span>AD · ' + (kind === 'banner' ? 'banner' : kind === 'rewarded' ? 'recompensado' : 'interstitial') + ' (placeholder)</span>';
    el.appendChild(box);
  }

  function renderRealAd(containerId, kind) {
    var slot = resolveSlot(kind);
    var el = document.getElementById(containerId);
    if (!el || !slot) { renderPlaceholder(containerId, kind); return; }
    el.innerHTML = '';
    var ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', REAL.client);
    ins.setAttribute('data-ad-slot', slot);
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    el.appendChild(ins);
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  }

  function showBanner(containerId) {
    if (bannerShown) return;
    bannerShown = true;
    postAdEvent('banner');
    if (!ACTIVE) { renderPlaceholder(containerId, 'banner'); return; }
    loadRealScript(function () { renderRealAd(containerId, 'banner'); });
  }

  function doRewarded(opts) {
    opts = opts || {};
    postAdEvent('recompensado');
    // modo real: unidade nativa ainda não configurada — rende via overlay/timer
    var amount = (opts.coins || opts.amount) || 0;
    function finish() { if (opts.onComplete) opts.onComplete(); }
    if (!ACTIVE) {
      var i = setTimeout(function () {
        if (opts.onStart) { /* não re-cancela após iniciado */ }
        grantCoins(opts, function (bal) { if (opts.onComplete) opts.onComplete(bal); });
      }, 2000);
      if (opts.onStart) opts.onStart(function cancel() { clearTimeout(i); });
      return;
    }
    loadRealScript(function () {
      grantCoins(opts, function (bal) { if (opts.onComplete) opts.onComplete(bal); });
    });
  }

  function showInterstitial(onClose) {
    postAdEvent('interstitial');
    // modo real: unidade nativa ainda não configurada — usa overlay fallback
    if (!ACTIVE) {
      renderOverlay();
      setTimeout(closeOverlay, 2200);
      if (onClose) setTimeout(onClose, 2500);
      return;
    }
    loadRealScript(function () {
      renderOverlay();
      setTimeout(function () { closeOverlay(); if (onClose) onClose(); }, 3000);
    });
  }
  function renderOverlay() {
    if (document.getElementById('ad-overlay')) return;
    var ov = document.createElement('div');
    ov.id = 'ad-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'Anúncio');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(20,10,40,.9);z-index:9999;display:flex;align-items:center;justify-content:center;color:#fff;font-family:system-ui;';
    ov.innerHTML = '<div style="text-align:center"><div style="font-size:40px">📺</div><div>Anúncio</div><div style="font-size:12px;color:#bbb;margin-top:6px">(placeholder)</div></div>';
    document.body.appendChild(ov);
  }
  function closeOverlay() {
    var ov = document.getElementById('ad-overlay');
    if (ov) ov.remove();
  }
  function postAdEvent(type) {
    try {
      fetch(API + '/api/ad-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: type, valueMicros: 0, currencyCode: 'BRL', networkName: ACTIVE ? 'adsense' : 'placeholder' }),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }
  function grantCoins(opts, cb) {
    // Endpoint protegido (seção 47): o servidor decide o valor, cooldown e teto diário.
    var reward = opts.coins || opts.amount || 0;
    try {
      fetch(API + '/api/gato/ad-reward', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.ok) reward = d.reward;
        if (cb) cb(d && d.ok ? d.balance : null, d && d.retryIn);
      }).catch(function () { if (cb) cb(null); });
    } catch (e) {
      if (cb) cb(null);
    }
  }

  // --- API pública ---
  window.Ads = {
    showBanner: showBanner,
    showRewarded: doRewarded,
    showInterstitial: showInterstitial,
    isActive: function () { return ACTIVE; },
    getState: function () {
      return { active: ACTIVE, user: USER_ID, cfg: CFG };
    }
  };
})();
