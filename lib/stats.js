'use strict';
const { parseDeck, commanderKey } = require('./parse');
const { podsFrom } = require('./rating');

// En cEDH se juega en mesas de 4: el winrate «de azar puro» de un jugador es 25 %. Se muestra como dato de
// referencia, pero las comparaciones usan la media real del meta (metaWinRate), que ya incluye los empates:
// con ~20 % de empates un mazo medio gana ~20 %, no 25 %, y frente al 25 % casi todo saldría «negativo».
const BASELINE = 0.25;

// Modo «solo partidas con ganador»: las partidas empatadas se sacan del denominador
// (winrate = victorias / (victorias + derrotas)). Sin empates, la referencia natural es el 25 % (en tus
// datos sale 25,7 %) y los comandantes con muchos empates dejan de salir penalizados. Se aplica a los
// registros y todo lo demás funciona igual; `allGames` conserva las partidas totales para la tasa de empates.
function decisive(records) {
  const out = [];
  for (const r of records) {
    const games = r.wins + r.losses;
    if (games > 0) out.push({ ...r, games, allGames: r.games });
  }
  return out;
}

// Para matchups y matriz en el modo «solo partidas con ganador»: se conservan solo los asientos de mesas con
// ganador y con todos los comandantes conocidos. Una mesa con ganador aparece completa en el asiento del
// ganador; los asientos perdedores se reconocen porque existe esa misma mesa (torneo + comandantes) con ganador.
// Los asientos con rivales desconocidos se descartan siempre: si no, se descartarían más derrotas que victorias.
function decisiveSeats(records) {
  const keyOf = (tid, c) => tid + '|' + [...c].sort().join('¦');
  const ok = new Set(podsFrom(records).map(p => keyOf(p.tid, p.c)));
  return records.map(r => ({
    ...r,
    seats: (r.seats || []).filter(s => (s.n === 3 || s.n === 4) && s.o.length === s.n - 1 && (s.w === 1 || ok.has(keyOf(r.tid, [r.key, ...s.o])))),
  }));
}

// Winrate medio de todos los mazos (victorias / partidas, ponderado por partidas jugadas).
function metaWinRate(records) {
  let w = 0, g = 0;
  for (const r of records) { w += r.wins; g += r.games; }
  return g ? w / g : BASELINE;
}

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

// ---------- Torneos que no son cEDH ----------
// El formato «EDH» de TopDeck incluye también torneos casuales, de precons, de presupuesto o brawl. Se detectan
// por el CONTENIDO de los mazos, no por el nombre: en un torneo cEDH la mediana de cartas «típicas de cEDH»
// por mazo es de 20 o más; en los casuales es de 0 a 6 (y así se cazan también los que no lo dicen en el nombre).
const CEDH_STAPLES = new Set(['Mana Crypt', 'Mox Diamond', 'Chrome Mox', 'Mox Opal', 'Lotus Petal', 'Jeweled Lotus', 'Force of Will',
  'Fierce Guardianship', 'Deflecting Swat', 'Mental Misstep', 'Mystical Tutor', 'Vampiric Tutor', 'Imperial Seal', 'Demonic Tutor', 'Gamble',
  'Underworld Breach', 'Ad Nauseam', "Thassa's Oracle", 'Demonic Consultation', 'Tainted Pact', 'Rhystic Study', 'Mystic Remora', 'Cyclonic Rift',
  'Flusterstorm', 'Pact of Negation', 'Swan Song', 'Opposition Agent', 'Dockside Extortionist', 'Ancient Tomb', 'Mana Vault', 'Grim Monolith',
  'Basalt Monolith', "Gaea's Cradle", "Bolas's Citadel", 'Necropotence', 'Survival of the Fittest', 'Food Chain', 'Intuition', 'Windfall',
  'Underground Sea', 'Volcanic Island', 'Tropical Island', 'Scrubland', 'Badlands', 'Bayou', 'Tundra', 'Savannah', 'Taiga', 'Plateau',
  'Misty Rainforest', 'Polluted Delta', 'Scalding Tarn', 'Flooded Strand', 'Verdant Catacombs', 'Arid Mesa', 'Marsh Flats', 'Wooded Foothills',
  'Bloodstained Mire', 'Windswept Heath']);
const CASUAL_NAME = /pauper|duel|1v1|casual|precon|budget|kitchen|jank|battlebox|cube|oathbreaker|pdh|tiny|low power|beginner|newbie/i;

