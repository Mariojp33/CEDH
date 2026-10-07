'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseText, parseDeck, commanderKey, cleanName } = require('../lib/parse');
const { buildRecords, filterRecords, commanderList, commanderReport, classifyTournaments, decisiveSeats, myListReport, trendReport, variantsReport, matchups, matrix, cardsVsOpponent,
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

test('myListReport compara con las listas parecidas: faltan, alternativas y poco habituales', () => {
  const recs = buildRecords(mockTournaments());
  const list = new Set(['Sol Ring', 'Island', 'Carta de relleno 1', 'Carta inventada']);
  const r = myListReport(recs, KINNAN, list);
  assert.deepStrictEqual(r.unknown, ['Carta inventada']);
  assert.strictEqual(r.cards, 2); // Island es básica y se ignora
  assert.ok(r.peers.n >= 30 && r.peers.similarity > 0 && r.peers.similarity <= 1);
  assert.ok(!r.missing.some(c => c.card === 'Sol Ring'), 'no sugiere lo que ya llevas');
  assert.ok(r.missing.every(c => c.peer >= 0.5) && r.options.every(c => c.peer >= 0.2 && c.peer < 0.5));
  assert.ok(r.unusual.every(c => c.peer < 0.05), 'poco habituales = casi ninguna lista parecida la juega');
  assert.ok(!('review' in r) && !('tech' in r), 'ya no se recomienda por winrate asociado');
  assert.strictEqual(myListReport(recs, 'No existe', list), null);
});

test('una lista real: lo que casi todas las parecidas llevan no se pide recortar y su propia lista no tiene faltas', () => {
  const recs = buildRecords(mockTournaments());
  const base = recs.filter(r => r.key === KINNAN)[0];
  const r = myListReport(recs, KINNAN, new Set(base.cards));
  assert.ok(r.unusual.length === 0 || r.unusual.every(c => c.peer < 0.05));
  // las cartas más usadas por las listas parecidas que ya lleva no aparecen como "faltan"
  assert.ok(r.missing.every(c => !base.cards.has(c.card)));
  assert.ok(r.all.every((c, i) => i === 0 || r.all[i - 1].peer >= c.peer - 1e-12));
});

test('packagesReport encuentra cartas que se juegan juntas y alternativas, sin mirar resultados', () => {
  const { packagesReport } = require('../lib/stats');
  // 400 mazos: A y B siempre juntas (paquete); C y D nunca coinciden (alternativas); E independiente
  const recs = [];
  for (let i = 0; i < 400; i++) {
    const cards = new Set(['Base']);
    if (i % 2 === 0) { cards.add('A'); cards.add('B'); }
    if (i % 4 < 2) cards.add('C'); else cards.add('D');
    if ((i * 7) % 3 === 0) cards.add('E');
    recs.push({ key: 'K', tid: 't' + (i % 20), date: 1, size: 20, player: 'p' + i, cards, wins: 1, losses: 1, draws: 0, games: 2, seats: [] });
  }
  const r = packagesReport(recs, 'K', { minSupport: 30 });
  assert.ok(r.together.some(x => [x.a, x.b].sort().join() === 'A,B' && x.phi > 0.9 && x.withA > 0.99 && x.withoutA < 0.01));
  assert.ok(r.alternatives.some(x => [x.a, x.b].sort().join() === 'C,D' && x.phi < -0.9));
  assert.ok(!r.together.concat(r.alternatives).some(x => x.a === 'Base' || x.b === 'Base'), 'las cartas que lleva todo el mundo no forman paquetes');
  assert.ok(r.together.every(x => x.decks >= 30));
  assert.ok(packagesReport(recs.slice(0, 50), 'K').tooFew);
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

test('cache: codificar y decodificar conserva los registros y comparte las cadenas', () => {
  const cache = require('../lib/cache');
  const recs = buildRecords(mockTournaments()).slice(0, 300);
  const back = cache.decodeAny(JSON.parse(JSON.stringify({ version: cache.VERSION, ...cache.encode(recs) })));
  assert.strictEqual(back.length, recs.length);
  for (let i = 0; i < recs.length; i++) {
    assert.deepStrictEqual([...back[i].cards].sort(), [...recs[i].cards].sort());
    assert.deepStrictEqual(back[i].seats, recs[i].seats);
    assert.deepStrictEqual({ ...back[i], cards: 0, seats: 0 }, { ...recs[i], cards: 0, seats: 0 });
  }
  // Estadísticas idénticas antes y después
  assert.deepStrictEqual(commanderList(back, 5), commanderList(recs, 5));
  // El orden de recorrido de las cartas cambia en el último decimal: se compara con tolerancia
  const top = rep => commanderReport(rep, KINNAN).best.slice(0, 5).map(c => [c.card, c.decks, Math.round(c.adj * 1e9)]);
  assert.deepStrictEqual(top(back), top(recs));
  assert.ok(back[0].cards.has([...recs[0].cards][0]) && !back[0].cards.has('No existe'));
  assert.strictEqual(back[0].cards.size, recs[0].cards.size);
});

test('fetchTournaments con onBatch entrega cada ventana y no acumula', async () => {
  const { fetchTournaments } = require('../lib/topdeck');
  const real = global.fetch; let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => [{ TID: 'a' + calls }, { TID: 'a1' }] }; };
  try {
    const got = [];
    const out = await fetchTournaments({ apiKey: 'k', days: 21, windowDays: 7, onBatch: b => got.push(b.map(t => t.TID)) });
    assert.deepStrictEqual(out, []);
    assert.deepStrictEqual(got, [['a1'], ['a2'], ['a3']]); // a1 repetido se descarta
    calls = 0;
    assert.strictEqual((await fetchTournaments({ apiKey: 'k', days: 21, windowDays: 7 })).length, 3);
  } finally { global.fetch = real; }
});

test('cache: el guardado en streaming se lee igual que el codificado de golpe', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const cache = require('../lib/cache');
  const recs = buildRecords(mockTournaments()).slice(0, 2500); // varios trozos
  const f = path.join(os.tmpdir(), `cedh-cache-${process.pid}.json`);
  try {
    cache.writeStream(fs, f, { updatedAt: 'ayer', days: 180, excluded: [['t1', 12], ['t2', 30]] }, recs, 700);
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.strictEqual(j.version, cache.VERSION); assert.strictEqual(j.days, 180); assert.strictEqual(j.updatedAt, 'ayer');
    assert.deepStrictEqual(j.excluded, [['t1', 12], ['t2', 30]]);
    const back = cache.decodeAny(j);
    assert.strictEqual(back.length, recs.length);
    assert.deepStrictEqual(back.map(r => [r.key, r.tid, r.wins, r.cards.size, r.seats.length]),
      recs.map(r => [r.key, r.tid, r.wins, r.cards.size, r.seats.length]));
    assert.ok(back[10].cards.has([...recs[10].cards][0]));
  } finally { fs.rmSync(f, { force: true }); }
});

