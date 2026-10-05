'use strict';
const { parseDeck, commanderKey } = require('./parse');

// En cEDH se juega en mesas de 4: el winrate "neutro" de un jugador es 25 %.
const BASELINE = 0.25;

function wilson(wins, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = wins / n;
  const d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

// z de dos proporciones (con y sin la carta). Devuelve 0 si no hay datos suficientes.
function twoPropZ(w1, n1, w2, n2) {
  if (!n1 || !n2) return 0;
  const p = (w1 + w2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se ? (w1 / n1 - w2 / n2) / se : 0;
}

// Convierte torneos de la API en un registro por mazo:
// { key, tid, date, games, wins, draws, losses, cards:Set, seats:[{w, n, o:[comandantes rivales]}] }
// Cada "seat" es una mesa jugada: w=1 si ganó, n=jugadores en la mesa, o=comandantes de los demás.
function buildRecords(tournaments) {
  const records = [];
  for (const t of tournaments) {
    const byId = new Map();
    const local = [];
    for (const p of t.standings || []) {
      const deck = parseDeck(p);
      if (!deck) continue;
      const key = commanderKey(p, deck);
      if (!key) continue;
      const wins = p.wins || 0, draws = p.draws || 0, losses = p.losses || 0;
      const games = wins + draws + losses;
      if (!games) continue;
      const rec = {
        key, tid: t.TID, tournament: t.tournamentName, date: t.startDate,
        size: (t.standings || []).length, // jugadores del torneo, para filtrar por tamaño
        player: p.name, games, wins, draws, losses,
        cards: new Set(deck.cards.keys()), seats: [],
      };
      if (p.id != null) byId.set(String(p.id), rec);
      local.push(rec);
    }

    for (const round of t.rounds || []) {
      for (const table of round.tables || []) {
        if (table.table === 'Byes' || table.status !== 'Completed') continue;
        const players = table.players || [];
        // Solo mesas de 3-4 jugadores: el resto (1v1, byes) no tiene sentido como pod de cEDH.
        if (players.length < 3 || players.length > 4) continue;
        // Mesa sin ganador (null) = sin terminar; "Draw" = empate (nadie gana).
        if (table.winner_id == null) continue;
        const seated = players.map(pl => byId.get(String(pl.id)));
        seated.forEach((rec, i) => {
          if (!rec) return;
          const opps = seated.filter((o, j) => j !== i && o).map(o => o.key);
          rec.seats.push({ w: String(players[i].id) === String(table.winner_id) ? 1 : 0, n: players.length, o: opps });
        });
      }
    }
    records.push(...local);
  }
  return records;
}

// Filtra por número de jugadores del torneo (ambos límites incluidos y opcionales)
// y por antigüedad (`days`: solo torneos de los últimos N días).
function filterRecords(records, { minPlayers, maxPlayers, days } = {}) {
  if (!minPlayers && !maxPlayers && !days) return records;
  const since = days ? Math.floor(Date.now() / 1000) - days * 86400 : 0;
  return records.filter(r => (!minPlayers || r.size >= minPlayers) && (!maxPlayers || r.size <= maxPlayers) && r.date >= since);
}

// p-valor bilateral de un z (normal), con la aproximación de Abramowitz-Stegun para erfc.
function pValue(z) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return Math.min(1, poly * Math.exp(-x * x));
}

// Corrige por comparaciones múltiples (Benjamini-Hochberg): q = proporción esperada de falsos
// positivos si se aceptaran todas las cartas hasta esa. Modifica `items[i].q` en sitio.
function addQ(items) {
  const order = items.map((c, i) => [pValue(c.z), i]).sort((a, b) => a[0] - b[0]);
  let prev = 1;
  for (let k = order.length - 1; k >= 0; k--) {
    prev = Math.min(prev, order[k][0] * order.length / (k + 1));
    items[order[k][1]].q = prev;
  }
}

// Encogimiento (empirical Bayes): la diferencia observada se acerca a 0 tanto más cuanto mayor es su
// error típico frente a la dispersión real entre cartas. Así una carta en 6 mazos con +30 pp no
// supera a otra en 200 mazos con +5 pp. Añade `adj` a cada carta.
function addShrunk(items) {
  if (!items.length) return;
  const mean = items.reduce((s, c) => s + c.lift, 0) / items.length;
  const varLift = items.reduce((s, c) => s + (c.lift - mean) ** 2, 0) / items.length;
  const meanSe2 = items.reduce((s, c) => s + c.se ** 2, 0) / items.length;
  const tau2 = Math.max(1e-6, varLift - meanSe2);
  for (const c of items) c.adj = c.lift * tau2 / (tau2 + c.se ** 2);
}

function commanderList(records, minDecks = 3) {
  const by = new Map();
  for (const r of records) {
    const e = by.get(r.key) || { commander: r.key, decks: 0, games: 0, wins: 0, draws: 0 };
    e.decks++; e.games += r.games; e.wins += r.wins; e.draws += r.draws;
    by.set(r.key, e);
  }
  const total = records.length || 1;
  return [...by.values()]
    .filter(e => e.decks >= minDecks)
    .map(e => ({
      ...e,
      metaShare: e.decks / total,
      winRate: e.wins / e.games,
      drawRate: e.draws / e.games,
      ci: wilson(e.wins, e.games),
    }))
    .sort((a, b) => b.decks - a.decks);
}

function commanderReport(records, key, { minWith = 5, minWithout = 5 } = {}) {
  const mine = records.filter(r => r.key === key);
  if (!mine.length) return null;
  const games = mine.reduce((s, r) => s + r.games, 0);
  const wins = mine.reduce((s, r) => s + r.wins, 0);

  // Contadores por carta en una sola pasada
  const per = new Map();
  for (const r of mine) {
    for (const c of r.cards) {
      const e = per.get(c) || { decks: 0, games: 0, wins: 0 };
      e.decks++; e.games += r.games; e.wins += r.wins;
      per.set(c, e);
    }
  }

  const cards = [];
  for (const [card, e] of per) {
    const decksWithout = mine.length - e.decks;
    const gamesWithout = games - e.games;
    const winsWithout = wins - e.wins;
    const base = {
      card, decks: e.decks, inclusion: e.decks / mine.length,
      winRateWith: e.wins / e.games,
    };
    if (e.decks < minWith || decksWithout < minWithout) {
      cards.push({ ...base, lift: null, z: null, core: decksWithout < minWithout });
      continue;
    }
    const wrWithout = winsWithout / gamesWithout;
    const pool = (e.wins + winsWithout) / (e.games + gamesWithout);
    cards.push({
      ...base,
      winRateWithout: wrWithout,
      lift: base.winRateWith - wrWithout,
      z: twoPropZ(e.wins, e.games, winsWithout, gamesWithout),
      se: Math.sqrt(pool * (1 - pool) * (1 / e.games + 1 / gamesWithout)),
      core: false,
    });
  }

  const scored = cards.filter(c => c.lift !== null);
  addShrunk(scored);
  addQ(scored);
  return {
    commander: key,
    decks: mine.length,
    games, wins,
    draws: sum(mine, r => r.draws), drawRate: sum(mine, r => r.draws) / games,
    winRate: wins / games,
    ci: wilson(wins, games),
    baseline: BASELINE,
    tournaments: new Set(mine.map(r => r.tid)).size,
    // Ordenadas por la diferencia ajustada (encogida), no por la bruta: evita premiar muestras pequeñas.
    best: scored.filter(c => c.adj > 0).sort((a, b) => b.adj - a.adj),
    worst: scored.filter(c => c.adj < 0).sort((a, b) => a.adj - b.adj),
    core: cards.filter(c => c.core).sort((a, b) => b.inclusion - a.inclusion),
    popular: [...cards].sort((a, b) => b.inclusion - a.inclusion),
  };
}

// ---------- Evolución en el tiempo ----------
// Cubos de `bucketDays` días hacia atrás desde hoy. Usa todos los registros recibidos (el filtro
// de periodo del servidor no se aplica aquí: la gracia es ver la tendencia completa).
function trendReport(records, key, { bucketDays = 30 } = {}) {
  const mine = records.filter(r => r.key === key);
  if (!mine.length) return null;
  const now = Math.floor(Date.now() / 1000), B = bucketDays * 86400;
  const idx = r => Math.max(0, Math.floor((now - r.date) / B));
  const nb = Math.max(...records.map(idx)) + 1;
  const buckets = Array.from({ length: nb }, (_, i) => ({
    start: now - (i + 1) * B, end: now - i * B, total: 0, decks: 0, games: 0, wins: 0, draws: 0 }));
  for (const r of records) buckets[idx(r)].total++;
  for (const r of mine) { const b = buckets[idx(r)]; b.decks++; b.games += r.games; b.wins += r.wins; b.draws += r.draws; }
  const series = buckets.reverse().filter(b => b.total).map(b => ({
    start: b.start, end: b.end, decks: b.decks, games: b.games,
    metaShare: b.decks / b.total,
    winRate: b.games ? b.wins / b.games : null,
    ci: b.games ? wilson(b.wins, b.games) : null,
  }));

  // Cartas en ascenso o descenso: inclusión en el último periodo frente a todos los anteriores.
  const recent = mine.filter(r => idx(r) === 0), prior = mine.filter(r => idx(r) > 0);
  let rising = [], falling = [];
  if (recent.length >= 15 && prior.length >= 15) {
    const count = rs => { const m = new Map(); for (const r of rs) for (const c of r.cards) m.set(c, (m.get(c) || 0) + 1); return m; };
    const a = count(recent), b = count(prior);
    const diffs = [];
    for (const c of new Set([...a.keys(), ...b.keys()])) {
      if (BASICS.has(c.toLowerCase())) continue;
      const na = a.get(c) || 0, nb2 = b.get(c) || 0;
      if (na + nb2 < 8) continue;
      diffs.push({ card: c, recent: na / recent.length, prior: nb2 / prior.length, diff: na / recent.length - nb2 / prior.length,
        z: twoPropZ(na, recent.length, nb2, prior.length) });
    }
    rising = diffs.filter(d => d.diff > 0 && d.z > 2).sort((x, y) => y.diff - x.diff).slice(0, 10);
    falling = diffs.filter(d => d.diff < 0 && d.z < -2).sort((x, y) => x.diff - y.diff).slice(0, 10);
  }
  return { commander: key, bucketDays, baseline: BASELINE, series, rising, falling, recentDecks: recent.length, priorDecks: prior.length };
}

// ---------- Sinergias entre pares de cartas ----------
// Diferencia de diferencias: (con ambas − solo A) − (solo B − ninguna). Si es 0, las cartas
// aportan por separado y sin interacción; positivo = juntas rinden más de lo que suman (sinergia);
// negativo = se estorban o son redundantes. Las 4 celdas piden un mínimo de mazos.
function synergyReport(records, key, { minCell = 8, maxCards = 120, top = 15 } = {}) {
  const mine = records.filter(r => r.key === key);
  if (mine.length < 4 * minCell) return { commander: key, decks: mine.length, positive: [], negative: [], tested: 0 };
  const cnt = new Map();
  for (const r of mine) for (const c of r.cards) cnt.set(c, (cnt.get(c) || 0) + 1);
  // Solo cartas con inclusión intermedia: las que casi todos o casi nadie juegan no dejan celdas.
  const names = [...cnt].filter(([c, n]) => !BASICS.has(c.toLowerCase()) && n >= minCell && mine.length - n >= minCell)
    .sort((a, b) => Math.abs(a[1] / mine.length - .5) - Math.abs(b[1] / mine.length - .5))
    .slice(0, maxCards).map(([c]) => c);
  const pos = new Map(names.map((c, i) => [c, i]));
  const has = names.map(() => new Uint8Array(mine.length));
  const decksOf = names.map(() => []);
  mine.forEach((r, d) => { for (const c of r.cards) { const i = pos.get(c); if (i != null) { has[i][d] = 1; decksOf[i].push(d); } } });
  const G = mine.map(r => r.games), W = mine.map(r => r.wins);
  const tot = { n: mine.length, g: sum(G, x => x), w: sum(W, x => x) };
  const one = names.map((_, i) => ({ n: decksOf[i].length, g: sum(decksOf[i], d => G[d]), w: sum(decksOf[i], d => W[d]) }));
  const out = [];
  for (let a = 0; a < names.length; a++) {
    for (let b = a + 1; b < names.length; b++) {
      let n = 0, g = 0, w = 0;
      for (const d of decksOf[a]) if (has[b][d]) { n++; g += G[d]; w += W[d]; }
      const both = { n, g, w };
      const onlyA = { n: one[a].n - n, g: one[a].g - g, w: one[a].w - w };
      const onlyB = { n: one[b].n - n, g: one[b].g - g, w: one[b].w - w };
      const none = { n: tot.n - one[a].n - one[b].n + n, g: tot.g - one[a].g - one[b].g + g, w: tot.w - one[a].w - one[b].w + w };
      if (Math.min(both.n, onlyA.n, onlyB.n, none.n) < minCell) continue;
      const p = x => x.w / x.g, v = x => p(x) * (1 - p(x)) / x.g;
      const did = (p(both) - p(onlyA)) - (p(onlyB) - p(none));
      const se = Math.sqrt(v(both) + v(onlyA) + v(onlyB) + v(none));
      if (!se) continue;
      out.push({ a: names[a], b: names[b], decks: both.n, winRateBoth: p(both), synergy: did, z: did / se });
    }
  }
  addQ(out);
  const positive = out.filter(x => x.synergy > 0).sort((x, y) => y.z - x.z).slice(0, top);
  const negative = out.filter(x => x.synergy < 0).sort((x, y) => x.z - y.z).slice(0, top);
  return { commander: key, decks: mine.length, tested: out.length, positive, negative };
}

// ---------- Variantes (k-means sobre las cartas que varían entre mazos) ----------
function variantsReport(records, key, { k = 3 } = {}) {
  const mine = records.filter(r => r.key === key);
  k = Math.min(5, Math.max(2, k));
  if (mine.length < 40) return { commander: key, decks: mine.length, variants: [], tooFew: true };
  const cnt = new Map();
  for (const r of mine) for (const c of r.cards) cnt.set(c, (cnt.get(c) || 0) + 1);
  const feats = [...cnt].filter(([c, n]) => !BASICS.has(c.toLowerCase()) && n / mine.length >= 0.08 && n / mine.length <= 0.92)
    .sort((a, b) => Math.abs(a[1] - mine.length / 2) - Math.abs(b[1] - mine.length / 2)).slice(0, 250).map(([c]) => c);
  if (feats.length < 5) return { commander: key, decks: mine.length, variants: [], tooFew: true };
  const X = mine.map(r => Float32Array.from(feats, c => r.cards.has(c) ? 1 : 0));
  const dist = (x, c) => { let s = 0; for (let i = 0; i < x.length; i++) { const d = x[i] - c[i]; s += d * d; } return s; };
  // Inicio determinista: primer mazo y después el más lejano a los ya elegidos.
  const cents = [Float32Array.from(X[0])];
  while (cents.length < k) {
    let best = -1, bd = -1;
    X.forEach((x, i) => { const d = Math.min(...cents.map(c => dist(x, c))); if (d > bd) { bd = d; best = i; } });
    cents.push(Float32Array.from(X[best]));
  }
  let assign = new Array(X.length).fill(-1);
  for (let it = 0; it < 20; it++) {
    let moved = false;
    X.forEach((x, i) => {
      let bj = 0, bd = Infinity;
      cents.forEach((c, j) => { const d = dist(x, c); if (d < bd) { bd = d; bj = j; } });
      if (assign[i] !== bj) { assign[i] = bj; moved = true; }
    });
    if (!moved) break;
    cents.forEach((c, j) => {
      const members = X.filter((_, i) => assign[i] === j);
      if (!members.length) return;
      for (let f = 0; f < c.length; f++) c[f] = members.reduce((s, x) => s + x[f], 0) / members.length;
    });
  }
  const variants = [];
  for (let j = 0; j < k; j++) {
    const ids = assign.map((a, i) => a === j ? i : -1).filter(i => i >= 0);
    if (ids.length < 8) continue;
    const rs = ids.map(i => mine[i]), rest = mine.length - ids.length;
    const games = sum(rs, r => r.games), wins = sum(rs, r => r.wins);
    const sig = feats.map((c, f) => {
      const inC = ids.reduce((s, i) => s + X[i][f], 0) / ids.length;
      const inAll = cnt.get(c);
      const inRest = rest ? (inAll - inC * ids.length) / rest : 0;
      return { card: c, inVariant: inC, inRest, diff: inC - inRest };
    }).filter(x => x.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 8);
    variants.push({
      decks: ids.length, share: ids.length / mine.length, games, wins, winRate: wins / games,
      drawRate: sum(rs, r => r.draws) / games, ci: wilson(wins, games), signature: sig,
    });
  }
  variants.sort((a, b) => b.decks - a.decks);
  return { commander: key, decks: mine.length, k, features: feats.length, variants,
    winRate: sum(mine, r => r.wins) / sum(mine, r => r.games) };
}

// ---------- Mi lista ----------
const BASICS = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
  'snow-covered plains', 'snow-covered island', 'snow-covered swamp', 'snow-covered mountain', 'snow-covered forest']);

