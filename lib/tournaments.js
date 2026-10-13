'use strict';
// Torneos y listas que hicieron top: búsqueda por torneo, jugador, comandante o carta, y detalle de una lista
// comparada con lo que juega ese comandante. Solo lee los mazos ya descargados (no hace peticiones a TopDeck).
// La posición (`rank`) es el puesto final: TopDeck devuelve los standings ordenados y el primero es el campeón.
// Los mazos descargados antes de añadir este dato no tienen `rank` y no salen en las búsquedas.

const { wilson, BASICS } = require('./stats');

const SCOPES = { win: r => r.rank === 1, top4: r => r.rank <= 4, cut: r => r.rank <= cutOf(r) };
// Tamaño del top cut: el del torneo; si no se conoce, se toman los 4 primeros
const cutOf = r => r.tc || 4;
const lower = s => String(s || '').toLowerCase();

const deckLine = r => ({
  tid: r.tid, name: r.tournament, date: r.date, size: r.size, rank: r.rank, cut: cutOf(r),
  player: r.player, commander: r.key, wins: r.wins, draws: r.draws, losses: r.losses, url: r.url || null,
});

// Lista de torneos recientes con su podio. `q` busca en el nombre del torneo, los jugadores y los comandantes del top.
function tournamentsReport(records, { q = '', limit = 30, offset = 0, sort = 'date' } = {}) {
  const by = new Map();
  let ranked = 0;
  for (const r of records) {
    let t = by.get(r.tid);
    if (!t) by.set(r.tid, t = { tid: r.tid, name: r.tournament, date: r.date, size: r.size, cut: cutOf(r), elo: r.elo || null, hasRanks: false, top: [], players: [] });
    t.players.push(lower(r.player));
    if (!r.rank) continue;
    ranked++; t.hasRanks = true;
    if (r.rank <= 4) t.top.push({ rank: r.rank, player: r.player, commander: r.key, wins: r.wins, draws: r.draws, losses: r.losses });
  }
  const needle = lower(q).trim();
  let list = [...by.values()];
  if (needle) list = list.filter(t => lower(t.name).includes(needle) || t.top.some(d => lower(d.player).includes(needle) || lower(d.commander).includes(needle)) || (!t.hasRanks && t.players.some(p => p.includes(needle))));
  list.sort(sort === 'size' ? (a, b) => b.size - a.size || b.date - a.date : (a, b) => b.date - a.date);
  for (const t of list) { t.top.sort((a, b) => a.rank - b.rank); delete t.players; }
  const start = Math.max(0, offset | 0);
  return { decks: records.length, ranked, total: list.length, offset: start, tournaments: list.slice(start, start + limit) };
}