test('refreshDays descarga solo los días que faltan, con mínimo y máximo', () => {
  const { refreshDays } = require('../lib/cache');
  const now = Date.parse('2026-10-10T12:00:00Z');
  assert.strictEqual(refreshDays('2026-10-10T06:00:00Z', 180, { now }), 3);   // reciente: mínimo
  assert.strictEqual(refreshDays('2026-10-05T12:00:00Z', 180, { now }), 7);   // 5 días + 2
  assert.strictEqual(refreshDays('2026-01-01T00:00:00Z', 90, { now }), 90);   // muy antigua: tope
  assert.strictEqual(refreshDays(null, 90, { now }), 90);
});

test('validationReport comprueba si el efecto se repite en datos posteriores', () => {
  const { validationReport } = require('../lib/stats');
  const v = validationReport(buildRecords(mockTournaments()), { minDecks: 60 });
  assert.ok(v.commanders >= 1 && v.cards > 50);
  assert.deepStrictEqual(v.rows.map(r => r.level), ['alta', 'media', 'baja']);
  for (const r of v.rows) assert.ok(r.rate == null || (r.rate >= 0 && r.rate <= 1));
  assert.ok(v.rows[0].cards === 0 || v.rows[0].rate >= v.rows[2].rate, 'alta debe repetirse al menos tanto como baja');
  assert.strictEqual(validationReport([], {}), null);
});

