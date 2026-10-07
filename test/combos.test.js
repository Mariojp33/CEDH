'use strict';
// Combos y amenazas: análisis con mazos propios y flujo completo con un Commander Spellbook simulado.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const combosLib = require('../lib/combos');

const deck = cards => ({ cards: new Set(cards) });
const combo = (id, cards, effects) => ({ id, url: 'https://commanderspellbook.com/combo/' + id, cards, effects, steps: 'pasos ' + id, prerequisites: '', mana: '', popularity: 10 });

test('summarize: agrupa en líneas por pieza clave, separa victorias de motores y cuenta el uso', () => {
  // 100 mazos: 90 con Oracle+Consultation (victoria), 40 con Motor+Sol Ring, 5 con algo raro. Todos llevan Sol Ring y al comandante.
  const decks = [];
  for (let i = 0; i < 100; i++) {
    const c = ['Cmd', 'Sol Ring'];
    if (i < 90) c.push("Thassa's Oracle", 'Demonic Consultation');
    if (i % 5 < 2) c.push('Motor');                // 40 %
    if (i < 3) c.push('Rarita');                   // 3 %
    decks.push(deck(c));
  }
  const cs = [
    combo('a', ["Thassa's Oracle", 'Demonic Consultation'], [{ name: 'Win the game', status: 'S' }]),
    combo('b', ['Motor', 'Sol Ring'], [{ name: 'Infinite colorless mana', status: 'S' }]),
    combo('c', ['Motor', 'Sol Ring', 'Cmd'], [{ name: 'Infinite storm count', status: 'H' }]),
    combo('d', ['Rarita', 'Sol Ring'], [{ name: 'Infinite mana', status: 'S' }]),       // 3 %: por debajo del mínimo de 5 mazos
    combo('e', ['No Esta En Ningun Mazo', 'Sol Ring'], [{ name: 'Win the game', status: 'S' }]),
  ];
  const r = combosLib.summarize(cs, decks, ['Cmd']);
  assert.strictEqual(r.totalCombos, 5);
  assert.strictEqual(r.shown, 3, 'solo los combos que se juegan de verdad (a, b, c)');
  const keys = r.lines.map(l => l.key);
  assert.ok(keys.includes("Thassa's Oracle") || keys.includes('Demonic Consultation'));
  assert.ok(keys.includes('Motor'), 'la pieza clave es la menos común del combo (Motor, no Sol Ring)');
  assert.ok(!keys.includes('Sol Ring') && !keys.includes('Rarita'));
  const win = r.lines.find(l => l.kind === 'win'), motor = r.lines.find(l => l.key === 'Motor');
  assert.ok(win && Math.abs(win.usage - 0.9) < 1e-9);
  assert.strictEqual(motor.kind, 'engine');
  assert.strictEqual(motor.combos, 2, 'los dos combos de Motor forman una sola línea');
  assert.ok(Math.abs(motor.usage - 0.4) < 1e-9);
  assert.strictEqual(r.lines[0].kind, 'win', 'las victorias van primero');
  assert.ok(motor.enablers.some(e => e.card === 'Sol Ring') && motor.best[0].steps.startsWith('pasos'));
  // 90 con la victoria + 4 con el motor que no la llevan (i = 90, 91, 95, 96) = 94 mazos con algún combo
  assert.ok(Math.abs(r.coverage - 0.94) < 1e-9, 'cobertura ' + r.coverage);
  // Las piezas genéricas del meta no cuentan como piezas clave
  const r2 = combosLib.summarize(cs, decks, ['Cmd'], { metaShare: c => c === 'Sol Ring' ? 0.95 : 0.1 });
  assert.ok(!r2.keyPieces.some(p => p.card === 'Sol Ring') && r.keyPieces.some(p => p.card === 'Sol Ring'));
  assert.deepStrictEqual(combosLib.summarize(cs, [], ['Cmd']).lines, []);
});

test('kindOf y unionRequest', () => {
  assert.strictEqual(combosLib.kindOf(combo('x', ['A'], [{ name: "Exile each opponent's library", status: 'S' }])), 'win');
  assert.strictEqual(combosLib.kindOf(combo('x', ['A'], [{ name: 'Infinite mana', status: 'S' }])), 'engine');
  assert.strictEqual(combosLib.kindOf(combo('x', ['A'], [{ name: 'Infinite ETB', status: 'H' }])), 'helper');
  const decks = Array.from({ length: 20 }, (_, i) => deck(['Cmd', 'Todos', 'Island', i < 4 ? 'Poco' : 'Otro' + i]));
  const q = combosLib.unionRequest(decks, ['Cmd'], new Set(['island']));
  assert.ok(q.main.some(m => m.card === 'Todos') && q.main.some(m => m.card === 'Poco'), '≥ 10 % de los mazos');
  assert.ok(!q.main.some(m => m.card === 'Island' || m.card === 'Cmd' || m.card.startsWith('Otro')));
  assert.deepStrictEqual(q.commanders, [{ card: 'Cmd', quantity: 1 }]);
});