// Compara una lista (Set de nombres) con lo que juega el meta para ese comandante:
//  - review: cartas tuyas con diferencia ajustada negativa o que casi nadie juega
//  - missing: cartas muy jugadas que no llevas
//  - tech: cartas con diferencia ajustada positiva y fiable (q bajo) que no llevas
function myListReport(records, key, deckCards, { minWith = 5 } = {}) {
  const rep = commanderReport(records, key, { minWith, minWithout: minWith });
  if (!rep) return null;
  const byName = new Map(rep.popular.map(c => [c.card.toLowerCase(), c]));
  const mine = [], unknown = [];
  for (const name of deckCards) {
    if (BASICS.has(name.toLowerCase())) continue;
    const c = byName.get(name.toLowerCase());
    if (c) mine.push(c); else unknown.push(name);
  }
  const have = new Set(mine.map(c => c.card));
  const others = rep.popular.filter(c => !have.has(c.card) && !BASICS.has(c.card.toLowerCase()));
  return {
    commander: key, decks: rep.decks, winRate: rep.winRate,
    cards: mine.length,
    unknown, // cartas que ningún mazo de este comandante ha jugado en el periodo
    review: mine.filter(c => (c.adj != null && c.adj < 0 && c.q < 0.5) || c.inclusion < 0.05)
      .sort((a, b) => (a.adj ?? 0) - (b.adj ?? 0)),
    missing: others.filter(c => c.inclusion >= 0.4).sort((a, b) => b.inclusion - a.inclusion).slice(0, 25),
    tech: others.filter(c => c.adj > 0 && c.q < 0.25 && c.inclusion < 0.4).sort((a, b) => b.adj - a.adj).slice(0, 25),
  };
}

