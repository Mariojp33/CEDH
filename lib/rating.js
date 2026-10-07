'use strict';
// Fuerza de cada comandante con el modelo de Luce (Plackett-Luce para "gana uno entre varios").
//
// En una mesa con asientos i = 1..n, la probabilidad de que gane el asiento i es
//     P(gana i) = s_i / (s_1 + ... + s_n)
// donde s_c es la "fuerza" del comandante c. Las fuerzas se estiman a la vez con todas las mesas, así que
// el resultado ya descuenta contra quién se sentó cada comandante (el winrate simple no puede hacerlo).
//
// Ajuste: máxima verosimilitud con un prior Gamma(alpha, alpha) (media 1) mediante el algoritmo MM de
// Hunter (2004), que converge siempre. El prior acerca a 1 a los comandantes con pocas mesas.
// Incertidumbre: remuestreo (bootstrap) de torneos enteros, porque las mesas de un mismo torneo no son
// independientes (mismo meta, mismos jugadores).

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reconstruye las mesas a partir de los asientos guardados en cada mazo: cada mesa con ganador aparece
// exactamente una vez, en el asiento del ganador (w = 1). Solo valen mesas de 3-4 jugadores con todos los
// comandantes conocidos. Las mesas empatadas (sin ganador) quedan fuera, como debe ser.
// Resultado: { tid, date, c: [comandante ganador, ...rivales] }.
function podsFrom(records) {
  const pods = [];
  for (const r of records) {
    for (const s of r.seats || []) {
      if (s.w === 1 && (s.n === 3 || s.n === 4) && s.o.length === s.n - 1) pods.push({ tid: r.tid, date: r.date, c: [r.key, ...s.o] });
    }
  }
  return pods;
}

// Ajusta las fuerzas. Devuelve { names, s (Float64Array), apps, wins }.
function fitLuce(pods, { alpha = 2, maxIter = 500, tol = 1e-8, init = null } = {}) {
  const idx = new Map(), names = [];
  const id = k => { let i = idx.get(k); if (i === undefined) { i = names.length; idx.set(k, i); names.push(k); } return i; };
  const start = new Int32Array(pods.length + 1), mem = [];
  pods.forEach((p, i) => { start[i] = mem.length; for (const c of p.c) mem.push(id(c)); });
  start[pods.length] = mem.length;
  const M = Int32Array.from(mem), n = names.length;
  const wins = new Float64Array(n), apps = new Float64Array(n);
  for (let i = 0; i < pods.length; i++) {
    wins[M[start[i]]]++; // el primero de cada mesa es el ganador
    for (let j = start[i]; j < start[i + 1]; j++) apps[M[j]]++;
  }
  const s = new Float64Array(n).fill(1);
  if (init) names.forEach((nm, i) => { const v = init.get(nm); if (v) s[i] = v; });
  const D = new Float64Array(n);
  for (let it = 0; it < maxIter; it++) {
    D.fill(0);
    for (let i = 0; i < pods.length; i++) {
      let den = 0;
      for (let j = start[i]; j < start[i + 1]; j++) den += s[M[j]];
      const inv = 1 / den;
      for (let j = start[i]; j < start[i + 1]; j++) D[M[j]] += inv;
    }
    let change = 0;
    for (let c = 0; c < n; c++) {
      const ns = (wins[c] + alpha - 1) / (D[c] + alpha);
      change = Math.max(change, Math.abs(ns / s[c] - 1));
      s[c] = ns;
    }
    // La escala es arbitraria: se fija para que la media geométrica ponderada por mesas jugadas sea 1.
    let num = 0, den = 0;
    for (let c = 0; c < n; c++) { num += apps[c] * Math.log(s[c]); den += apps[c]; }
    const g = Math.exp(num / den);
    for (let c = 0; c < n; c++) s[c] /= g;
    if (change < tol) break;
  }
  return { names, s, apps, wins, idx, M, start, pods: pods.length };
}