// ---- Servidor con un Spellbook simulado ----
let fake, hits = 0, mode = 'ok', child, dir;
const PORT = 4400 + (process.pid % 40), FAKE = PORT + 100;
const get = p => new Promise((resolve, reject) => {
  http.get({ port: PORT, path: p }, res => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() })); }).on('error', reject);
});
const variant = (id, names, feats) => ({ id, description: 'paso 1\npaso 2', easyPrerequisites: '', notablePrerequisites: '', manaNeeded: '', popularity: 5,
  uses: names.map(n => ({ card: { name: n } })), produces: feats.map(([name, status]) => ({ feature: { name, status }, quantity: 1 })) });

test.before(async () => {
  fake = http.createServer((req, res) => {
    if (req.url !== '/find-my-combos' || req.method !== 'POST') { res.writeHead(404); return res.end(); }
    hits++;
    let body = ''; req.on('data', c => { body += c; });
    req.on('end', () => {
      const asked = JSON.parse(body);
      setTimeout(() => {
        if (mode === 'error') { res.writeHead(500); return res.end('boom'); }
        if (mode === 'limit') { res.writeHead(429); return res.end('slow down'); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ count: null, results: { identity: 'U', included: [
          variant('1-2', ["Thassa's Oracle", 'Demonic Consultation'], [['Win the game', 'S']]),
          variant('3-4', ['Sol Ring', "Thassa's Oracle"], [['Infinite mana', 'S']]),
        ], almostIncluded: [], _asked: asked.main.length } }));
      }, 250);
    });
  });
  await new Promise(r => fake.listen(FAKE, r));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedh-combos-'));
  const env = { ...process.env, MOCK: '1', PORT: String(PORT), DATA_DIR: dir, COMBOS_API: `http://localhost:${FAKE}` };
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { await get('/api/status'); return; } catch { await new Promise(r => setTimeout(r, 200)); } }
  throw new Error('el servidor no arrancó');
});
test.after(() => { child.kill(); fake.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('API de combos: consulta una vez, guarda el resultado y cruza con los mazos', async () => {
  const name = encodeURIComponent('Kinnan, Bonder Prodigy');
  const a = await get(`/api/combos?name=${name}&days=180`);
  assert.strictEqual(a.status, 200);
  const j = JSON.parse(a.body);
  assert.strictEqual(j.commander, 'Kinnan, Bonder Prodigy');
  assert.ok(j.decks > 50 && Array.isArray(j.lines) && j.totalCombos === 2);
  assert.ok(j.lines.some(l => l.kind === 'win'), 'la línea de victoria se detecta');
  assert.strictEqual(hits, 1);
  const b = await get(`/api/combos?name=${name}&days=90`);            // otro periodo: se recalcula el uso, no se vuelve a consultar
  assert.strictEqual(b.status, 200);
  assert.strictEqual(hits, 1, 'segunda consulta sin llamar a Spellbook');
});

test('API de combos: dos consultas simultáneas comparten una sola petición', async () => {
  const name = encodeURIComponent('Kraum, Ludevic\'s Opus / Tymna the Weaver');
  const before = hits;
  const [a, b] = await Promise.all([get(`/api/combos?name=${name}&days=180`), get(`/api/combos?name=${name}&days=180`)]);
  assert.strictEqual(a.status, 200); assert.strictEqual(b.status, 200);
  assert.strictEqual(hits - before, 1);
});

test('API de combos: errores de Spellbook y datos insuficientes se explican sin tumbar nada', async () => {
  mode = 'error';
  const e = await get(`/api/combos?name=${encodeURIComponent('Sisay, Weatherlight Captain')}&days=180`);
  assert.strictEqual(e.status, 502); assert.match(JSON.parse(e.body).error, /Commander Spellbook/);
  mode = 'limit';
  const l = await get(`/api/combos?name=${encodeURIComponent('Rograkh, Son of Rohgahh / Thrasios, Triton Hero')}&days=180`);
  assert.strictEqual(l.status, 503); assert.match(JSON.parse(l.body).error, /limitando/);
  mode = 'ok';
  assert.strictEqual((await get('/api/combos?name=Comandante%20Inventado&days=180')).status, 404);
  assert.strictEqual((await get('/api/combos')).status, 404);
  assert.strictEqual((await get('/api/status')).status, 200);
});
