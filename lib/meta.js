'use strict';
// Meta del momento: presencia y resultados de los comandantes, su evolución mes a mes, niveles (tiers) y empates.
// Los niveles salen del INTERVALO DE CONFIANZA del winrate frente a la media del meta, no del porcentaje a secas: un
// mazo con pocas partidas no sube de nivel por suerte. Es una descripción de resultados, no una medida de la fuerza
// del mazo (el winrate refleja también al jugador).
const { commanderList, metaWinRate, twoPropZ } = require('./stats');

const BUCKET = 30 * 86400, NB = 6;
// Alertas: un cambio solo cuenta si es claro (|z| >= 3, exigente porque se miran decenas de comandantes a la vez)
// y de tamaño apreciable; así no salen subidas y bajadas que son ruido.
const ALERT_Z = 3, MIN_PRESENCE_CHANGE = 0.01, MIN_WR_CHANGE = 0.03, MIN_WR_GAMES = 60;

// all: mazos con los filtros de jugadores (sin filtro de periodo), ya en el modo de empates elegido.
// period: los mismos mazos limitados al periodo elegido. Ambos comparten los objetos de los registros.
function metaReport(all, period, { minDecks = 40, top = 40, now = Math.floor(Date.now() / 1000) } = {}) {
  const mean = metaWinRate(period);
  const bucketOf = r => Math.max(0, Math.floor((now - r.date) / BUCKET));

  // Evolución: presencia por periodo de 30 días y tasa de empates global
  const totals = new Array(NB).fill(0), draws = new Array(NB).fill(0), games = new Array(NB).fill(0);
  const per = new Map(), res = new Map();   // res: por comandante, victorias y partidas de cada periodo
  for (const r of all) {
    const b = bucketOf(r);
    if (b >= NB) continue;
    totals[b]++; draws[b] += r.draws; games[b] += r.allGames ?? r.games;
    let a = per.get(r.key); if (!a) per.set(r.key, a = new Array(NB).fill(0));
    a[b]++;
    let q = res.get(r.key); if (!q) res.set(r.key, q = { w: new Array(NB).fill(0), g: new Array(NB).fill(0) });
    q.w[b] += r.wins; q.g[b] += r.games;
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
    const q = res.get(c.commander) || { w: new Array(NB).fill(0), g: new Array(NB).fill(0) };
    const pw = q.w[1] + q.w[2], pg = q.g[1] + q.g[2];
    const presenceZ = twoPropZ(s[0], totals[0], s[1] + s[2], totals[1] + totals[2]);
    const winRateChange = q.g[0] && pg ? q.w[0] / q.g[0] - pw / pg : 0;
    const winRateZ = q.g[0] >= MIN_WR_GAMES && pg >= MIN_WR_GAMES ? twoPropZ(q.w[0], q.g[0], pw, pg) : 0;
    return {
      presenceZ, winRateChange, winRateZ, recentWinRate: q.g[0] ? q.w[0] / q.g[0] : null,
      commander: c.commander, decks: c.decks, share: c.metaShare, winRate: c.winRate, ci: c.ci, drawRate: c.drawRate, tier,
      series: Array.from({ length: NB }, (_, i) => share(NB - 1 - i)),           // del más antiguo al más reciente
      change: share(0) - (share(1) + share(2)) / 2,                               // último periodo frente a los 2 anteriores
    };
  });
  const alerts = [];
  for (const c of commanders) {
    if (Math.abs(c.presenceZ) >= ALERT_Z && Math.abs(c.change) >= MIN_PRESENCE_CHANGE)
      alerts.push({ commander: c.commander, kind: 'presence', direction: c.change > 0 ? 'up' : 'down', change: c.change, from: c.series[NB - 1] - c.change, to: c.series[NB - 1], z: c.presenceZ });
    if (Math.abs(c.winRateZ) >= ALERT_Z && Math.abs(c.winRateChange) >= MIN_WR_CHANGE)
      alerts.push({ commander: c.commander, kind: 'winrate', direction: c.winRateChange > 0 ? 'up' : 'down', change: c.winRateChange, to: c.recentWinRate, z: c.winRateZ });
  }
  alerts.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  return { mean, minDecks, buckets, commanders, alerts: alerts.slice(0, 10), decksInPeriod: period.length };
}

module.exports = { metaReport };
