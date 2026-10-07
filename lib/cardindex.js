'use strict';
// Índice carta -> mazos y consultas por carta (buscador). Se construye una sola vez al cargar o actualizar los
// datos: después, buscar una carta cuesta ~1 ms en vez de recorrer los ~39.000 mazos. Cada carta guarda un
// Int32Array con las posiciones de los mazos que la llevan (4 bytes por entrada, ~15 MB en total).
const { BASICS, recordFilter, twoPropZ } = require('./stats');

const DAY = 86400, BUCKET = 30 * DAY;

function buildCardIndex(records) {
  const count = new Map();
  for (const r of records) for (const c of r.cards) count.set(c, (count.get(c) || 0) + 1);
  const ids = new Map(), names = [], decks = [];
  for (const [c, n] of count) { ids.set(c.toLowerCase(), names.length); names.push(c); decks.push(new Int32Array(n)); }
  const fill = new Int32Array(names.length);
  records.forEach((r, i) => { for (const c of r.cards) { const j = ids.get(c.toLowerCase()); decks[j][fill[j]++] = i; } });
  return { ids, names, decks, size: records.length };
}

// Misma construcción, pero cediendo el turno cada pocos miles de mazos: en un servidor lento (Render gratis) un
// índice de ~0,5 s en un ordenador normal bloquearía ~8 s, y así las demás peticiones pueden atenderse entre medias.
async function buildCardIndexAsync(records, chunk = 2500) {
  const tick = () => new Promise(r => setImmediate(r));
  const count = new Map();
  for (let i = 0; i < records.length; i += chunk) {
    for (const r of records.slice(i, i + chunk)) for (const c of r.cards) count.set(c, (count.get(c) || 0) + 1);
    await tick();
  }
  const ids = new Map(), names = [], decks = [];
  for (const [c, n] of count) { ids.set(c.toLowerCase(), names.length); names.push(c); decks.push(new Int32Array(n)); }
  const fill = new Int32Array(names.length);
  for (let i = 0; i < records.length; i += chunk) {
    const end = Math.min(records.length, i + chunk);
    for (let k = i; k < end; k++) for (const c of records[k].cards) { const j = ids.get(c.toLowerCase()); decks[j][fill[j]++] = k; }
    await tick();
  }
  return { ids, names, decks, size: records.length };
}

// Sugerencias para el buscador: las que empiezan por el texto primero, después las que lo contienen; dentro de
// cada grupo, las más jugadas antes. Las tierras básicas no interesan.
function suggestCards(index, q, limit = 10) {
  const t = String(q || '').trim().toLowerCase();
  if (t.length < 2) return [];
  const starts = [], has = [];
  index.names.forEach((n, i) => {
    const l = n.toLowerCase();
    if (BASICS.has(l)) return;
    const k = l.indexOf(t);
    if (k === 0) starts.push(i); else if (k > 0) has.push(i);
  });
  const byUse = (a, b) => index.decks[b].length - index.decks[a].length;
  return starts.sort(byUse).concat(has.sort(byUse)).slice(0, limit)
    .map(i => ({ card: index.names[i], decks: index.decks[i].length }));
}

