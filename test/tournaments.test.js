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