// Marca cada registro con `comp` (true = torneo cEDH, false = no lo parece). Se recalcula al cargar o actualizar.
function classifyTournaments(records, { minMedian = 8, minDecks = 5 } = {}) {
  const by = new Map();
  for (const r of records) {
    let n = 0;
    for (const c of r.cards) if (CEDH_STAPLES.has(c)) n++;
    const e = by.get(r.tid) || { name: r.tournament, counts: [] };
    e.counts.push(n);
    by.set(r.tid, e);
  }
  const verdict = new Map();
  for (const [tid, e] of by) {
    // Con pocos mazos la mediana no es fiable: se decide solo por el nombre
    if (e.counts.length < minDecks) { verdict.set(tid, !CASUAL_NAME.test(e.name || '')); continue; }
    e.counts.sort((a, b) => a - b);
    verdict.set(tid, e.counts[e.counts.length >> 1] >= minMedian);
  }
  for (const r of records) r.comp = verdict.get(r.tid);
  return records;
}

// Filtra por número de jugadores del torneo (ambos límites incluidos y opcionales)
// y por antigüedad (`days`: solo torneos de los últimos N días).
function recordFilter({ minPlayers, maxPlayers, days, onlyCedh } = {}) {
  const since = days ? Math.floor(Date.now() / 1000) - days * 86400 : 0;
  return r => (!minPlayers || r.size >= minPlayers) && (!maxPlayers || r.size <= maxPlayers) && r.date >= since && (!onlyCedh || r.comp !== false);
}
function filterRecords(records, opts = {}) {
  if (!opts.minPlayers && !opts.maxPlayers && !opts.days && !opts.onlyCedh) return records;
  return records.filter(recordFilter(opts));
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
    const e = by.get(r.key) || { commander: r.key, decks: 0, games: 0, wins: 0, draws: 0, all: 0 };
    e.decks++; e.games += r.games; e.wins += r.wins; e.draws += r.draws; e.all += r.allGames ?? r.games;
    by.set(r.key, e);
  }
  const total = records.length || 1;
  return [...by.values()]
    .filter(e => e.decks >= minDecks)
    .map(e => ({
      ...e,
      metaShare: e.decks / total,
      winRate: e.wins / e.games,
      drawRate: e.draws / e.all,
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
    draws: sum(mine, r => r.draws), drawRate: sum(mine, r => r.draws) / sum(mine, r => r.allGames ?? r.games),
    winRate: wins / games,
    ci: wilson(wins, games),
    baseline: metaWinRate(records), // media del meta con los mismos filtros
    chance: BASELINE,
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
    start: now - (i + 1) * B, end: now - i * B, total: 0, decks: 0, games: 0, wins: 0, draws: 0, allWins: 0, allGames: 0 }));
  for (const r of records) { const b = buckets[idx(r)]; b.total++; b.allWins += r.wins; b.allGames += r.games; }
  for (const r of mine) { const b = buckets[idx(r)]; b.decks++; b.games += r.games; b.wins += r.wins; b.draws += r.draws; }
  const series = buckets.reverse().filter(b => b.total).map(b => ({
    start: b.start, end: b.end, decks: b.decks, games: b.games,
    metaShare: b.decks / b.total,
    meta: b.allGames ? b.allWins / b.allGames : null, // winrate medio de todos los mazos en ese periodo
    // Con menos de 10 mazos el winrate no dice nada (periodos de los bordes del histórico): se omite.
    winRate: b.decks >= 10 ? b.wins / b.games : null,
    ci: b.decks >= 10 ? wilson(b.wins, b.games) : null,
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
  return { commander: key, bucketDays, baseline: metaWinRate(records), chance: BASELINE, series, rising, falling, recentDecks: recent.length, priorDecks: prior.length };
}


// ---------- Variantes (k-means sobre las cartas que varían entre mazos) ----------
function variantsReport(records, key, { k = 3, deckCards = null } = {}) {
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
      j, decks: ids.length, share: ids.length / mine.length, games, wins, winRate: wins / games,
      drawRate: sum(rs, r => r.draws) / sum(rs, r => r.allGames ?? r.games), ci: wilson(wins, games), signature: sig,
    });
  }
  variants.sort((a, b) => b.decks - a.decks);

  // Con una lista concreta: ¿a qué variante se parece más (centroide más cercano)?, ¿cuántas de sus cartas típicas
  // lleva?, ¿qué cartas típicas le faltan? y ¿cuáles de las suyas casi no juega esa variante?
  let yours = null;
  if (deckCards && variants.length) {
    const lc = new Set([...deckCards].map(n => n.toLowerCase()));
    const v = Float32Array.from(feats, c => lc.has(c.toLowerCase()) ? 1 : 0);
    let best = variants[0], bd = Infinity;
    for (const vr of variants) { const d = dist(v, cents[vr.j]); if (d < bd) { bd = d; best = vr; } }
    const c = cents[best.j];
    const typical = feats.map((card, f) => ({ card, inVariant: c[f], has: v[f] === 1 })).filter(x => x.inVariant >= 0.5);
    yours = {
      index: variants.indexOf(best),
      typical: { have: typical.filter(x => x.has).length, total: typical.length },
      missing: typical.filter(x => !x.has).sort((a, b) => b.inVariant - a.inVariant).slice(0, 10),
      extra: feats.map((card, f) => ({ card, inVariant: c[f], has: v[f] === 1 })).filter(x => x.has && x.inVariant <= 0.1)
        .sort((a, b) => a.inVariant - b.inVariant).slice(0, 10),
    };
  }
  return { commander: key, decks: mine.length, k, features: feats.length, variants, baseline: metaWinRate(records),
    winRate: sum(mine, r => r.wins) / sum(mine, r => r.games), yours };
}