test('la referencia es la media real del meta, no el 25 % fijo', () => {
  const { metaWinRate } = require('../lib/stats');
  const recs = buildRecords(mockTournaments());
  const w = recs.reduce((s, r) => s + r.wins, 0), g = recs.reduce((s, r) => s + r.games, 0);
  assert.ok(Math.abs(metaWinRate(recs) - w / g) < 1e-12);
  assert.strictEqual(metaWinRate([]), 0.25); // sin datos, se cae al azar puro
  const rep = commanderReport(recs, KINNAN);
  assert.strictEqual(rep.baseline, metaWinRate(recs));
  assert.strictEqual(rep.chance, 0.25);
  const t = trendReport(recs, KINNAN);
  assert.ok(t.series.every(b => b.meta == null || (b.meta > 0 && b.meta < 1)));
  assert.strictEqual(variantsReport(recs, KINNAN).baseline, metaWinRate(recs));
});

test('rating: el modelo de Luce recupera fuerzas conocidas y reconstruye las mesas', () => {
  const R = require('../lib/rating');
  const rnd = R.rng(42);
  const names = Array.from({ length: 12 }, (_, i) => 'C' + i);
  const truth = names.map((_, i) => Math.exp((i - 5.5) * 0.18)); // fuerzas reales de 0,4 a 2,5
  const pods = [];
  for (let n = 0; n < 6000; n++) {
    const seat = [];
    while (seat.length < 4) { const c = (rnd() * 12) | 0; if (!seat.includes(c)) seat.push(c); }
    const tot = seat.reduce((s, c) => s + truth[c], 0);
    let x = rnd() * tot, w = 0;
    for (; w < 3 && x > truth[seat[w]]; w++) x -= truth[seat[w]];
    const order = [seat[w], ...seat.filter((_, i) => i !== w)];
    pods.push({ tid: 't' + (n % 40), date: n, c: order.map(c => names[c]) });
  }
  const fit = R.fitLuce(pods);
  const est = names.map(nm => Math.log(fit.s[fit.idx.get(nm)]));
  const tru = truth.map(Math.log);
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const ma = mean(est), mb = mean(tru);
  const corr = est.reduce((s, x, i) => s + (x - ma) * (tru[i] - mb), 0) /
    Math.sqrt(est.reduce((s, x) => s + (x - ma) ** 2, 0) * tru.reduce((s, x) => s + (x - mb) ** 2, 0));
  assert.ok(corr > 0.95, 'correlación con las fuerzas reales ' + corr);
  // podsFrom: una mesa con ganador aparece una sola vez; las empatadas y las incompletas quedan fuera
  const recs = [
    { key: 'A', tid: 't', date: 1, seats: [{ w: 1, n: 4, o: ['B', 'C', 'D'] }, { w: 0, n: 4, o: ['A', 'C', 'D'] }] },
    { key: 'B', tid: 't', date: 1, seats: [{ w: 0, n: 4, o: ['A', 'C', 'D'] }, { w: 0, n: 4, o: ['A', 'C', 'D'] }] }, // mesa empatada
    { key: 'C', tid: 't', date: 1, seats: [{ w: 1, n: 4, o: ['A', 'B'] }] },                                       // incompleta
  ];
  assert.deepStrictEqual(R.podsFrom(recs).map(p => p.c), [['A', 'B', 'C', 'D']]);
});

test('decisive: los empates salen del denominador y la tasa de empates se conserva', () => {
  const { decisive, metaWinRate } = require('../lib/stats');
  const recs = buildRecords(mockTournaments());
  const d = decisive(recs);
  const a = recs.find(r => r.draws > 0);
  const b = d.find(r => r.tid === a.tid && r.player === a.player);
  assert.strictEqual(b.games, a.wins + a.losses);
  assert.strictEqual(b.allGames, a.games);
  assert.ok(metaWinRate(d) > metaWinRate(recs), 'sin empates el winrate medio sube');
  const lc = commanderList(d, 5)[0], lr = commanderList(recs, 5).find(x => x.commander === lc.commander);
  assert.ok(Math.abs(lc.drawRate - lr.drawRate) < 1e-12, 'la tasa de empates no depende del modo');
  assert.ok(lc.winRate > lr.winRate);
});