// Informe de una carta: en qué comandantes se juega, cómo evoluciona su uso y con qué cartas suele ir.
// `records` son los registros sobre los que se construyó el índice (mismas posiciones).
function cardReport(index, records, name, { minPlayers, maxPlayers, days } = {}) {
  const id = index.ids.get(String(name || '').trim().toLowerCase());
  if (id === undefined) return null;
  const card = index.names[id], list = index.decks[id];
  const passSize = recordFilter({ minPlayers, maxPlayers });       // para la evolución: todo el histórico
  const pass = recordFilter({ minPlayers, maxPlayers, days });     // para el resto: el periodo elegido
  const now = Math.floor(Date.now() / 1000);
  const bucketOf = r => Math.max(0, Math.floor((now - r.date) / BUCKET));
  const NB = 6;

  // Totales (todos los mazos) por comandante y por periodo de 30 días
  const totalBy = new Map(), totalBucket = new Array(NB).fill(0);
  const inPeriod = new Uint8Array(records.length); // 1 = el mazo entra en el periodo y filtros elegidos
  let total = 0, dataStart = Infinity;
  records.forEach((r, i) => {
    if (r.date < dataStart) dataStart = r.date;
    if (passSize(r)) { const b = bucketOf(r); if (b < NB) totalBucket[b]++; }
    if (pass(r)) { inPeriod[i] = 1; total++; totalBy.set(r.key, (totalBy.get(r.key) || 0) + 1); }
  });

  const withBy = new Map(), withBucket = new Array(NB).fill(0);
  let withCount = 0, first = Infinity;
  const mine = [];
  for (const i of list) {
    const r = records[i];
    if (!passSize(r)) continue;
    if (r.date < first) first = r.date;
    const b = bucketOf(r); if (b < NB) withBucket[b]++;
    if (inPeriod[i]) { withCount++; withBy.set(r.key, (withBy.get(r.key) || 0) + 1); mine.push(i); }
  }

  const commanders = [...withBy].filter(([, n]) => n >= 3)
    .map(([commander, n]) => ({ commander, decks: n, of: totalBy.get(commander) || 0, share: n / (totalBy.get(commander) || 1) }))
    .sort((a, b) => b.decks - a.decks).slice(0, 60);

  // Cartas que suelen acompañarla: se compara su frecuencia en los mazos que la llevan con la general
  // Con cartas que casi todos llevan (decenas de miles de mazos) basta una muestra regular de 4.000 mazos:
  // el error es de ±1,5 puntos y el coste pasa de ~100 ms a ~15 ms.
  const step = Math.max(1, Math.ceil(mine.length / 4000)), sample = mine.filter((_, k) => k % step === 0);
  const co = new Map();
  for (const i of sample) for (const c of records[i].cards) co.set(c, (co.get(c) || 0) + 1);
  const together = [];
  for (const [c, n] of co) {
    const pWith = n / (sample.length || 1);
    if (c === card || BASICS.has(c.toLowerCase()) || pWith < 0.25 || n < 5) continue;
    const idc = index.ids.get(c.toLowerCase());
    let all = 0; for (const j of index.decks[idc]) all += inPeriod[j];
    together.push({ card: c, withCard: pWith, overall: all / (total || 1), lift: pWith - all / (total || 1) });
  }
  together.sort((a, b) => b.lift - a.lift);

  // Evolución: del periodo más antiguo al más reciente
  const trend = []; // fechas en milisegundos, como firstSeen
  for (let b = NB - 1; b >= 0; b--) {
    trend.push({ start: (now - (b + 1) * BUCKET) * 1000, end: (now - b * BUCKET) * 1000, decks: withBucket[b], total: totalBucket[b], share: totalBucket[b] ? withBucket[b] / totalBucket[b] : null });
  }
  return {
    card, decks: withCount, total, share: total ? withCount / total : 0,
    firstSeen: first === Infinity ? null : first * 1000,
    dataStart: dataStart === Infinity ? null : dataStart * 1000,
    commanders, together: together.slice(0, 12), trend,
  };
}

// Novedades del meta: cartas que entran o salen de las listas. Se compara el uso del último mes con el de los dos
// meses anteriores sobre el total de mazos de cada periodo, con una prueba estadística (z de dos proporciones) y un
// mínimo de cambio, para que no cuente el ruido. Solo describe uso, no si la carta "funciona".
function noveltiesReport(index, records, { minPlayers, maxPlayers, recentDays = 30, baseDays = 60, top = 25 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const passSize = recordFilter({ minPlayers, maxPlayers });
  const kind = new Uint8Array(records.length);          // 1 = periodo reciente, 2 = periodo base
  let nR = 0, nB = 0, dataStart = Infinity;
  records.forEach((r, i) => {
    if (r.date < dataStart) dataStart = r.date;
    if (!passSize(r)) return;
    const age = (now - r.date) / DAY;
    if (age <= recentDays) { kind[i] = 1; nR++; } else if (age <= recentDays + baseDays) { kind[i] = 2; nB++; }
  });
  if (nR < 100 || nB < 100) return { recentDecks: nR, baseDecks: nB, tooFew: true, rising: [], falling: [], fresh: [] };

  const rows = [];
  index.names.forEach((card, id) => {
    const list = index.decks[id];
    if (list.length < 30 || BASICS.has(card.toLowerCase())) return;
    let cR = 0, cB = 0, first = Infinity;
    for (const i of list) { const k = kind[i]; if (k === 1) cR++; else if (k === 2) cB++; if (records[i].date < first) first = records[i].date; }
    if (cR + cB < 15) return;
    const sR = cR / nR, sB = cB / nB;
    rows.push({ card, id, recent: sR, base: sB, change: sR - sB, z: twoPropZ(cR, nR, cB, nB), decksRecent: cR, first });
  });
  // Dónde se juega: los comandantes que más la llevan en el último mes
  const where = id => {
    const by = new Map();
    for (const i of index.decks[id]) if (kind[i] === 1) by.set(records[i].key, (by.get(records[i].key) || 0) + 1);
    return [...by].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([commander, decks]) => ({ commander, decks }));
  };
  const pack = r => ({ card: r.card, recent: r.recent, base: r.base, change: r.change, decksRecent: r.decksRecent, commanders: where(r.id) });
  const fresh = rows.filter(r => r.first - dataStart > 30 * DAY && r.decksRecent >= 15).sort((a, b) => b.decksRecent - a.decksRecent);
  const freshSet = new Set(fresh.map(r => r.card));
  const rising = rows.filter(r => !freshSet.has(r.card) && r.change >= 0.02 && r.z >= 3 && r.decksRecent >= 15).sort((a, b) => b.change - a.change);
  const falling = rows.filter(r => r.change <= -0.02 && r.z <= -3).sort((a, b) => a.change - b.change);
  return {
    recentDays, baseDays, recentDecks: nR, baseDecks: nB,
    fresh: fresh.slice(0, top).map(r => ({ ...pack(r), firstSeen: r.first * 1000 })),
    rising: rising.slice(0, top).map(pack), falling: falling.slice(0, top).map(pack),
  };
}

