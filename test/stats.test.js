'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseText, parseDeck, commanderKey, cleanName } = require('../lib/parse');
const { buildRecords, filterRecords, commanderList, commanderReport, myListReport, trendReport, synergyReport, variantsReport, matchups, matrix, cardsVsOpponent,
  wilson, twoPropZ } = require('../lib/stats');
const { mockTournaments, KINNAN, NAJEELA } = require('../lib/mock');

test('parseText separa comandantes y mainboard', () => {
  const d = parseText('~~Commanders~~\n1 Kinnan, Bonder Prodigy\n\n~~Mainboard~~\n1 Sol Ring\n2 Island\n');
  assert.deepStrictEqual(d.commanders, ['Kinnan, Bonder Prodigy']);
  assert.strictEqual(d.cards.get('Sol Ring'), 1);
  assert.strictEqual(d.cards.get('Island'), 2);
});

test('cleanName quita sufijos de set y caras dobles', () => {
  assert.strictEqual(cleanName('Sol Ring (C21) 263'), 'Sol Ring');
  assert.strictEqual(cleanName('Delver of Secrets // Insectile Aberration'), 'Delver of Secrets');
});

test('parseDeck acepta deckObj con varias formas', () => {
  const a = parseDeck({ deckObj: { Commanders: { 'A': { count: 1 } }, Mainboard: { 'X': { count: 1 }, 'Y': 2 } } });
  assert.deepStrictEqual(a.commanders, ['A']);
  assert.strictEqual(a.cards.get('Y'), 2);
  assert.strictEqual(parseDeck({ decklist: 'https://moxfield.com/decks/abc' }), null);
});

test('commanderKey usa leader si existe', () => {
  assert.strictEqual(commanderKey({ leader: 'A / B' }, null), 'A / B');
  assert.strictEqual(commanderKey({}, { commanders: ['B', 'A'] }), 'A / B');
});

test('estadística básica', () => {
  const [lo, hi] = wilson(25, 100);
  assert.ok(lo < 0.25 && hi > 0.25);
  assert.ok(Math.abs(twoPropZ(60, 100, 40, 100) - 2.828) < 0.01);
  assert.strictEqual(twoPropZ(0, 0, 1, 1), 0);
});

test('recupera los efectos plantados en los datos demo', () => {
  const records = buildRecords(mockTournaments({ count: 150, seed: 7 }));
  const list = commanderList(records, 5);
  assert.strictEqual(list[0].commander, 'Kinnan, Bonder Prodigy');

  const rep = commanderReport(records, 'Kinnan, Bonder Prodigy');
  const bestNames = rep.best.slice(0, 6).map(c => c.card);
  assert.ok(bestNames.includes("Thassa's Oracle"), `best: ${bestNames}`);
  assert.ok(bestNames.includes('Basalt Monolith'), `best: ${bestNames}`);
  const worstNames = rep.worst.slice(0, 8).map(c => c.card);
  assert.ok(worstNames.includes('Carta de relleno 1'), `worst: ${worstNames}`);

  const oracle = rep.best.find(c => c.card === "Thassa's Oracle");
  assert.ok(oracle.lift > 0.03 && oracle.z > 2);
  // Una carta sin efecto no debe salir con z extremo
  const sol = rep.popular.find(c => c.card === 'Sol Ring');
  assert.ok(sol.z === null || Math.abs(sol.z) < 3.5);
});

// ---------- Mesas, matchups y filtro por tamaño ----------

const deck = (cmd) => `~~Commanders~~\n1 ${cmd}\n\n~~Mainboard~~\n1 Sol Ring\n`;
const player = (id, cmd) => ({ name: id, id, decklist: deck(cmd), leader: cmd, wins: 1, draws: 0, losses: 0 });