// ---------- Validación con datos pasados ----------
// ¿Se mantienen las conclusiones? Se parte el histórico por la mitad en el tiempo: se calculan las cartas
// con la mitad antigua y se comprueba si su efecto tiene el mismo signo en la mitad reciente (datos que
// el cálculo no ha visto). Azar puro sería un 50 %. Se desglosa por el nivel de fiabilidad de cada carta,
// así se ve si «alta» acierta más que «media» y «baja».
function validationReport(records, { minDecks = 120, minWith = 15 } = {}) {
  if (records.length < 2 * minDecks) return null;
  let lo = Infinity, hi = -Infinity;
  for (const r of records) { if (r.date < lo) lo = r.date; if (r.date > hi) hi = r.date; }
  const mid = (lo + hi) / 2;
  const train = records.filter(r => r.date < mid), test = records.filter(r => r.date >= mid);
  const count = rs => { const m = new Map(); for (const r of rs) m.set(r.key, (m.get(r.key) || 0) + 1); return m; };
  const ca = count(train), cb = count(test);
  const levels = { alta: { n: 0, ok: 0 }, media: { n: 0, ok: 0 }, baja: { n: 0, ok: 0 } };
  let commanders = 0;
  for (const [key, n] of ca) {
    if (n < minDecks || (cb.get(key) || 0) < minDecks) continue;
    const a = commanderReport(train, key, { minWith, minWithout: minWith });
    const b = commanderReport(test, key, { minWith, minWithout: minWith });
    const later = new Map(b.popular.filter(c => c.lift != null).map(c => [c.card, c.lift]));
    commanders++;
    for (const c of a.popular) {
      const l = later.get(c.card);
      if (c.lift == null || l == null || !c.lift || !l) continue;
      const lv = levels[c.q < 0.05 ? 'alta' : c.q < 0.25 ? 'media' : 'baja'];
      lv.n++; if (Math.sign(c.lift) === Math.sign(l)) lv.ok++;
    }
  }
  const rows = Object.entries(levels).map(([level, v]) => ({ level, cards: v.n, holds: v.ok, rate: v.n ? v.ok / v.n : null }));
  const total = rows.reduce((s2, r) => s2 + r.cards, 0), ok = rows.reduce((s2, r) => s2 + r.holds, 0);
  return { commanders, splitDate: mid * 1000, trainDays: Math.round((mid - lo) / 86400), testDays: Math.round((hi - mid) / 86400),
    rows, overall: total ? ok / total : null, cards: total };
}

const BASICS = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
  'snow-covered plains', 'snow-covered island', 'snow-covered swamp', 'snow-covered mountain', 'snow-covered forest']);


