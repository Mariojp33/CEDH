'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildRecords } = require('../lib/stats');
const cache = require('../lib/cache');
const T = require('../lib/tournaments');

// Torneo mínimo con la forma de la API: standings ordenados por puesto, top cut de 2, lista con copias y enlace de origen
const deckObj = (cmd, extra = {}) => ({ Commanders: { [cmd]: { count: 1 } }, Mainboard: { 'Sol Ring': { count: 1 }, Island: { count: 5 }, ...extra }, metadata: { importedFrom: 'https://moxfield.com/decks/abc' } });
const tournament = (tid, n = 6) => ({
  TID: tid, tournamentName: 'Torneo ' + tid, startDate: Math.floor(Date.now() / 1000), topCut: 2, averageElo: 1523.4, rounds: [],
  standings: Array.from({ length: n }, (_, i) => ({ name: 'J' + i, id: 'p' + i, wins: n - i, draws: 0, losses: i, leader: 'Kinnan, Bonder Prodigy',
    deckObj: deckObj('Kinnan, Bonder Prodigy', i === 0 && tid === 't2' ? { 'Rare Card': { count: 1 } } : {}) })),
});

test('buildRecords guarda posición, top cut, Elo, enlace y copias', () => {
  const recs = buildRecords([tournament('t1')]);
  assert.strictEqual(recs.length, 6);
  assert.deepStrictEqual([recs[0].rank, recs[5].rank], [1, 6]);
  assert.strictEqual(recs[0].tc, 2);
  assert.strictEqual(recs[0].elo, 1523);
  assert.strictEqual(recs[0].url, 'https://moxfield.com/decks/abc');
  assert.deepStrictEqual(recs[0].multi, [['Island', 5]]);
});