// Alternativas: dentro de un comandante, qué cartas llevan más los mazos que NO juegan la carta que los que sí.
// Para que sean sustitutos y no "otro plan de juego" (los mazos sin Force of Will suelen ser los de otro combo),
// solo se comparan los mazos sin la carta que, por lo demás, se parecen a los que la llevan. Es asociación de uso,
// no una prueba de que una sustituya a la otra.
function alternativesReport(index, records, name, commander, { minPlayers, maxPlayers, days, minGroup = 20, minSimilar = 40, top = 12 } = {}) {
  const id = index.ids.get(String(name || '').trim().toLowerCase());
  if (id === undefined || !commander) return null;
  const pass = recordFilter({ minPlayers, maxPlayers, days });
  const card = index.names[id];
  const has = new Uint8Array(records.length);
  for (const i of index.decks[id]) has[i] = 1;
  const withIdx = [], withoutIdx = [];
  records.forEach((r, i) => { if (r.key === commander && pass(r)) (has[i] ? withIdx : withoutIdx).push(i); });
  const base = { card, commander, withCard: withIdx.length, withoutCard: withoutIdx.length };
  if (withIdx.length < minGroup || withoutIdx.length < minGroup) return { ...base, alternatives: [], tooFew: true };

  // Perfil de los mazos que la llevan: su núcleo (cartas que juega al menos la mitad). Un mazo sin la carta se
  // considera parecido si cubre ese núcleo tanto como el cuarto inferior de los que sí la llevan.
  const pWith = new Map();
  for (const i of withIdx) for (const c of records[i].cards) pWith.set(c, (pWith.get(c) || 0) + 1);
  for (const [c, n] of pWith) pWith.set(c, n / withIdx.length);
  const core = [...pWith].filter(([c, p]) => p >= 0.5 && c !== card && !BASICS.has(c.toLowerCase())).map(([c]) => c);
  const coverage = i => { let n = 0; for (const c of core) if (records[i].cards.has(c)) n++; return core.length ? n / core.length : 0; };
  const cw = withIdx.map(coverage).sort((a, b) => a - b);
  const threshold = cw[Math.floor(cw.length * 0.25)];
  const similar = withoutIdx.filter(i => coverage(i) >= threshold);
  if (similar.length < minSimilar) return { ...base, similar: similar.length, alternatives: [], tooFew: true };

  const cnt = new Map();
  for (const i of similar) for (const c of records[i].cards) cnt.set(c, (cnt.get(c) || 0) + 1);
  const out = [];
  for (const [c, n] of cnt) {
    if (c === card || BASICS.has(c.toLowerCase())) continue;
    const pOut = n / similar.length, pIn = pWith.get(c) || 0;
    if (pOut >= 0.15 && pOut - pIn >= 0.15) out.push({ card: c, withoutCard: pOut, withCard: pIn, diff: pOut - pIn });
  }
  out.sort((a, b) => b.diff - a.diff);
  return { ...base, similar: similar.length, alternatives: out.slice(0, top) };
}

module.exports = { buildCardIndex, buildCardIndexAsync, suggestCards, cardReport, noveltiesReport, alternativesReport };