// ---------- Matchups (nivel mesa) ----------
// Unidad de análisis: un asiento = un mazo jugando una mesa. Gana 1 de cada 4.
// Aviso: los asientos de una misma mesa no son independientes (solo gana uno) y los de un mismo
// mazo tampoco, así que z y los IC son orientativos; sirven para ordenar, no como prueba.

function seatsOf(records, key) {
  const out = [];
  for (const r of records) {
    if (r.key !== key || !r.seats) continue;
    for (const s of r.seats) out.push({ w: s.w, n: s.n, o: s.o, cards: r.cards });
  }
  return out;
}

const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

// Rendimiento de `key` cuando cada otro comandante del meta está en su mesa,
// comparado con el rendimiento de `key` en las mesas donde ese comandante NO está.
function matchups(records, key, { minPods = 15 } = {}) {
  const seats = seatsOf(records, key);
  if (!seats.length) return null;
  const total = { n: seats.length, w: sum(seats, s => s.w) };
  const exp = sum(seats, s => 1 / s.n);
  const by = new Map();
  for (const s of seats) {
    for (const opp of new Set(s.o)) {
      if (opp === key) continue; // espejo: no se analiza aquí
      const e = by.get(opp) || { pods: 0, wins: 0 };
      e.pods++; e.wins += s.w;
      by.set(opp, e);
    }
  }
  const rows = [];
  for (const [opponent, e] of by) {
    const without = { n: total.n - e.pods, w: total.w - e.wins };
    if (e.pods < minPods || without.n < minPods) continue;
    const wr = e.wins / e.pods, wrWithout = without.w / without.n;
    rows.push({
      opponent, pods: e.pods, wins: e.wins, winRate: wr, ci: wilson(e.wins, e.pods),
      winRateWithout: wrWithout, lift: wr - wrWithout, z: twoPropZ(e.wins, e.pods, without.w, without.n),
    });
  }
  return {
    commander: key, seats: total.n, wins: total.w, winRate: total.w / total.n,
    expected: exp / total.n, // normalmente 0.25
    rows: rows.sort((a, b) => b.pods - a.pods),
  };
}