test('la caché conserva los campos nuevos y lee mazos antiguos sin ellos', () => {
  const recs = buildRecords([tournament('t1')]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cedh-t-')), 'c.json');
  cache.writeStream(fs, file, { updatedAt: new Date().toISOString(), days: 1 }, recs);
  const back = cache.decodeAny(JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.deepStrictEqual([back[0].rank, back[0].tc, back[0].elo, back[0].url, back[0].multi], [1, 2, 1523, 'https://moxfield.com/decks/abc', [['Island', 5]]]);
  const old = cache.decodeAny(cache.encode ? { ...cache.encode(recs.map(r => ({ ...r, rank: undefined, url: undefined, multi: undefined }))), version: 4 } : null);
  assert.strictEqual(old[0].rank, undefined);
  assert.strictEqual(T.decksReport(old, {}).total, 0, 'sin posición no salen en las búsquedas');
});

test('torneos y listas top: podio, top cut, búsqueda y comparación con el comandante', () => {
  const recs = buildRecords([tournament('t1'), tournament('t2', 10)]);
  const rep = T.tournamentsReport(recs);
  assert.strictEqual(rep.total, 2);
  assert.strictEqual(rep.tournaments[0].top.length, 4);
  assert.strictEqual(rep.tournaments[0].top[0].rank, 1);
  assert.strictEqual(T.tournamentsReport(recs, { q: 'j3' }).total, 2, 'busca por jugador del podio');
  assert.strictEqual(T.tournamentsReport(recs, { q: 'zzz' }).total, 0);
  const page2 = T.tournamentsReport(recs, { limit: 1, offset: 1 });
  assert.strictEqual(page2.tournaments.length, 1);
  assert.notStrictEqual(page2.tournaments[0].tid, T.tournamentsReport(recs, { limit: 1 }).tournaments[0].tid, 'segunda página');
  assert.strictEqual(T.tournamentsReport(recs, { sort: 'size' }).tournaments[0].tid, 't2', 'orden por jugadores: el de 10 antes que el de 6');
  const det = T.tournamentDetail(recs, 't2');
  assert.strictEqual(det.decks.length, 10, 'todos los participantes, por puesto');
  assert.deepStrictEqual(det.decks.filter(d => d.inCut).map(d => d.rank), [1, 2], 'inCut marca a los del top cut (2)');
  assert.deepStrictEqual(det.decks.map(d => d.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.strictEqual(T.decksReport(recs, { scope: 'win' }).total, 2);
  assert.strictEqual(T.decksReport(recs, { scope: 'top4' }).total, 8);
  assert.strictEqual(T.decksReport(recs, { scope: 'cut' }).total, 4);
  assert.strictEqual(T.decksReport(recs, { card: 'rare card', scope: 'win' }).total, 1, 'por carta, sin distinguir mayúsculas');
  assert.strictEqual(T.decksReport(recs, { commander: 'inexistente' }).total, 0);
  const d = T.deckDetail(recs, 't2', 1);
  assert.strictEqual(d.peers, 16);
  assert.ok(d.enough);
  assert.deepStrictEqual(d.unusual, ['Rare Card'], 'la carta que casi nadie lleva');
  assert.strictEqual(d.total, 1 + 1 + 1 + 5, 'comandante + Sol Ring + Rare Card + 5 Island');
  assert.match(d.text, /^~~Commanders~~\n1 Kinnan, Bonder Prodigy\n\n~~Mainboard~~\n/);
  assert.match(d.text, /5 Island/);
  assert.strictEqual(T.deckDetail(recs, 't2', 99), null);
});

test('torneos de un comandante: resumen, filtros, orden y páginas', () => {
  const recs = buildRecords([tournament('t1'), tournament('t2', 10)]);
  recs.push({ ...recs[0], tid: 't0', tournament: 'Antiguo', rank: undefined, tc: 0, date: recs[0].date - 99999 }); // sin posición guardada
  const K = 'Kinnan, Bonder Prodigy';
  const all = T.commanderDecksReport(recs, K, { limit: 5 });
  assert.strictEqual(all.total, 17);
  assert.deepStrictEqual([all.summary.tournaments, all.summary.ranked, all.summary.cut, all.summary.wins], [3, 16, 4, 2]);
  assert.strictEqual(all.decks.length, 5);
  assert.strictEqual(T.commanderDecksReport(recs, K, { offset: 15 }).decks.length, 2, 'segunda página');
  assert.strictEqual(T.commanderDecksReport(recs, K, { scope: 'win' }).total, 2);
  assert.strictEqual(T.commanderDecksReport(recs, K, { scope: 'cut' }).total, 4, 'los sin posición no cuentan como top');
  assert.strictEqual(T.commanderDecksReport(recs, K, { q: 'antiguo' }).decks[0].rank, 0, 'el mazo sin posición sale con rank 0');
  assert.strictEqual(T.commanderDecksReport(recs, K, { q: 'j3' }).total, 2, 'busca por jugador');
  assert.deepStrictEqual(T.commanderDecksReport(recs, K, { sort: 'rank', limit: 3 }).decks.map(d => d.rank), [1, 1, 2]);
  assert.strictEqual(T.commanderDecksReport(recs, K, { sort: 'date', limit: 1 }).decks[0].tid === 't0', false, 'los más recientes primero');
  assert.strictEqual(T.commanderDecksReport(recs, 'Nadie'), null);
});

test('jugadores: se agrupan por nombre sin etiquetas, con winrate, puestos y comparación con el azar', () => {
  const recs = buildRecords([tournament('t1'), tournament('t2', 10)]);
  recs.forEach(r => { if (r.player === 'J0') r.player = r.tid === 't1' ? 'Ana [Equipo]' : 'ANA'; });
  assert.strictEqual(T.nameKey('Ana [Equipo]'), 'ana');
  assert.notStrictEqual(T.nameKey('Andrew (gamble)'), T.nameKey('Andrew (otro)'), 'los paréntesis distinguen a personas con el mismo nombre');
  const found = T.playersSearch(recs, 'an');
  assert.strictEqual(found[0].key, 'ana');
  assert.strictEqual(found[0].tournaments, 2, 'dos escrituras del mismo nombre se juntan');
  assert.deepStrictEqual(T.playersSearch(recs, 'a'), [], 'hacen falta al menos 2 letras');
  const rep = T.playerReport(recs, 'ana', { meta: 0.25 });
  assert.strictEqual(rep.decks, 2);
  assert.strictEqual(rep.wins, 6 + 10);
  assert.strictEqual(rep.luck.wins, 2, 'ganó los dos torneos (puesto 1)');
  assert.ok(Math.abs(rep.luck.expectedWins - (1 / 6 + 1 / 10)) < 1e-9);
  assert.ok(Math.abs(rep.luck.expectedCut - (2 / 6 + 2 / 10)) < 1e-9);
  assert.strictEqual(rep.commanders.length, 1);
  assert.strictEqual(rep.recent.length, 2);
  assert.ok(rep.ci[0] < rep.winRate && rep.winRate <= rep.ci[1] + 1e-12, 'el winrate cae dentro de su intervalo');
  assert.strictEqual(T.playerReport(recs, 'nadie'), null);
  const old = recs.map(r => ({ ...r, rank: undefined }));
  assert.strictEqual(T.playerReport(old, 'ana').luck, null, 'sin puestos no se compara con el azar');
});

test('los torneos sin puestos guardados también salen en la lista y se pueden abrir', () => {
  const recs = buildRecords([tournament('t1')]);
  const old = buildRecords([tournament('viejo', 8)]).map(r => ({ ...r, rank: undefined, tc: 0 }));
  const all = [...recs, ...old];
  const rep = T.tournamentsReport(all, { q: 'viejo' });
  assert.strictEqual(rep.total, 1, 'se encuentra por nombre aunque no tenga puestos');
  assert.strictEqual(rep.tournaments[0].hasRanks, false);
  assert.deepStrictEqual(rep.tournaments[0].top, []);
  assert.strictEqual(T.tournamentsReport(all).total, 2);
  assert.strictEqual(T.tournamentsReport(all, { q: 'j3' }).total, 2, 'también por jugador, ordenado o no');
  const det = T.tournamentDetail(all, 'viejo');
  assert.strictEqual(det.hasRanks, false);
  assert.strictEqual(det.decks.length, 8);
  assert.ok(det.decks.every(d => !d.inCut && d.rank === 0));
  assert.ok(det.decks[0].wins >= det.decks[1].wins, 'por récord');
  assert.strictEqual(T.tournamentDetail(all, 't1').hasRanks, true);
});

test('jugador: forma reciente, nivel del torneo y rendimiento contra cada comandante', () => {
  // 12 torneos de 20 jugadores en los que "Ana" va mejorando; el Elo sube con el tiempo (3 tramos de 4 torneos)
  const mk = (i) => ({ key: 'Kinnan', tid: 't' + i, tournament: 'T' + i, date: 1000 + i, size: 20, player: 'Ana', games: 4, wins: i < 6 ? 1 : 3, draws: 0, losses: i < 6 ? 3 : 1,
    cards: new Set(['A']), seats: [], rank: i < 6 ? 15 : 2, tc: 4, elo: 1400 + i * 10 });
  const own = Array.from({ length: 12 }, (_, i) => mk(i));
  // seats: contra "Rival" gana 1 de 6; contra "Otro" 4 de 6; contra "Raro" solo 2 mesas
  own[0].seats = [...Array(6)].map((_, k) => ({ w: k === 0 ? 1 : 0, n: 4, o: ['Rival', 'X', 'Y'] })).concat([...Array(6)].map((_, k) => ({ w: k < 4 ? 1 : 0, n: 4, o: ['Otro', 'X', 'Y'] })), [{ w: 1, n: 4, o: ['Raro', 'X', 'Y'] }, { w: 0, n: 4, o: ['Raro', 'X', 'Y'] }]);
  // otros jugadores, para que los terciles de Elo tengan referencia
  const others = Array.from({ length: 12 }, (_, i) => ({ ...mk(i), player: 'Bob', rank: 8, elo: 1400 + i * 10 }));
  const recs = [...own, ...others];
  const rep = T.playerReport(recs, 'ana', { meta: 0.25, seatRecords: recs });
  assert.strictEqual(rep.form.recent.tournaments, 5);
  assert.strictEqual(rep.form.before.tournaments, 7);
  assert.ok(rep.form.recent.pctl < rep.form.before.pctl, 'la forma reciente es mejor: puesto relativo más cerca de 0');
  assert.ok(rep.form.recent.winRate > rep.form.before.winRate);
  assert.strictEqual(rep.history.length, 12);
  assert.ok(rep.tiers && rep.tiers.rows.length === 3, 'tres tramos de nivel');
  assert.ok(rep.tiers.rows[2].winRate > rep.tiers.rows[0].winRate, 'rinde más en los torneos de Elo alto (donde ya iba mejorando)');
  const mu = Object.fromEntries(rep.matchups.rows.map(x => [x.opponent, x]));
  assert.strictEqual(mu.Rival.pods, 6); assert.strictEqual(mu.Rival.wins, 1);
  assert.strictEqual(mu.Otro.wins, 4);
  assert.strictEqual(mu.Raro.pods, 2, 'los rivales con pocas mesas también salen');
  assert.strictEqual(mu.Raro.enough, false, '…marcados como sin mesas suficientes');
  assert.strictEqual(mu.Rival.enough, true);
  assert.strictEqual(rep.matchups.total, rep.matchups.rows.length);
  assert.ok(rep.matchups.rows.every((x, i, a) => i === 0 || a[i - 1].pods >= x.pods), 'ordenados por mesas');
  assert.strictEqual(rep.matchups.pods, 14);
  // sin Elo no hay tramos; con pocos torneos no hay forma
  const sinElo = recs.map(r => ({ ...r, elo: 0 }));
  assert.strictEqual(T.playerReport(sinElo, 'ana').tiers, null);
  assert.strictEqual(T.playerReport(recs.filter(r => r.tid < 't3' || r.player === 'Bob'), 'ana').form, null);
});

test('jugadores habituales: top cut frente al azar y corrección por comparaciones múltiples', () => {
  const mk = (player, i, rank) => ({ key: 'K', tid: 't' + i, tournament: 'T' + i, date: 1000 + i, size: 32, player, games: 4, wins: rank <= 4 ? 3 : 1, draws: 0, losses: rank <= 4 ? 1 : 3, cards: new Set(['A']), seats: [], rank, tc: 4 });
  const recs = [];
  // "Mago" pasa el corte en 14 de 16 torneos (el azar daría 2); 40 jugadores corrientes pasan en 2 de 16; "Nuevo" solo juega 2 torneos
  for (let i = 0; i < 16; i++) recs.push(mk('Mago', i, i < 14 ? 2 : 20));
  for (let k = 0; k < 40; k++) for (let i = 0; i < 16; i++) recs.push(mk('Jugador ' + k, i, (i + k) % 8 === 0 ? 3 : 20));
  recs.push(mk('Nuevo', 1, 1), mk('Nuevo', 2, 1));
  const rep = T.regularsReport(recs, { minTournaments: 5 });
  assert.strictEqual(rep.tested, 41, 'Nuevo (2 torneos) queda fuera');
  assert.strictEqual(rep.better, 1, 'solo Mago está claramente por encima del azar tras corregir');
  const mago = rep.rows.find(r => r.name === 'Mago');
  assert.ok(mago.better && mago.cut === 14 && Math.abs(mago.expectedCut - 16 * 4 / 32) < 1e-9 && mago.q < 0.001);
  assert.ok(rep.rows.filter(r => r.name !== 'Mago').every(r => !r.better));
  assert.strictEqual(T.regularsReport(recs, { minTournaments: 5, sort: 'luck' }).rows[0].name, 'Mago');
  assert.strictEqual(T.regularsReport(recs, { minTournaments: 5, q: 'jugador 7' }).rows.length, 1);
  assert.strictEqual(T.regularsReport(recs.map(r => ({ ...r, rank: undefined })), {}).tested, 0, 'sin puestos no hay comparación con el azar');
});

test('equipos: se agrupan por la etiqueta entre corchetes y se ignoran pronombres y grupos pequeños', () => {
  assert.strictEqual(T.tagOf('Corbin [Pinnacle]'), 'Pinnacle');
  assert.strictEqual(T.tagOf('Alex [he/him]'), null);
  assert.strictEqual(T.tagOf('Sin etiqueta'), null);
  const mk = (player, i, rank) => ({ key: 'K', tid: 't' + i, tournament: 'T' + i, date: 1000 + i, size: 20, player, games: 4, wins: 2, draws: 0, losses: 2, cards: new Set(['A']), seats: [], rank, tc: 4 });
  const recs = [];
  for (let i = 0; i < 6; i++) for (const n of ['Ana [Team]', 'Bob [TEAM]', 'Cris [team]']) recs.push(mk(n, i, n.startsWith('Ana') && i < 3 ? 1 : 15));
  for (let i = 0; i < 12; i++) recs.push(mk('Solo [Otro]', i, 5));
  const rep = T.teamsReport(recs);
  assert.strictEqual(rep.total, 1, '«Otro» tiene un solo jugador: fuera');
  const t = rep.rows[0];
  assert.deepStrictEqual([t.players, t.decks, t.tournaments], [3, 18, 6]);
  assert.strictEqual(t.titles, 3);
  assert.strictEqual(t.top[0].decks, 6);
  assert.strictEqual(T.teamsReport(recs, { q: 'zzz' }).total, 0);
});

test('jugador: cómo cambia sus listas entre torneos (sin contar básicas)', () => {
  const mk = (i, cards) => ({ key: 'K', tid: 't' + i, tournament: 'T' + i, date: 1000 + i, size: 20, player: 'Ana', games: 4, wins: 2, draws: 0, losses: 2, cards: new Set(cards), seats: [], rank: 5 + i, tc: 4 });
  const recs = [mk(0, ['A', 'B', 'Island']), mk(1, ['A', 'C', 'Forest']), mk(2, ['A', 'C', 'Forest']), mk(3, ['D', 'C'])];
  const rep = T.playerReport(recs, 'ana');
  assert.strictEqual(rep.changes.length, 1);
  const c = rep.changes[0];
  assert.strictEqual(c.decks, 4);
  assert.strictEqual(c.steps.length, 3);
  const first = c.steps[c.steps.length - 1];       // el más antiguo va el último (de más reciente a más antiguo)
  assert.deepStrictEqual([first.added, first.removed], [['C'], ['B']], 'las tierras básicas no cuentan');
  assert.strictEqual(c.identical, 1, 'una vez repitió la misma lista');
  assert.deepStrictEqual([c.steps[0].added, c.steps[0].removed], [['D'], ['A']]);
  assert.strictEqual(T.playerReport(recs.slice(0, 1), 'ana').changes.length, 0, 'con una sola lista no hay cambios que mostrar');
});