test('classifyTournaments separa torneos cEDH de casuales por el contenido de los mazos', () => {
  const { classifyTournaments } = require('../lib/stats');
  const deck = (tid, name, cards) => ({ tid, tournament: name, date: 1, size: 20, cards: new Set(cards), wins: 1, losses: 1, draws: 0, games: 2, seats: [] });
  const staples = ['Mana Crypt', 'Chrome Mox', 'Force of Will', 'Mystical Tutor', 'Demonic Tutor', 'Rhystic Study', 'Ancient Tomb', 'Underground Sea', 'Badlands', 'Bayou'];
  const recs = [];
  for (let i = 0; i < 8; i++) recs.push(deck('c', 'Open sin etiqueta', [...staples, 'X' + i]));          // 10 staples por mazo
  for (let i = 0; i < 8; i++) recs.push(deck('k', 'Liga de los martes', ['Sol Ring', 'Y' + i]));          // 0 staples
  recs.push(deck('p', 'Precon Party', ['Sol Ring']));                                                      // pocos mazos: decide el nombre
  recs.push(deck('q', 'Torneo normal', ['Sol Ring']));
  classifyTournaments(recs);
  const by = t => recs.find(r => r.tid === t).comp;
  assert.strictEqual(by('c'), true);
  assert.strictEqual(by('k'), false);       // casual sin decirlo en el nombre
  assert.strictEqual(by('p'), false);       // pocos mazos + nombre casual
  assert.strictEqual(by('q'), true);        // pocos mazos + nombre neutro: se conserva
  assert.strictEqual(filterRecords(recs, { onlyCedh: true }).length, 9);
  assert.strictEqual(filterRecords(recs, {}).length, recs.length);
});

test('informe de lista: tabla completa, variante más parecida y listas reales parecidas', () => {
  const { neighborsReport } = require('../lib/stats');
  const recs = buildRecords(mockTournaments());
  const mine = recs.filter(r => r.key === KINNAN);
  const base = mine[0];                                       // una lista real, ya conocida
  const list = new Set([...base.cards]);
  const r = myListReport(recs, KINNAN, list);
  assert.ok(r.all.length > 20 && r.all.every((c, i) => i === 0 || r.all[i - 1].peer >= c.peer - 1e-12));
  assert.strictEqual(r.profile.standard + r.profile.common + r.profile.tech + r.profile.rare, r.all.length);
  const nb = neighborsReport(recs, KINNAN, list, { top: 5 });
  assert.ok(nb.length >= 1 && nb[0].similarity > 0.99, 'la lista idéntica sale como la más parecida');
  assert.ok(nb.every((x, i) => i === 0 || nb[i - 1].similarity >= x.similarity));
  assert.ok(nb.every(x => /^\d+-\d+-\d+$/.test(x.record) && !('player' in x)), 'sin nombres de jugadores');
  const v = variantsReport(recs, KINNAN, { k: 3, deckCards: list });
  assert.ok(v.yours && v.yours.index >= 0 && v.yours.typical.total > 0);
  assert.ok(v.yours.typical.have <= v.yours.typical.total);
  assert.strictEqual(variantsReport(recs, KINNAN, { k: 3 }).yours, null);
});

test('decisiveSeats conserva solo mesas con ganador y con todos los comandantes conocidos', () => {
  const { decisiveSeats } = require('../lib/stats');
  const mk = (key, seats, tid = 't1') => ({ key, tid, date: 1, size: 20, cards: new Set(), wins: 0, losses: 0, draws: 0, games: seats.length, seats });
  const recs = [
    // t1: mesa con ganador A y todos conocidos
    mk('A', [{ w: 1, n: 4, o: ['B', 'C', 'D'] }]), mk('B', [{ w: 0, n: 4, o: ['A', 'C', 'D'] }]),
    mk('C', [{ w: 0, n: 4, o: ['A', 'B', 'D'] }]), mk('D', [{ w: 0, n: 4, o: ['A', 'B', 'C'] }]),
    // t2: mesa EMPATADA (nadie gana): sus asientos no deben contar
    mk('A', [{ w: 0, n: 4, o: ['B', 'C', 'D'] }], 't2'), mk('B', [{ w: 0, n: 4, o: ['A', 'C', 'D'] }], 't2'),
    // t3: asiento con un rival desconocido: se descarta aunque haya ganado
    mk('A', [{ w: 1, n: 4, o: ['B', 'C'] }], 't3'),
  ];
  const out = decisiveSeats(recs);
  assert.deepStrictEqual(out.map(r => r.seats.length), [1, 1, 1, 1, 0, 0, 0]);
  assert.strictEqual(out[0].seats[0].w, 1);
  assert.strictEqual(recs[4].seats.length, 1, 'no modifica los datos originales');
});

