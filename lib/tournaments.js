'use strict';
// Torneos y listas que hicieron top: búsqueda por torneo, jugador, comandante o carta, y detalle de una lista
// comparada con lo que juega ese comandante. Solo lee los mazos ya descargados (no hace peticiones a TopDeck).
// La posición (`rank`) es el puesto final: TopDeck devuelve los standings ordenados y el primero es el campeón.
// Los mazos descargados antes de añadir este dato no tienen `rank` y no salen en las búsquedas.

const SCOPES = { win: r => r.rank === 1, top4: r => r.rank <= 4, cut: r => r.rank <= cutOf(r) };
// Tamaño del top cut: el del torneo; si no se conoce, se toman los 4 primeros
const cutOf = r => r.tc || 4;
const lower = s => String(s || '').toLowerCase();

const deckLine = r => ({
  tid: r.tid, name: r.tournament, date: r.date, size: r.size, rank: r.rank, cut: cutOf(r),
  player: r.player, commander: r.key, wins: r.wins, draws: r.draws, losses: r.losses, url: r.url || null,
});

// Lista de torneos recientes con su podio. `q` busca en el nombre del torneo, los jugadores y los comandantes del top.
function tournamentsReport(records, { q = '', limit = 30 } = {}) {
  const by = new Map();
  let ranked = 0;
  for (const r of records) {
    if (!r.rank) continue;
    ranked++;
    let t = by.get(r.tid);
    if (!t) by.set(r.tid, t = { tid: r.tid, name: r.tournament, date: r.date, size: r.size, cut: cutOf(r), elo: r.elo || null, top: [] });
    if (r.rank <= 4) t.top.push({ rank: r.rank, player: r.player, commander: r.key, wins: r.wins, draws: r.draws, losses: r.losses });
  }
  const needle = lower(q).trim();
  let list = [...by.values()];
  if (needle) list = list.filter(t => lower(t.name).includes(needle) || t.top.some(d => lower(d.player).includes(needle) || lower(d.commander).includes(needle)));
  list.sort((a, b) => b.date - a.date);
  for (const t of list) t.top.sort((a, b) => a.rank - b.rank);
  return { decks: records.length, ranked, total: list.length, tournaments: list.slice(0, limit) };
}

// Un torneo con TODOS sus participantes que tienen lista, por orden de puesto. `inCut` marca a los que pasaron al top cut;
// la web enseña por defecto solo esos y deja ver al resto, ordenar por resultados y filtrar por comandante o jugador.
function tournamentDetail(records, tid) {
  const mine = records.filter(r => r.tid === tid && r.rank).sort((a, b) => a.rank - b.rank);
  if (!mine.length) return null;
  const first = mine[0];
  return {
    tid, name: first.tournament, date: first.date, size: first.size, cut: cutOf(first), elo: first.elo || null,
    decks: mine.map(r => ({ ...deckLine(r), cards: r.cards.size, inCut: SCOPES.cut(r) })),
  };
}

// Búsqueda de listas que hicieron top. scope: 'win' (campeones), 'top4' o 'cut' (pasaron al top cut).
function decksReport(records, { commander = '', card = '', player = '', scope = 'cut', limit = 60 } = {}) {
  const inScope = SCOPES[scope] || SCOPES.cut;
  const cmd = lower(commander).trim(), pl = lower(player).trim(), cd = lower(card).trim();
  const out = [];
  let total = 0;
  for (const r of records) {
    if (!r.rank || !inScope(r)) continue;
    if (cmd && !lower(r.key).includes(cmd)) continue;
    if (pl && !lower(r.player).includes(pl)) continue;
    if (cd) { let has = false; for (const c of r.cards) if (lower(c) === cd) { has = true; break; } if (!has) continue; }
    total++;
    out.push(r);
  }
  out.sort((a, b) => b.date - a.date || a.rank - b.rank);
  return { total, decks: out.slice(0, limit).map(deckLine) };
}

// Todos los mazos de un comandante en el periodo, con filtros y orden, por páginas. A diferencia de las búsquedas de
// arriba, incluye también los mazos sin posición guardada (rank 0) y los que no pasaron al top cut.
// scope: 'all' | 'cut' | 'top4' | 'win'; sort: 'date' | 'rank' | 'record'.
function commanderDecksReport(records, key, { q = '', scope = 'all', sort = 'date', limit = 30, offset = 0 } = {}) {
  const mine = records.filter(r => r.key === key);
  if (!mine.length) return null;
  const top = (f) => mine.filter(r => r.rank && f(r)).length;
  const summary = { decks: mine.length, tournaments: new Set(mine.map(r => r.tid)).size, ranked: mine.filter(r => r.rank).length,
    cut: top(SCOPES.cut), top4: top(SCOPES.top4), wins: top(SCOPES.win) };
  const needle = lower(q).trim(), inScope = SCOPES[scope];
  let list = mine.filter(r => (!inScope || (r.rank && inScope(r))) && (!needle || lower(r.tournament).includes(needle) || lower(r.player).includes(needle)));
  const wr = r => (r.wins + r.losses) ? r.wins / (r.wins + r.losses) : -1;
  const by = {
    date: (a, b) => b.date - a.date || (a.rank || 1e9) - (b.rank || 1e9),
    rank: (a, b) => (a.rank || 1e9) - (b.rank || 1e9) || b.date - a.date,
    record: (a, b) => wr(b) - wr(a) || b.games - a.games || b.date - a.date,
  };
  list = list.sort(by[sort] || by.date);
  const start = Math.max(0, offset | 0), n = Math.min(100, Math.max(1, limit | 0));
  return { summary, total: list.length, offset: start, decks: list.slice(start, start + n).map(r => ({ ...deckLine(r), rank: r.rank || 0 })) };
}

// Una lista completa, con cuánto se juega cada carta entre los mazos del mismo comandante y qué le falta de lo habitual.
function deckDetail(records, tid, rank, { minShare = 0.5, rare = 0.1, minPeers = 8 } = {}) {
  const r = records.find(x => x.tid === tid && x.rank === rank);
  if (!r) return null;
  const peers = records.filter(x => x.key === r.key);
  const N = peers.length, use = new Map();
  for (const p of peers) for (const c of p.cards) use.set(c, (use.get(c) || 0) + 1);
  const copies = new Map(r.multi || []);
  const cards = [...r.cards].map(card => ({ card, copies: copies.get(card) || 1, share: (use.get(card) || 0) / N }))
    .sort((a, b) => b.share - a.share || a.card.localeCompare(b.card));
  const enough = N >= minPeers;
  const mine = new Set(r.cards);
  const missing = enough ? [...use].filter(([c, n]) => n / N >= minShare && !mine.has(c)).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([card, n]) => ({ card, share: n / N })) : [];
  const unusual = enough ? cards.filter(c => c.share < rare).map(c => c.card) : [];
  const names = r.key.split(' / ');
  const text = `~~Commanders~~\n${names.map(n => `1 ${n}`).join('\n')}\n\n~~Mainboard~~\n${cards.map(c => `${c.copies} ${c.card}`).sort((a, b) => a.slice(a.indexOf(' ')).localeCompare(b.slice(b.indexOf(' ')))).join('\n')}`;
  return { ...deckLine(r), peers: N, enough, cards, missing, unusual, total: cards.reduce((s, c) => s + c.copies, 0) + names.length, text };
}

module.exports = { commanderDecksReport, tournamentsReport, tournamentDetail, decksReport, deckDetail, isTop: (r, scope = 'cut') => !!r.rank && (SCOPES[scope] || SCOPES.cut)(r) };
