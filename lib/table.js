'use strict';
// Preparar una mesa: tu comandante y hasta tres rivales esperados. Para cada rival, cómo le ha ido a tu comandante
// en las mesas donde estaba (frente a las mesas donde no estaba) y qué cartas juegan sus mazos. Es histórico, no una
// predicción: las mesas del mismo torneo no son independientes y cambiar de rival cambia también a quién más se sienta.
const { seatsOf, twoPropZ, commanderReport, BASICS } = require('./stats');

const rate = a => a.n ? a.w / a.n : null;
const tally = list => ({ n: list.length, w: list.reduce((s, x) => s + x.w, 0) });

function compare(seats, pred, minPods) {
  const a = tally(seats.filter(pred)), b = tally(seats.filter(s => !pred(s)));
  const enough = a.n >= minPods && b.n >= minPods;
  return {
    pods: a.n, winRate: rate(a), winRateWithout: rate(b), podsWithout: b.n, enough,
    lift: a.n && b.n ? rate(a) - rate(b) : null,
    z: enough ? twoPropZ(a.w, a.n, b.w, b.n) : null,
  };
}

// seatRecords: mazos con los asientos ya preparados (solo mesas válidas); view: mazos para las cartas.
function tableReport(seatRecords, view, me, rivals, { minPods = 15, cardsPerRival = 14, metaShare = null } = {}) {
  const seats = seatsOf(seatRecords, me);
  if (!seats.length) return null;
  const list = [...new Set(rivals.filter(Boolean))].slice(0, 3);
  const total = tally(seats);

  const rows = list.map(rival => ({ rival, ...compare(seats, s => s.o.includes(rival), minPods) }));
  // Con varios rivales: mesas donde está alguno de ellos, y mesas donde están todos a la vez
  const any = list.length >= 2 ? compare(seats, s => list.some(r => s.o.includes(r)), minPods) : null;
  const all = list.length >= 2 ? compare(seats, s => list.every(r => s.o.includes(r)), minPods) : null;

  // Qué juegan los rivales. Lo informativo no es lo que juega todo el meta (Sol Ring, Command Tower…) sino lo que
  // distingue a cada rival: cartas que lleva mucho más que el meta en general.
  const reps = list.map(rival => ({ rival, rep: commanderReport(view, rival, { minWith: 5, minWithout: 5 }) }));
  // Frecuencia de cada carta en todo el meta: con el índice de cartas (instantáneo) o, sin él, contando mazos
  let meta;
  if (metaShare) meta = { get: c => metaShare(c) };
  else {
    const cand = new Set();
    for (const { rep } of reps) if (rep) for (const c of rep.popular) if (c.inclusion >= 0.5 && !BASICS.has(c.card.toLowerCase())) cand.add(c.card);
    const cnt = new Map([...cand].map(c => [c, 0]));
    for (const r of view) for (const c of cand) if (r.cards.has(c)) cnt.set(c, cnt.get(c) + 1);
    meta = { get: c => (cnt.get(c) || 0) / (view.length || 1) };
  }

  const cards = reps.map(({ rival, rep }) => {
    if (!rep) return { rival, decks: 0, distinctive: [], top: [], byCard: new Map() };
    const pool = rep.popular.filter(c => !BASICS.has(c.card.toLowerCase()));
    return {
      rival, decks: rep.decks,
      distinctive: pool.filter(c => c.inclusion >= 0.5 && c.inclusion - meta.get(c.card) >= 0.2)
        .sort((a, b) => (b.inclusion - meta.get(b.card)) - (a.inclusion - meta.get(a.card)))
        .slice(0, cardsPerRival).map(c => ({ card: c.card, inclusion: c.inclusion, meta: meta.get(c.card) })),
      top: pool.slice(0, cardsPerRival).map(c => ({ card: c.card, inclusion: c.inclusion })),
      byCard: new Map(pool.map(c => [c.card, c.inclusion])),
    };
  });
  // Cartas que verás casi seguro: las que lleva el 60 % o más de los mazos de dos o más rivales y NO juega todo el meta
  const shared = [];
  if (list.length >= 2) {
    const names = new Set(cards.flatMap(c => [...c.byCard].filter(([, p]) => p >= 0.6).map(([card]) => card)));
    for (const card of names) {
      if (meta.get(card) >= 0.7) continue;
      const incl = cards.map(c => c.byCard.get(card) || 0);
      const n = incl.filter(p => p >= 0.6).length;
      if (n >= 2) shared.push({ card, rivals: n, avg: incl.reduce((a, b) => a + b, 0) / list.length, meta: meta.get(card) });
    }
    shared.sort((a, b) => b.rivals - a.rivals || b.avg - a.avg);
  }
  return {
    me, pods: total.n, baseline: rate(total), minPods, rows, any, all,
    cards: cards.map(({ byCard, ...c }) => c), shared: shared.slice(0, 20),
  };
}

module.exports = { tableReport };