// Un torneo con TODOS sus participantes que tienen lista, por orden de puesto. `inCut` marca a los que pasaron al top cut;
// la web enseña por defecto solo esos y deja ver al resto, ordenar por resultados y filtrar por comandante o jugador.
function tournamentDetail(records, tid) {
  const all = records.filter(r => r.tid === tid);
  if (!all.length) return null;
  const hasRanks = all.some(r => r.rank);
  // Sin puestos guardados (datos anteriores) se ordenan por récord y no se puede marcar el top cut
  const mine = hasRanks ? all.filter(r => r.rank).sort((a, b) => a.rank - b.rank)
    : [...all].sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.games - a.games);
  const first = mine[0];
  return {
    tid, name: first.tournament, date: first.date, size: first.size, cut: hasRanks ? cutOf(first) : 0, elo: first.elo || null, hasRanks,
    decks: mine.map(r => ({ ...deckLine(r), rank: r.rank || 0, cards: r.cards.size, inCut: !!r.rank && SCOPES.cut(r) })),
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

// ---- Jugadores ----
// TopDeck no nos da un identificador de persona, solo el nombre con el que se inscribe: dos personas con el mismo nombre
// se juntarían y una persona con varios nombres saldría partida. Se quitan las etiquetas entre corchetes («[DXTX]»,
// «[Pinnacle]»: equipos o comunidades) y las mayúsculas para juntar el mismo nombre escrito de formas distintas. Lo que va entre
// paréntesis se conserva: a menudo distingue a personas que se llaman igual («Andrew (gamble)»).
const nameKey = n => lower(n).replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

// Jugadores cuyo nombre contiene `q`, con lo justo para elegir al correcto.
function playersSearch(records, q, { limit = 15 } = {}) {
  const needle = nameKey(q);
  if (needle.length < 2) return [];
  const by = new Map();
  for (const r of records) {
    const k = nameKey(r.player);
    if (!k || !k.includes(needle)) continue;
    let e = by.get(k);
    if (!e) by.set(k, e = { key: k, names: new Map(), decks: 0, tournaments: new Set(), cut: 0, wins: 0 });
    e.names.set(r.player, (e.names.get(r.player) || 0) + 1);
    e.decks++; e.tournaments.add(r.tid);
    if (r.rank && SCOPES.cut(r)) e.cut++;
    if (r.rank === 1) e.wins++;
  }
  return [...by.values()].map(e => ({ key: e.key, name: [...e.names].sort((a, b) => b[1] - a[1])[0][0], decks: e.decks, tournaments: e.tournaments.size, cut: e.cut, wins: e.wins }))
    .sort((a, b) => (b.key === needle) - (a.key === needle) || b.decks - a.decks).slice(0, limit);
}

// Estadísticas de un jugador. `records` ya trae el ajuste de empates (modo «solo partidas con ganador» o no);
// `meta` es el winrate medio de todos los mazos con ese mismo ajuste.
// Además del winrate se compara con el azar: pasar el top cut o ganar un torneo ocurriría por pura suerte con
// probabilidad (cut / jugadores) y (1 / jugadores) en cada torneo; la suma de esas probabilidades es lo esperable.
function playerReport(records, key, { meta = null, recent = 30, seatRecords = null, minPods = 5, maxRivals = 40 } = {}) {
  const mine = records.filter(r => nameKey(r.player) === key);
  if (!mine.length) return null;
  const names = new Map();
  for (const r of mine) names.set(r.player, (names.get(r.player) || 0) + 1);
  const sum = f => mine.reduce((s, r) => s + f(r), 0);
  const games = sum(r => r.games), wins = sum(r => r.wins);
  const ranked = mine.filter(r => r.rank);
  const luck = ranked.length ? {
    ranked: ranked.length,
    cut: ranked.filter(SCOPES.cut).length, expectedCut: ranked.reduce((s, r) => s + Math.min(1, cutOf(r) / r.size), 0),
    top4: ranked.filter(SCOPES.top4).length, expectedTop4: ranked.reduce((s, r) => s + Math.min(1, 4 / r.size), 0),
    wins: ranked.filter(SCOPES.win).length, expectedWins: ranked.reduce((s, r) => s + 1 / r.size, 0),
  } : null;
  const cmd = new Map();
  for (const r of mine) {
    const e = cmd.get(r.key) || { commander: r.key, decks: 0, games: 0, wins: 0, cut: 0 };
    e.decks++; e.games += r.games; e.wins += r.wins; if (r.rank && SCOPES.cut(r)) e.cut++;
    cmd.set(r.key, e);
  }
    // Un registro por torneo (un jugador puede llevar dos mazos al mismo): puesto relativo (0 = campeón, 1 = último) y récord
    const byT = new Map();
    for (const r of mine) {
      const t = byT.get(r.tid) || { tid: r.tid, name: r.tournament, date: r.date, size: r.size, elo: r.elo || 0, rank: 0, games: 0, wins: 0 };
      t.games += r.games; t.wins += r.wins;
      if (r.rank && (!t.rank || r.rank < t.rank)) t.rank = r.rank;
      byT.set(r.tid, t);
    }
    const tours = [...byT.values()].sort((a, b) => a.date - b.date).map(t => ({ ...t, pctl: t.rank && t.size > 1 ? (t.rank - 1) / (t.size - 1) : null, winRate: t.games ? t.wins / t.games : null }));
    const agg = list => {
      const withP = list.filter(t => t.pctl != null), games = list.reduce((a, t) => a + t.games, 0), w = list.reduce((a, t) => a + t.wins, 0);
      return { tournaments: list.length, games, winRate: games ? w / games : null, pctl: withP.length ? withP.reduce((a, t) => a + t.pctl, 0) / withP.length : null, ranked: withP.length };
    };
    // Forma: los últimos 5 torneos frente a todos los anteriores (hacen falta al menos 6 en total)
    const form = tours.length >= 6 ? { recent: agg(tours.slice(-5)), before: agg(tours.slice(0, -5)) } : null;
    // Nivel del torneo: el Elo medio de los inscritos, partido en tres tramos (terciles de todos los torneos con Elo)
    const elos = [...new Map(records.filter(r => r.elo).map(r => [r.tid, r.elo])).values()].sort((a, b) => a - b);
    let tiers = null;
    if (elos.length >= 9 && tours.filter(t => t.elo).length >= 2) {
      const c1 = elos[Math.floor(elos.length / 3)], c2 = elos[Math.floor(elos.length * 2 / 3)];
      const tierOf = e => e < c1 ? 0 : e < c2 ? 1 : 2;
      const names = ['Nivel más bajo', 'Nivel medio', 'Nivel más alto'];
      tiers = { cuts: [c1, c2], rows: names.map((label, i) => ({ label, ...agg(tours.filter(t => t.elo && tierOf(t.elo) === i)) })).filter(x => x.tournaments) };
      if (tiers.rows.length < 2) tiers = null;
    }
    // Contra qué comandantes: en las mesas con cada rival, cuántas ganó (los asientos ya vienen filtrados por mesas con ganador si procede)
    let matchups = null;
    if (seatRecords) {
      const opp = new Map(); let pods = 0, won = 0;
      for (const r of seatRecords) {
        if (nameKey(r.player) !== key) continue;
        for (const st of r.seats || []) {
          if (st.n !== 3 && st.n !== 4) continue;
          pods++; won += st.w;
          for (const o of st.o) { const e = opp.get(o) || { opponent: o, pods: 0, wins: 0 }; e.pods++; e.wins += st.w; opp.set(o, e); }
        }
      }
      matchups = { pods, winRate: pods ? won / pods : null, minPods,
        // Todos los rivales con los que ha coincidido; `enough` marca los que tienen mesas suficientes (minPods) para sacar algo en claro
      total: opp.size,
      rows: [...opp.values()].map(e => ({ ...e, winRate: e.wins / e.pods, ci: wilson(e.wins, e.pods), enough: e.pods >= minPods }))
        .sort((a, b) => b.pods - a.pods || b.wins - a.wins || a.opponent.localeCompare(b.opponent)).slice(0, maxRivals) };
    }
  // Cómo cambia sus listas: para cada comandante que ha jugado en varios torneos, qué cartas metió y quitó entre uno y el siguiente
  const byCmd = new Map();
  for (const r of mine) (byCmd.get(r.key) || byCmd.set(r.key, []).get(r.key)).push(r);
  const changes = [...byCmd].filter(([, l]) => l.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 3).map(([commander, list]) => {
    list.sort((a, b) => a.date - b.date);
    const brief = r => ({ tid: r.tid, name: r.tournament, date: r.date, rank: r.rank || 0, size: r.size, wins: r.wins, games: r.games, winRate: r.games ? r.wins / r.games : null });
    const names = r => new Set([...r.cards].filter(c => !BASICS.has(c.toLowerCase())));
    const steps = [];
    for (let i = 1; i < list.length; i++) {
      const a = names(list[i - 1]), b = names(list[i]);
      steps.push({ from: brief(list[i - 1]), to: brief(list[i]), added: [...b].filter(c => !a.has(c)).sort(), removed: [...a].filter(c => !b.has(c)).sort() });
    }
    const avg = steps.reduce((t, x) => t + x.added.length, 0) / steps.length;
    return { commander, decks: list.length, avgChanged: avg, identical: steps.filter(x => !x.added.length && !x.removed.length).length, steps: steps.slice(-8).reverse() };
  });
  const lastDate = Math.max(...mine.map(r => r.date)), firstDate = Math.min(...mine.map(r => r.date));
  return {
    name: [...names].sort((a, b) => b[1] - a[1])[0][0], aliases: [...names.keys()].slice(0, 5), key,
    decks: mine.length, tournaments: new Set(mine.map(r => r.tid)).size, firstDate, lastDate,
    games, wins, winRate: games ? wins / games : null, ci: wilson(wins, games), meta,
    luck, form, tiers, matchups, changes, history: tours.slice(-20).map(t => ({ tid: t.tid, name: t.name, date: t.date, size: t.size, rank: t.rank, pctl: t.pctl, winRate: t.winRate, games: t.games })),
    commanders: [...cmd.values()].map(e => ({ ...e, winRate: e.games ? e.wins / e.games : null })).sort((a, b) => b.decks - a.decks).slice(0, 10),
    recent: [...mine].sort((a, b) => b.date - a.date).slice(0, recent).map(r => ({ ...deckLine(r), rank: r.rank || 0 })),
  };
}

// ---- Jugadores habituales y equipos ----
// Prob. de que una normal estándar supere z (aproximación de Abramowitz-Stegun)
function normUpper(z) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const half = Math.min(1, poly * Math.exp(-x * x)) / 2;
  return z >= 0 ? half : 1 - half;
}
// Corrección de Benjamini-Hochberg: q = proporción esperada de falsos positivos si se aceptaran todos hasta ese
function withQ(items) {
  const idx = items.map((x, i) => i).sort((a, b) => items[a].p - items[b].p);
  let prev = 1;
  for (let k = idx.length - 1; k >= 0; k--) { prev = Math.min(prev, items[idx[k]].p * idx.length / (k + 1)); items[idx[k]].q = prev; }
  return items;
}
// Resultados de un jugador torneo a torneo (un registro por torneo, con su mejor puesto)
function perTournament(list) {
  const by = new Map();
  for (const r of list) {
    const t = by.get(r.tid) || { size: r.size, cut: cutOf(r), rank: 0, games: 0, wins: 0 };
    t.games += r.games; t.wins += r.wins;
    if (r.rank && (!t.rank || r.rank < t.rank)) t.rank = r.rank;
    by.set(r.tid, t);
  }
  return [...by.values()];
}
// Lo observado frente a lo que daría el azar: en cada torneo, pasar el top cut tiene probabilidad cut/jugadores y ganar, 1/jugadores
function luckOf(tours) {
  const ranked = tours.filter(t => t.rank && t.size > 1);
  let exp = 0, vr = 0, expW = 0, cut = 0, titles = 0;
  for (const t of ranked) {
    const pc = Math.min(1, t.cut / t.size); exp += pc; vr += pc * (1 - pc); expW += 1 / t.size;
    if (t.rank <= t.cut) cut++; if (t.rank === 1) titles++;
  }
  const sd = Math.sqrt(vr);
  // una cola, con corrección de continuidad: ¿pasa el corte más veces de lo que daría la suerte?
  const z = sd > 0 ? (cut - 0.5 - exp) / sd : 0;
  return { ranked: ranked.length, cut, expectedCut: exp, titles, expectedTitles: expW, z, p: normUpper(z) };
}