// Matriz de los `top` comandantes más jugados: celda [A][B] = winrate de A en mesas donde está B.
function matrix(records, top = 12, minDecks = 5) {
  const list = commanderList(records, minDecks).slice(0, top);
  const keys = list.map(c => c.commander);
  const inSet = new Set(keys);
  const cells = {}, overall = {};
  for (const k of keys) { cells[k] = {}; overall[k] = { seats: 0, wins: 0 }; }
  for (const r of records) {
    if (!inSet.has(r.key) || !r.seats) continue;
    for (const s of r.seats) {
      overall[r.key].seats++; overall[r.key].wins += s.w;
      for (const opp of new Set(s.o)) {
        if (opp === r.key || !inSet.has(opp)) continue;
        const c = cells[r.key][opp] || (cells[r.key][opp] = { pods: 0, wins: 0 });
        c.pods++; c.wins += s.w;
      }
    }
  }
  return { commanders: keys, cells, overall };
}

// Cartas de `key` que rinden mejor/peor en mesas donde está `vs`.
// Se compara con/sin la carta DENTRO de esas mesas y se muestra también el efecto general
// de la carta (en todas las mesas) para distinguir "buena en general" de "buena contra este rival".
function cardsVsOpponent(records, key, vs, { minWith = 15 } = {}) {
  const all = seatsOf(records, key);
  if (!all.length) return null;
  const vsSeats = all.filter(s => s.o.includes(vs));
  const wAll = sum(all, s => s.w), wVs = sum(vsSeats, s => s.w);

  const count = (arr) => {
    const m = new Map();
    for (const s of arr) for (const c of s.cards) {
      const e = m.get(c) || { n: 0, w: 0 };
      e.n++; e.w += s.w; m.set(c, e);
    }
    return m;
  };
  const cAll = count(all), cVs = count(vsSeats);

  const rows = [];
  for (const [card, e] of cVs) {
    const withoutN = vsSeats.length - e.n;
    if (e.n < minWith || withoutN < minWith) continue;
    const wrWith = e.w / e.n, wrWithout = (wVs - e.w) / withoutN;
    const g = cAll.get(card);
    const gWithout = all.length - g.n;
    const generalLift = gWithout > 0 ? g.w / g.n - (wAll - g.w) / gWithout : null;
    rows.push({
      card, seatsWith: e.n, inclusion: e.n / vsSeats.length,
      winRateWith: wrWith, winRateWithout: wrWithout, lift: wrWith - wrWithout,
      z: twoPropZ(e.w, e.n, vsSeats.length ? wVs - e.w : 0, withoutN),
      generalLift,
      excess: generalLift == null ? null : (wrWith - wrWithout) - generalLift,
    });
  }
  return {
    commander: key, opponent: vs, pods: vsSeats.length, wins: wVs,
    winRate: vsSeats.length ? wVs / vsSeats.length : null,
    best: rows.filter(r => r.z > 0).sort((a, b) => b.z - a.z),
    worst: rows.filter(r => r.z < 0).sort((a, b) => a.z - b.z),
  };
}

module.exports = {
  buildRecords, filterRecords, commanderList, commanderReport, myListReport, trendReport, synergyReport, variantsReport, matchups, matrix, cardsVsOpponent,
  wilson, twoPropZ, BASELINE,
};
