'use strict';
// Meta del momento: presencia y resultados de los comandantes, su evolución mes a mes, niveles (tiers) y empates.
// Los niveles salen del INTERVALO DE CONFIANZA del winrate frente a la media del meta, no del porcentaje a secas: un
// mazo con pocas partidas no sube de nivel por suerte. Es una descripción de resultados, no una medida de la fuerza
// del mazo (el winrate refleja también al jugador).
const { commanderList, metaWinRate } = require('./stats');

const BUCKET = 30 * 86400, NB = 6;

// all: mazos con los filtros de jugadores (sin filtro de periodo), ya en el modo de empates elegido.
// period: los mismos mazos limitados al periodo elegido. Ambos comparten los objetos de los registros.
function metaReport(all, period, { minDecks = 40, top = 40, now = Math.floor(Date.now() / 1000) } = {}) {
  const mean = metaWinRate(period);
  const bucketOf = r => Math.max(0, Math.floor((now - r.date) / BUCKET));

  // Evolución: presencia por periodo de 30 días y tasa de empates global
  const totals = new Array(NB).fill(0), draws = new Array(NB).fill(0), games = new Array(NB).fill(0);
  const per = new Map();
  for (const r of all) {
    const b = bucketOf(r);
    if (b >= NB) continue;
    totals[b]++; draws[b] += r.draws; games[b] += r.allGames ?? r.games;
    let a = per.get(r.key); if (!a) per.set(r.key, a = new Array(NB).fill(0));
    a[b]++;
  }
  const buckets = [];
  for (let b = NB - 1; b >= 0; b--) {
    buckets.push({ start: (now - (b + 1) * BUCKET) * 1000, end: (now - b * BUCKET) * 1000, decks: totals[b], drawRate: games[b] ? draws[b] / games[b] : null });
  }

  const commanders = commanderList(period, minDecks).slice(0, top).map(c => {
    const s = per.get(c.commander) || new Array(NB).fill(0);
    const share = b => totals[b] ? s[b] / totals[b] : 0;
    const [lo, hi] = c.ci;
    const tier = lo > mean + 0.02 ? 'S' : lo > mean ? 'A' : hi < mean - 0.02 ? 'D' : hi < mean ? 'C' : 'B';
    return {
      commander: c.commander, decks: c.decks, share: c.metaShare, winRate: c.winRate, ci: c.ci, drawRate: c.drawRate, tier,
      series: Array.from({ length: NB }, (_, i) => share(NB - 1 - i)),           // del más antiguo al más reciente
      change: share(0) - (share(1) + share(2)) / 2,                               // último periodo frente a los 2 anteriores
    };
  });
  return { mean, minDecks, buckets, commanders, decksInPeriod: period.length };
}

module.exports = { metaReport };
