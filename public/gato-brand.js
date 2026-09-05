/* ===== GATINHO · IDENTIDADE (seção 48) =====
   Mascote e ícone próprios (SVG original), favicon e efeitos sonoros
   sintetizados via WebAudio — nenhum asset copiado de outros jogos. */

(function () {
  'use strict';

  var CATSVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" aria-hidden="true">' +
    '<g stroke="#241305" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">' +
    '<path d="M58 78 L40 20 L100 50 Z" fill="#ffa94d"/>' +
    '<path d="M142 78 L160 20 L100 50 Z" fill="#ffa94d"/>' +
    '<ellipse cx="100" cy="118" rx="60" ry="56" fill="#ffa94d"/>' +
    '<path d="M66 74 L60 42 L97 56 Z" fill="#ffcf9f"/>' +
    '<path d="M134 74 L140 42 L103 56 Z" fill="#ffcf9f"/>' +
    '<path d="M92 64 L94 82" /><path d="M100 64 L100 82" /><path d="M108 64 L106 82" />' +
    '</g>' +
    '<ellipse class="eye" cx="73" cy="106" rx="7.5" ry="9" fill="#2a1506" transform="rotate(-6 73 106)"/>' +
    '<ellipse class="eye" cx="127" cy="106" rx="7.5" ry="9" fill="#2a1506" transform="rotate(6 127 106)"/>' +
    '<ellipse cx="76" cy="103" rx="2.4" ry="2.8" fill="#fff"/>' +
    '<ellipse cx="130" cy="103" rx="2.4" ry="2.8" fill="#fff"/>' +
    '<path d="M84 117 Q88 113 93 116" fill="none" stroke="#2a1506" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M116 117 Q112 113 107 116" fill="none" stroke="#2a1506" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M100 124 L94 134 L106 134 Z" fill="#ff7a9c" stroke="#2a1506" stroke-width="4" stroke-linejoin="round"/>' +
    '<g stroke="#2a1506" stroke-width="3.5" stroke-linecap="round">' +
    '<path d="M58 124 L34 118"/><path d="M56 132 L32 132"/><path d="M58 140 L36 146"/>' +
    '<path d="M142 124 L166 118"/><path d="M144 132 L168 132"/><path d="M142 140 L164 146"/>' +
    '</g>' +
    '<ellipse cx="56" cy="140" rx="9" ry="5.5" fill="#ffb7a0" opacity=".7"/>' +
    '<ellipse cx="144" cy="140" rx="9" ry="5.5" fill="#ffb7a0" opacity=".7"/>' +
    '<path d="M86 146 Q100 156 114 146" fill="none" stroke="#2a1506" stroke-width="4" stroke-linecap="round"/>' +
    '</svg>';

  var FAVICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><g stroke="#241305" stroke-width="12" stroke-linejoin="round"><path d="M58 78 L40 20 L100 50 Z" fill="#ffa94d"/><path d="M142 78 L160 20 L100 50 Z" fill="#ffa94d"/><ellipse cx="100" cy="118" rx="60" ry="56" fill="#ffa94d"/><path d="M66 74 L60 42 L97 56 Z" fill="#ffcf9f"/><path d="M134 74 L140 42 L103 56 Z" fill="#ffcf9f"/></g><ellipse cx="73" cy="106" rx="9" ry="11" fill="#2a1506"/><ellipse cx="127" cy="106" rx="9" ry="11" fill="#2a1506"/><ellipse cx="76" cy="102" rx="3" ry="3.5" fill="#fff"/><ellipse cx="130" cy="102" rx="3" ry="3.5" fill="#fff"/><path d="M100 124 L93 136 L107 136 Z" fill="#ff7a9c" stroke="#2a1506" stroke-width="6" stroke-linejoin="round"/><g stroke="#2a1506" stroke-width="5" stroke-linecap="round"><path d="M58 126 L32 120"/><path d="M54 138 L30 140"/><path d="M142 126 L168 120"/><path d="M146 138 L170 140"/></g></svg>'
  );

  /* ---- som: gatilhos próprios sintetizados (WebAudio) ---- */
  var AC = null;
  function ac() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (AC && AC.state === 'suspended') { try { AC.resume(); } catch (e) {} }
    return AC;
  }
  function note(f0, t0, dur, type, vol, f1) {
    var c = ac(); if (!c) return;
    var t = c.currentTime + t0;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  var ON = localStorage.getItem('gato_sfx') !== '0';
  var SFX = {
    spin: function () { note(300, 0, .06, 'square', .10, 620); note(420, .09, .06, 'square', .10, 720); note(560, .18, .07, 'square', .10, 900); },
    win:  function () { [523, 659, 784, 1047].forEach(function (f, i) { note(f, i * .09, .22, 'triangle', .22); }); note(1568, .4, .3, 'sine', .16); },
    coin: function () { note(988, 0, .08, 'sine', .22); note(1319, .08, .16, 'sine', .22); },
    build:function () { note(160, 0, .12, 'square', .22); note(740, .06, .18, 'triangle', .18); },
    cat:  function () { note(260, 0, .5, 'sine', .18, 540); note(300, .12, .4, 'sine', .14, 760); },
    err:  function () { note(130, 0, .22, 'square', .2); note(98, .05, .18, 'square', .14); }
  };

  function pion() { sndBtn.textContent = ON ? '🔊' : '🔇'; }
  var sndBtn = null;
  function sndOnClick() { ON = !ON; try { localStorage.setItem('gato_sfx', ON ? '1' : '0'); } catch (e) {} pion(); }
  function addSndBtn() {
    if (document.getElementById('sndBtn')) return;
    sndBtn = document.createElement('button');
    sndBtn.id = 'sndBtn'; sndBtn.title = 'Som';
    sndBtn.onclick = sndOnClick;
    pion();
    document.body.appendChild(sndBtn);
  }

  window.__snd = function (name) {
    if (!ON) return;
    var f = SFX[name]; if (f) { try { f(); } catch (e) {} }
  };

  function fav() {
    var l = document.querySelector('link[rel="icon"]');
    if (!l) { l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); }
    l.href = FAVICON;
  }

  function aplicar() {
    fav();
    [].slice.call(document.querySelectorAll('.mascote')).forEach(function (m) { m.innerHTML = CATSVG; });
    var h = document.querySelector('header h1');
    if (h) {
      var cat = h.querySelector('.cat');
      var logo = '<span class="catsvg">' + CATSVG + '</span>';
      if (cat) cat.outerHTML = logo;
      else h.insertAdjacentHTML('afterbegin', logo + ' ');
    }
    addSndBtn();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', aplicar);
  else aplicar();
})();