test('buscador de cartas: el índice coincide con un recuento a fuerza bruta', () => {
  const { buildCardIndex, suggestCards, cardReport } = require('../lib/cardindex');
  const recs = buildRecords(mockTournaments());
  const idx = buildCardIndex(recs);
  const card = "Thassa's Oracle";
  const brute = recs.filter(r => r.cards.has(card));
  assert.strictEqual(idx.decks[idx.ids.get(card.toLowerCase())].length, brute.length);
  const rep = cardReport(idx, recs, card.toUpperCase(), {});         // sin distinguir mayúsculas
  assert.strictEqual(rep.card, card);
  assert.strictEqual(rep.decks, brute.length);
  assert.strictEqual(rep.total, recs.length);
  // por comandante
  const by = new Map(); for (const r of brute) by.set(r.key, (by.get(r.key) || 0) + 1);
  for (const c of rep.commanders) assert.strictEqual(c.decks, by.get(c.commander));
  assert.ok(rep.commanders.every((c, i) => i === 0 || rep.commanders[i - 1].decks >= c.decks));
  assert.strictEqual(rep.trend.length, 6);
  assert.ok(rep.together.every(x => x.card !== card && x.withCard >= 0.25 && x.lift > 0 === x.lift > 0));
  // el filtro de periodo se respeta
  const recent = cardReport(idx, recs, card, { days: 30 });
  const now = Date.now() / 1000;
  assert.strictEqual(recent.decks, brute.filter(r => r.date >= now - 30 * 86400).length);
  assert.strictEqual(cardReport(idx, recs, 'No existe zzz', {}), null);
});

test('buscador de cartas: las sugerencias priorizan lo que empieza por el texto y lo más jugado', () => {
  const { buildCardIndex, suggestCards } = require('../lib/cardindex');
  const mk = (cards, i) => ({ key: 'K', tid: 't', date: 1, size: 20, cards: new Set(cards), wins: 0, losses: 0, draws: 0, games: 1, seats: [], i });
  const recs = [mk(['Rhystic Study', 'Island']), mk(['Rhystic Study']), mk(['Rhystic Study', 'Mystic Remora']), mk(['Rhystic Tutor']), mk(['Mystic Remora', 'Tyrhysh'])];
  const idx = buildCardIndex(recs);
  assert.deepStrictEqual(suggestCards(idx, 'rhys').map(x => x.card), ['Rhystic Study', 'Rhystic Tutor', 'Tyrhysh']);
  assert.deepStrictEqual(suggestCards(idx, 'r'), [], 'menos de 2 letras no sugiere');
  assert.ok(!suggestCards(idx, 'isl').some(x => x.card === 'Island'), 'sin tierras básicas');
});

test('rendimiento: el índice y las consultas por carta caben en presupuestos de tiempo generosos', () => {
  const { buildCardIndex, cardReport } = require('../lib/cardindex');
  const recs = buildRecords(mockTournaments());
  const time = f => { const t = process.hrtime.bigint(); const r = f(); return [Number(process.hrtime.bigint() - t) / 1e6, r]; };
  const [msBuild, idx] = time(() => buildCardIndex(recs));
  assert.ok(msBuild < 3000, `construir el índice: ${msBuild.toFixed(0)} ms`);
  const [msCard] = time(() => cardReport(idx, recs, 'Sol Ring', { days: 90 }));
  assert.ok(msCard < 500, `informe de una carta muy jugada: ${msCard.toFixed(0)} ms`);
  const d = decisiveSeats(recs);
  const [msMu] = time(() => matchups(d, KINNAN, { minPods: 15 }));
  assert.ok(msMu < 500, `matchups con asientos ya preparados: ${msMu.toFixed(0)} ms`);
});