// Winrate esperado de cada comandante en una mesa "típica": se sientan 3 rivales sacados al azar de los
// asientos reales del periodo. Como las mesas empatadas están excluidas, la referencia exacta es el 25 %.
function expectedWinRates(fit, { samples = 1500, seed = 7 } = {}) {
  const rnd = rng(seed), { M, s } = fit, n = fit.names.length;
  const T = new Float64Array(samples);
  for (let k = 0; k < samples; k++) {
    T[k] = s[M[(rnd() * M.length) | 0]] + s[M[(rnd() * M.length) | 0]] + s[M[(rnd() * M.length) | 0]];
  }
  const out = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    let acc = 0;
    for (let k = 0; k < samples; k++) acc += s[c] / (s[c] + T[k]);
    out[c] = acc / samples;
  }
  return out;
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

// Informe por comandante: fuerza, winrate esperado en mesa típica e intervalo (bootstrap por torneos).
function strengthReport(records, { boot = 30, minApps = 15, seed = 1 } = {}) {
  const pods = podsFrom(records);
  if (pods.length < 200) return null;
  const fit = fitLuce(pods);
  const exp = expectedWinRates(fit);
  const rnd = rng(seed);
  const byT = new Map();
  for (const p of pods) (byT.get(p.tid) || byT.set(p.tid, []).get(p.tid)).push(p);
  const tids = [...byT.keys()];
  const init = new Map(fit.names.map((nm, i) => [nm, fit.s[i]]));
  const samples = fit.names.map(() => []);
  for (let b = 0; b < boot; b++) {
    const re = [];
    for (let i = 0; i < tids.length; i++) re.push(...byT.get(tids[(rnd() * tids.length) | 0]));
    const f = fitLuce(re, { init, maxIter: 80, tol: 1e-6 });
    const e = expectedWinRates(f, { samples: 600, seed: 100 + b });
    f.names.forEach((nm, i) => { const j = fit.idx.get(nm); if (j !== undefined) samples[j].push(e[i]); });
  }
  const rows = [];
  fit.names.forEach((commander, i) => {
    if (fit.apps[i] < minApps) return;
    const sm = samples[i].sort((a, b) => a - b);
    rows.push({
      commander, pods: fit.apps[i], wins: fit.wins[i], strength: fit.s[i], winRate: exp[i],
      ci: sm.length >= 10 ? [quantile(sm, 0.025), quantile(sm, 0.975)] : null,
    });
  });
  rows.sort((a, b) => b.pods - a.pods);
  return { pods: pods.length, tournaments: tids.length, boot, reference: 0.25, rows };
}

// ¿Predice el modelo mesas que no ha visto? Se ajusta con la mitad antigua y se evalúa en la reciente:
// log-pérdida media (menor es mejor) y acierto del favorito, frente a dos referencias:
//  - azar: todos los asientos igual de probables
//  - winrate directo: probabilidad proporcional al winrate histórico (encogido) de cada comandante
function luceValidation(records) {
  const pods = podsFrom(records);
  if (pods.length < 400) return null;
  let lo = Infinity, hi = -Infinity;
  for (const p of pods) { if (p.date < lo) lo = p.date; if (p.date > hi) hi = p.date; }
  const mid = (lo + hi) / 2;
  const train = pods.filter(p => p.date < mid), test = pods.filter(p => p.date >= mid);
  if (train.length < 200 || test.length < 200) return null;
  const fit = fitLuce(train);
  const K = 10, naive = new Map();
  fit.names.forEach((nm, i) => naive.set(nm, (fit.wins[i] + 0.25 * K) / (fit.apps[i] + K)));
  const luce = new Map(fit.names.map((nm, i) => [nm, fit.s[i]]));
  const score = (weights) => {
    let ll = 0, hit = 0;
    for (const p of test) {
      const w = p.c.map(weights);
      const tot = w.reduce((a, b) => a + b, 0);
      ll -= Math.log(w[0] / tot);
      // acierto: el favorito (mayor peso) es el ganador; en empate de pesos se reparte por igual
      const max = Math.max(...w), ties = w.filter(x => x === max).length;
      if (w[0] === max) hit += 1 / ties;
    }
    return { logLoss: ll / test.length, top1: hit / test.length };
  };
  return {
    trainPods: train.length, testPods: test.length,
    uniform: score(() => 1),
    winrate: score(c => naive.get(c) ?? 0.25),
    luce: score(c => luce.get(c) ?? 1),
  };
}

module.exports = { rng, podsFrom, fitLuce, expectedWinRates, strengthReport, luceValidation };