test('buildRecords: ganador, empate, bye y mesa sin terminar', () => {
  const t = {
    TID: 't1', tournamentName: 'T', startDate: 1,
    standings: [player('a', 'A'), player('b', 'B'), player('c', 'C'), player('d', 'D'), player('e', 'E')],
    rounds: [
      { round: 1, tables: [
        { table: 1, players: ['a', 'b', 'c', 'd'].map(id => ({ id, name: id })), winner_id: 'a', status: 'Completed' },
        { table: 'Byes', players: [{ id: 'e', name: 'e' }], status: 'Bye' },
      ] },
      { round: 2, tables: [
        { table: 1, players: ['a', 'b', 'c', 'd'].map(id => ({ id, name: id })), winner_id: 'Draw', status: 'Completed' },
      ] },
      { round: 3, tables: [
        { table: 1, players: ['a', 'b', 'c', 'd'].map(id => ({ id, name: id })), winner_id: null, status: 'Active' },
      ] },
    ],
  };
  const recs = buildRecords([t]);
  const a = recs.find(r => r.key === 'A'), b = recs.find(r => r.key === 'B'), e = recs.find(r => r.key === 'E');
  assert.deepStrictEqual(a.seats.map(s => s.w), [1, 0]);   // gana R1, empate R2, R3 se ignora
  assert.deepStrictEqual(b.seats.map(s => s.w), [0, 0]);
  assert.strictEqual(e.seats.length, 0);                    // el bye no es una mesa
  assert.deepStrictEqual([...a.seats[0].o].sort(), ['B', 'C', 'D']);
  assert.strictEqual(a.size, 5);
});

test('las victorias por mesa coinciden con las de la clasificación (datos demo)', () => {
  for (const r of buildRecords(mockTournaments({ count: 5, seed: 1 }))) {
    assert.strictEqual(r.seats.reduce((s, x) => s + x.w, 0), r.wins);
  }
});

test('filterRecords filtra por jugadores del torneo', () => {
  const recs = buildRecords(mockTournaments({ count: 30, seed: 5 }));
  const sizes = recs.map(r => r.size);
  const mid = [...sizes].sort((x, y) => x - y)[Math.floor(sizes.length / 2)];
  const big = filterRecords(recs, { minPlayers: mid });
  assert.ok(big.length > 0 && big.length < recs.length);
  assert.ok(big.every(r => r.size >= mid));
  const small = filterRecords(recs, { maxPlayers: mid - 1 });
  assert.ok(small.every(r => r.size < mid));
  assert.strictEqual(filterRecords(recs, {}), recs);
});

test('matchups recupera el efecto plantado de Najeela contra Kinnan', () => {
  const recs = buildRecords(mockTournaments({ count: 200, seed: 11 }));
  const m = matchups(recs, NAJEELA);
  const vsKinnan = m.rows.find(r => r.opponent === KINNAN);
  assert.ok(vsKinnan.lift > 0.03 && vsKinnan.z > 3, `lift=${vsKinnan.lift} z=${vsKinnan.z}`);
  const inverse = matchups(recs, KINNAN).rows.find(r => r.opponent === NAJEELA);
  assert.ok(inverse.lift < 0 && inverse.z < -2);
});

test('cardsVsOpponent separa la carta buena solo contra un rival (exceso)', () => {
  const recs = buildRecords(mockTournaments({ count: 200, seed: 11 }));
  const r = cardsVsOpponent(recs, KINNAN, NAJEELA);
  assert.strictEqual(r.best[0].card, 'Cyclonic Rift');
  assert.ok(r.best[0].excess > 0.05, `exceso=${r.best[0].excess}`);
  // Una carta buena contra todos no debe tener un exceso grande
  const oracle = r.best.find(c => c.card === "Thassa's Oracle");
  assert.ok(Math.abs(oracle.excess) < 0.05, `exceso Oracle=${oracle.excess}`);
});

test('matrix: celdas coherentes con matchups', () => {
  const recs = buildRecords(mockTournaments({ count: 100, seed: 3 }));
  const mx = matrix(recs, 5);
  const cell = mx.cells[KINNAN][NAJEELA];
  const row = matchups(recs, KINNAN, { minPods: 1 }).rows.find(r => r.opponent === NAJEELA);
  assert.strictEqual(cell.pods, row.pods);
  assert.strictEqual(cell.wins, row.wins);
});