// ---------- Mi lista ----------
// Las recomendaciones salen de lo que juegan las listas REALES MÁS PARECIDAS a la tuya ("pares"), no del winrate
// asociado a cada carta: ese winrate refleja sobre todo quién juega la carta y con qué plan (lo comprobamos con
// cambios reales de lista de los mismos jugadores y no se cumple), así que daba consejos absurdos desde el
// juego (revisar Force of Will o Rhystic Study, "tech" que casi nadie juega). Un consejo debe ser coherente
// con el plan de tu lista: completar lo que casi todas las listas parecidas llevan y señalar lo poco habitual.

// Mazos del comandante ordenados por parecido (Jaccard sobre cartas, sin tierras básicas) con la lista dada.
function similarDecks(mine, deckCards) {
  const you = new Map();
  for (const n of deckCards) if (!BASICS.has(n.toLowerCase())) you.set(n.toLowerCase(), n);
  const scored = mine.map(r => {
    let inter = 0, size = 0;
    for (const c of r.cards) { const l = c.toLowerCase(); if (BASICS.has(l)) continue; size++; if (you.has(l)) inter++; }
    return { r, inter, sim: inter / (size + you.size - inter) };
  }).sort((a, b) => b.sim - a.sim);
  return { you, scored };
}

// Listas reales más parecidas a la tuya, con el torneo y el récord que sacaron. Sin nombres de jugadores.
// Las listas idénticas cuentan una vez.
function neighborsReport(records, key, deckCards, { top = 5 } = {}) {
  const mine = records.filter(r => r.key === key);
  if (!mine.length) return [];
  const { you, scored } = similarDecks(mine, deckCards);
  if (you.size < 10) return [];
  const out = [], seen = new Set();
  for (const x of scored) {
    const sig = [...x.r.cards].filter(c => !BASICS.has(c.toLowerCase())).sort().join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    const theirs = new Set([...x.r.cards].map(c => c.toLowerCase()));
    out.push({
      similarity: x.sim, shared: x.inter, tournament: x.r.tournament, size: x.r.size,
      date: new Date(x.r.date * 1000).toISOString().slice(0, 10),
      record: `${x.r.wins}-${x.r.losses}-${x.r.draws}`,
      onlyThem: [...x.r.cards].filter(c => !BASICS.has(c.toLowerCase()) && !you.has(c.toLowerCase())).slice(0, 12),
      onlyYou: [...you].filter(([l]) => !theirs.has(l)).map(([, n]) => n).slice(0, 12),
    });
    if (out.length >= top) break;
  }
  return out;
}

// Informe de la lista:
//  - missing: cartas que juegan al menos la mitad de las listas parecidas y tú no llevas
//  - options: cartas que juega entre el 20 y el 50 % de las listas parecidas (alternativas habituales)
//  - unusual: cartas tuyas que casi ninguna lista parecida juega (puede ser a propósito; no es un defecto)
function myListReport(records, key, deckCards, { minWith = 5 } = {}) {
  const rep = commanderReport(records, key, { minWith, minWithout: minWith });
  if (!rep) return null;
  const mine = records.filter(r => r.key === key);
  const { you, scored } = similarDecks(mine, deckCards);
  // "Pares": las listas más parecidas, entre 30 y 200 (alrededor del 10 % de los mazos del comandante)
  const K = Math.min(scored.length, Math.max(30, Math.min(200, Math.round(mine.length * 0.1))));
  const peers = scored.slice(0, K);
  const peerCount = new Map();
  for (const x of peers) for (const c of x.r.cards) peerCount.set(c, (peerCount.get(c) || 0) + 1);
  const peerPct = c => (peerCount.get(c) || 0) / (peers.length || 1);

  const byName = new Map(rep.popular.map(c => [c.card.toLowerCase(), c]));
  const inList = [], unknown = [];
  for (const name of deckCards) {
    if (BASICS.has(name.toLowerCase())) continue;
    const c = byName.get(name.toLowerCase());
    if (c) inList.push({ ...c, peer: peerPct(c.card) }); else unknown.push(name);
  }
  const have = new Set(inList.map(c => c.card.toLowerCase()));
  const others = rep.popular.filter(c => !have.has(c.card.toLowerCase()) && !BASICS.has(c.card.toLowerCase()))
    .map(c => ({ ...c, peer: peerPct(c.card) }));
  return {
    commander: key, decks: rep.decks, winRate: rep.winRate,
    cards: inList.length,
    peers: { n: peers.length, similarity: peers.length ? peers.reduce((s, x) => s + x.sim, 0) / peers.length : 0 },
    // tabla completa de la lista y perfil: cuánto se parece al meta (estándar) y cuánto se aleja (tech)
    all: [...inList].sort((a, b) => b.peer - a.peer || b.inclusion - a.inclusion),
    profile: {
      standard: inList.filter(c => c.inclusion >= 0.4).length,
      common: inList.filter(c => c.inclusion >= 0.1 && c.inclusion < 0.4).length,
      tech: inList.filter(c => c.inclusion >= 0.02 && c.inclusion < 0.1).length,
      rare: inList.filter(c => c.inclusion < 0.02).length,
    },
    unknown, // cartas que ningún mazo de este comandante ha jugado en el periodo
    missing: others.filter(c => c.peer >= 0.5).sort((a, b) => b.peer - a.peer || b.inclusion - a.inclusion).slice(0, 25),
    options: others.filter(c => c.peer >= 0.2 && c.peer < 0.5).sort((a, b) => b.peer - a.peer).slice(0, 25),
    unusual: inList.filter(c => c.peer < 0.05).sort((a, b) => a.peer - b.peer || a.inclusion - b.inclusion).slice(0, 25),
  };
}

