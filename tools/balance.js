'use strict';

// Ferramenta de balanceamento (spec seção 46).
// Simula o MOTOR REAL (roll + computeWin + villaDef + enemyLoot) para calcular:
//   - custo total de cada vila
//   - ganho médio por giro (EV)
//   - giros necessários para completar a vila
//   - previsão de tempo (50 giros/dia ≈ jogador casual)
// Rode:  node tools/balance.js

const gato = require('../gato.js');
const CFG = gato.CFG;

const N_SPINS = 400000;

function simuladorVila(n) {
  const vdef = gato.villaDef(n);
  const custoTotal = vdef.buildings.reduce(
    (acc, b) => acc + b.base * CFG.tierMult.reduce((s, t) => s + t, 0), 0);
  const mesa = gato.stakePara(n);

  let gross = 0, spins = 0, raids = 0, triAttacks = 0, cats = 0, wins = 0, shield = 0;
  for (let i = 0; i < N_SPINS; i++) {
    const r = gato.roll();
    const res = gato.computeWin(r, mesa);
    spins++;
    if (res.kind === 'pair' || res.kind === 'all') { gross += res.win; wins++; }
    if (res.kind === 'raid') raids++;
    if (res.kind === 'attack') triAttacks++;
    if (res.kind === 'cat' && res.single === false) cats++;
    if (res.kind === 'shield') shield += res.guard || 0;
  }

  const grossMedio = gross / spins;
  const netoMedio = grossMedio - mesa;
  const pRaid = raids / spins;
  const pAtq = triAttacks / spins;

  // saque médio (comportamento real: loot 0.3..0.7 do prêmio base float(mesa*8))
  const raidMedio = (() => {
    let s = 0;
    for (let k = 0; k < 1000; k++) {
      const loot = 0.3 + 0.4 * Math.random();
      s += Math.max(10, Math.round(loot * mesa * CFG.raidPrizeMult));
    }
    return s / 1000;
  })();
  const ataqueMedio = gato.enemyLoot(Math.min(2000, n + 1)) * CFG.enemyStealPct;
  const ganhoEsperadoGiro =
    netoMedio + pRaid * raidMedio + pAtq * ataqueMedio;

  const girosNecessarios = custoTotal / Math.max(0.5, ganhoEsperadoGiro);
  return {
    vila: n, mundo: vdef.world, custoTotal: Math.round(custoTotal), mesa,
    grossMedio: +grossMedio.toFixed(2), netoMedio: +netoMedio.toFixed(2),
    pRaid: (pRaid * 100).toFixed(2) + '%',
    ganhoEsperadoGiro: +ganhoEsperadoGiro.toFixed(2),
    girosNecessarios: Math.round(girosNecessarios),
    diasCasual: Math.round(girosNecessarios / 50)
  };
}

const alvos = [1, 5, 10, 25, 50, 100, 200, 500, 1000, 1500, 2000];
console.log('=== BALANCEAMENTO GATINHO (motor real, ' + N_SPINS.toLocaleString() + ' giros/vila) ===\n');
console.log('vila | mundo          | aposta | custo vila | EV bruto/giro | EV líquido/giro | giros p/ vila | dias (50/dia)');
console.log('-----+----------------+--------+------------+---------------+-----------------+---------------+--------------');
for (const n of alvos) {
  const s = simuladorVila(n);
  console.log(
    String(s.vila).padStart(4) + ' | ' +
    s.mundo.padEnd(14) + ' | ' +
    String(s.mesa).padStart(6) + ' | ' +
    String(s.custoTotal).padStart(10) + ' | ' +
    String(s.grossMedio).padStart(13) + ' | ' +
    String(s.ganhoEsperadoGiro).padStart(15) + ' | ' +
    String(s.girosNecessarios).padStart(13) + ' | ' +
    String(s.diasCasual).padStart(8)
  );
}
console.log('\n* EV líquido = giro (ganho bruto − aposta) + saques P(' + simuladorVila(1).pRaid + ') + ataques.');
console.log('Design: custos crescem ' + (CFG.villageCostGrowth * 100) + '%/vila; aposta cresce ' + (CFG.betGrowth * 100) + '%/vila');
console.log('→ tempo médio por vila fica ~constante (progressão controlada, limite 2000).\n');