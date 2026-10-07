'use strict';
// Índice carta -> mazos y consultas por carta (buscador). Se construye una sola vez al cargar o actualizar los
// datos: después, buscar una carta cuesta ~1 ms en vez de recorrer los ~39.000 mazos. Cada carta guarda un
// Int32Array con las posiciones de los mazos que la llevan (4 bytes por entrada, ~15 MB en total).
const { BASICS, recordFilter } = require('./stats');

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

module.exports = { buildCardIndex, suggestCards, cardReport };