// ---------- Paquetes y alternativas ----------
// Qué cartas se juegan juntas y cuáles se excluyen entre sí DENTRO de un comandante (asociación de uso, sin
// mirar el resultado: el winrate de pares no se sostenía y daba sinergias absurdas).
//  - juntas: si llevas A, es mucho más probable que lleves B (combos, paquetes de plan)
//  - alternativas: casi nunca van en el mismo mazo aunque cada una es habitual (se sustituyen entre sí)
// Medida: coeficiente phi (correlación entre "lleva A" y "lleva B"), con soporte mínimo para no fiarse de rarezas.
function packagesReport(records, key, { minSupport = 30, maxCards = 160, top = 12 } = {}) {
  const mine = records.filter(r => r.key === key);
  const N = mine.length;
  if (N < 100) return { commander: key, decks: N, together: [], alternatives: [], tooFew: true };
  const cnt = new Map();
  for (const r of mine) for (const c of r.cards) cnt.set(c, (cnt.get(c) || 0) + 1);
  // Solo cartas con uso intermedio: las que casi todos o casi nadie juegan no dicen nada sobre paquetes
  const names = [...cnt].filter(([c, n]) => !BASICS.has(c.toLowerCase()) && n / N >= 0.10 && n / N <= 0.90 && n >= minSupport)
    .sort((a, b) => Math.abs(a[1] / N - .5) - Math.abs(b[1] / N - .5)).slice(0, maxCards).map(([c]) => c);
  const pos = new Map(names.map((c, i) => [c, i]));
  const has = names.map(() => new Uint8Array(N)), decksOf = names.map(() => []);
  mine.forEach((r, d) => { for (const c of r.cards) { const i = pos.get(c); if (i != null) { has[i][d] = 1; decksOf[i].push(d); } } });
  const together = [], alternatives = [];
  for (let a = 0; a < names.length; a++) {
    for (let b = a + 1; b < names.length; b++) {
      const nA = decksOf[a].length, nB = decksOf[b].length;
      let n11 = 0;
      for (const d of decksOf[a]) if (has[b][d]) n11++;
      const phi = (n11 * N - nA * nB) / Math.sqrt(nA * nB * (N - nA) * (N - nB));
      const expected = nA * nB / N;
      const item = {
        a: names[a], b: names[b], decks: n11, phi,
        withA: n11 / nA,                       // P(lleva B | lleva A)
        withoutA: (nB - n11) / (N - nA),       // P(lleva B | no lleva A)
        pA: nA / N, pB: nB / N,
      };
      if (phi >= 0.35 && n11 >= minSupport) together.push(item);
      else if (phi <= -0.25 && expected >= minSupport) alternatives.push(item);
    }
  }
  together.sort((x, y) => y.phi - x.phi);
  alternatives.sort((x, y) => x.phi - y.phi);
  return { commander: key, decks: N, tested: names.length, together: together.slice(0, top), alternatives: alternatives.slice(0, top) };
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
  buildRecords, filterRecords, commanderList, classifyTournaments, neighborsReport, commanderReport, metaWinRate, decisive, decisiveSeats, validationReport, myListReport, packagesReport, trendReport, variantsReport, matchups, matrix, cardsVsOpponent,
  wilson, twoPropZ, BASELINE, CEDH_STAPLES, BASICS, recordFilter,
};