// Jugadores que han jugado al menos `minTournaments` torneos con puesto guardado.
function regularsReport(records, { minTournaments = 5, sort = 'tournaments', q = '', limit = 50 } = {}) {
  const by = new Map();
  for (const r of records) {
    const k = nameKey(r.player);
    if (!k) continue;
    (by.get(k) || by.set(k, []).get(k)).push(r);
  }
  const needle = nameKey(q);
  const rows = [];
  for (const [key, list] of by) {
    const tours = perTournament(list);
    const lk = luckOf(tours);
    if (lk.ranked < minTournaments) continue;
    const games = list.reduce((a, r) => a + r.games, 0), wins = list.reduce((a, r) => a + r.wins, 0);
    const names = new Map(); for (const r of list) names.set(r.player, (names.get(r.player) || 0) + 1);
    rows.push({ key, name: [...names].sort((a, b) => b[1] - a[1])[0][0], tournaments: tours.length, ranked: lk.ranked, decks: list.length, games, wins,
      winRate: games ? wins / games : null, ci: wilson(wins, games), cut: lk.cut, expectedCut: lk.expectedCut, titles: lk.titles, expectedTitles: lk.expectedTitles, z: lk.z, p: lk.p });
  }
  withQ(rows);
  for (const r of rows) r.better = r.q < 0.05 && r.cut > r.expectedCut;
  const by_ = { tournaments: (a, b) => b.tournaments - a.tournaments || b.z - a.z, luck: (a, b) => b.z - a.z || b.tournaments - a.tournaments, winrate: (a, b) => (b.winRate ?? -1) - (a.winRate ?? -1) || b.games - a.games };
  rows.sort(by_[sort] || by_.tournaments);
  const shown = needle ? rows.filter(r => r.key.includes(needle)) : rows;
  return { minTournaments, tested: rows.length, better: rows.filter(r => r.better).length, total: shown.length, rows: shown.slice(0, Math.min(200, limit)).map(({ p, ...r }) => r) };
}