test('filterRecords filtra por antigüedad (days)', () => {
  const now = Math.floor(Date.now() / 1000);
  const recs = [{ date: now - 10 * 86400, size: 30 }, { date: now - 60 * 86400, size: 30 }, { date: now - 150 * 86400, size: 30 }];
  assert.strictEqual(filterRecords(recs, { days: 30 }).length, 1);
  assert.strictEqual(filterRecords(recs, { days: 90 }).length, 2);
  assert.strictEqual(filterRecords(recs, { days: 180 }).length, 3);
});

test('commanderReport: encoge las diferencias y corrige por comparaciones múltiples', () => {
  const rep = commanderReport(buildRecords(mockTournaments()), KINNAN);
  const t = rep.best.find(c => c.card === "Thassa's Oracle");
  assert.ok(t, 'recupera la carta con efecto plantado');
  assert.ok(t.adj > 0 && t.adj <= t.lift, 'la ajustada es positiva y no mayor que la bruta');
  assert.ok(t.q >= 0 && t.q <= 1);
  for (let i = 1; i < rep.best.length; i++) assert.ok(rep.best[i - 1].adj >= rep.best[i].adj);
});

test('myListReport propone recortes y cartas que faltan', () => {
  const recs = buildRecords(mockTournaments());
  const list = new Set(['Sol Ring', 'Island', 'Carta de relleno 1', 'Carta inventada']);
  const r = myListReport(recs, KINNAN, list);
  assert.deepStrictEqual(r.unknown, ['Carta inventada']);
  assert.strictEqual(r.cards, 2); // Island es básica y se ignora
  assert.ok(!r.missing.some(c => c.card === 'Sol Ring'), 'no sugiere lo que ya llevas');
  assert.ok(r.missing.length > 0);
  assert.strictEqual(myListReport(recs, 'No existe', list), null);
});

test('cleanName quita set y acabado en el export de Moxfield', () => {
  assert.strictEqual(cleanName('Sol Ring (SLD) 123 *F*'), 'Sol Ring');
  assert.strictEqual(cleanName('Mana Crypt (2XM) 1 *E*'), 'Mana Crypt');
  assert.strictEqual(cleanName('Lotus Petal (SLD) 55★'), 'Lotus Petal');
  assert.strictEqual(cleanName('Fire // Ice (MH2) 290 *F*'), 'Fire');
});

test('trendReport reparte los mazos por periodos y calcula la presencia', () => {
  const recs = buildRecords(mockTournaments());
  const t = trendReport(recs, KINNAN);
  assert.ok(t.series.length >= 5);
  assert.strictEqual(t.series.reduce((s, b) => s + b.decks, 0), recs.filter(r => r.key === KINNAN).length);
  assert.ok(t.series.every(b => b.metaShare >= 0 && b.metaShare <= 1));
  assert.strictEqual(trendReport(recs, 'No existe'), null);
});

test('synergyReport devuelve pares con q y respeta el mínimo por celda', () => {
  const recs = buildRecords(mockTournaments());
  const s = synergyReport(recs, KINNAN);
  assert.ok(s.tested > 0);
  for (const x of [...s.positive, ...s.negative]) assert.ok(x.decks >= 8 && x.q >= 0 && x.q <= 1);
  assert.ok(s.positive.every(x => x.synergy > 0) && s.negative.every(x => x.synergy < 0));
});

test('variantsReport reparte todos los mazos en variantes', () => {
  const recs = buildRecords(mockTournaments());
  const v = variantsReport(recs, KINNAN, { k: 3 });
  assert.ok(v.variants.length >= 1);
  assert.ok(v.variants.reduce((s, x) => s + x.decks, 0) <= v.decks);
  for (let i = 1; i < v.variants.length; i++) assert.ok(v.variants[i - 1].decks >= v.variants[i].decks);
  assert.ok(variantsReport(recs, 'No existe', {}).tooFew);
});

test('commanderReport incluye la tasa de empates', () => {
  const r = commanderReport(buildRecords(mockTournaments()), KINNAN);
  assert.ok(r.drawRate >= 0 && r.drawRate < 1 && Number.isInteger(r.draws));
});