// Equipos: se agrupa por la etiqueta entre corchetes del nombre («Corbin [Pinnacle]»). Es aproximado: no todos la usan,
// algunos la escriben distinto y no siempre es un equipo (a veces es una comunidad o una tienda).
const TAG = /\[([^\]]{2,24})\]/;
const tagOf = name => { const m = TAG.exec(String(name || '')); if (!m) return null; const t = m[1].trim(); return /^(he|she|they|him|her|it)\b/i.test(t) || !t ? null : t; };
function teamsReport(records, { minPlayers = 3, minDecks = 10, q = '', limit = 60 } = {}) {
  const by = new Map();
  for (const r of records) {
    const t = tagOf(r.player);
    if (!t) continue;
    const k = lower(t);
    const e = by.get(k) || by.set(k, { tag: new Map(), list: [] }).get(k);
    e.tag.set(t, (e.tag.get(t) || 0) + 1); e.list.push(r);
  }
  const needle = lower(q).trim();
  const rows = [];
  for (const [key, e] of by) {
    if (e.list.length < minDecks) continue;
    const players = new Map();
    for (const r of e.list) { const k = nameKey(r.player); const pl = players.get(k) || { name: r.player, decks: 0 }; pl.decks++; players.set(k, pl); }
    if (players.size < minPlayers) continue;
    const tag = [...e.tag].sort((a, b) => b[1] - a[1])[0][0];
    if (needle && !lower(tag).includes(needle)) continue;
    const games = e.list.reduce((a, r) => a + r.games, 0), wins = e.list.reduce((a, r) => a + r.wins, 0);
    // el azar se mide por jugador y torneo (un equipo con muchos jugadores en un torneo tiene más opciones)
    const lk = luckOf(perTournamentPlayers(e.list));
    rows.push({ tag, key, players: players.size, decks: e.list.length, tournaments: new Set(e.list.map(r => r.tid)).size, games, wins, winRate: games ? wins / games : null, ci: wilson(wins, games),
      ranked: lk.ranked, cut: lk.cut, expectedCut: lk.expectedCut, titles: lk.titles, expectedTitles: lk.expectedTitles,
      top: [...players.values()].sort((a, b) => b.decks - a.decks).slice(0, 5).map(x => ({ name: x.name, decks: x.decks })) });
  }
  rows.sort((a, b) => b.decks - a.decks);
  return { minPlayers, minDecks, total: rows.length, rows: rows.slice(0, limit) };
}
// Un registro por jugador y torneo (no por mazo)
function perTournamentPlayers(list) {
  const by = new Map();
  for (const r of list) {
    const k = r.tid + '|' + nameKey(r.player);
    const t = by.get(k) || { size: r.size, cut: cutOf(r), rank: 0, games: 0, wins: 0 };
    t.games += r.games; t.wins += r.wins;
    if (r.rank && (!t.rank || r.rank < t.rank)) t.rank = r.rank;
    by.set(k, t);
  }
  return [...by.values()];
}

module.exports = { regularsReport, teamsReport, tagOf, playersSearch, playerReport, nameKey, commanderDecksReport, tournamentsReport, tournamentDetail, decksReport, deckDetail, isTop: (r, scope = 'cut') => !!r.rank && (SCOPES[scope] || SCOPES.cut)(r) };
