'use strict';
// Prueba de integración: arranca el servidor en modo demo y comprueba lo que no cubren los tests de cálculo.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');
const http = require('node:http');

const PORT = 3990 + (process.pid % 50);
let child, dir;

function get(p, headers = {}, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port: PORT, path: p, method, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedh-srv-'));
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, MOCK: '1', PORT: String(PORT), DATA_DIR: dir }, stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) { try { await get('/api/status'); return; } catch { await new Promise(r => setTimeout(r, 200)); } }
  throw new Error('el servidor no arrancó');
});
test.after(() => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('las respuestas grandes se comprimen con gzip y se descomprimen igual', async () => {
  const name = encodeURIComponent('Kinnan, Bonder Prodigy');
  const plain = await get(`/api/commander?name=${name}&days=90`);
  const gz = await get(`/api/commander?name=${name}&days=90`, { 'Accept-Encoding': 'gzip' });
  assert.strictEqual(plain.status, 200);
  assert.strictEqual(gz.headers['content-encoding'], 'gzip');
  assert.ok(gz.body.length < plain.body.length / 3, `gzip ${gz.body.length} vs ${plain.body.length}`);
  assert.deepStrictEqual(JSON.parse(zlib.gunzipSync(gz.body)), JSON.parse(plain.body));
});

test('el servidor sigue vivo ante peticiones malformadas', async () => {
  assert.strictEqual((await get('/api/mylist', {}, 'POST', '{no es json')).status, 400);
  assert.strictEqual((await get('/api/commander?name=')).status, 404);
  assert.strictEqual((await get('/api/commander?name=' + encodeURIComponent('x'.repeat(5000)))).status, 404);
  assert.strictEqual((await get('/no/existe')).status, 404);
  assert.strictEqual((await get('/../../etc/passwd')).status, 404);
  assert.strictEqual((await get('/api/status')).status, 200); // sigue respondiendo
});

test('los cálculos pesados se guardan en memoria y dan el mismo resultado', async () => {
  const url = `/api/packages?name=${encodeURIComponent('Kinnan, Bonder Prodigy')}&days=90&dec=1`;
  const a = await get(url), b = await get(url);
  assert.strictEqual(a.status, 200);
  assert.deepStrictEqual(JSON.parse(b.body), JSON.parse(a.body));
});

test('matchups y matriz responden también en el modo «solo partidas con ganador»', async () => {
  for (const dec of [0, 1]) {
    const m = await get(`/api/matrix?top=8&days=180&dec=${dec}`);
    assert.strictEqual(m.status, 200);
    assert.ok(JSON.parse(m.body).commanders.length >= 2);
  }
  const mu = await get(`/api/matchups?name=${encodeURIComponent('Kinnan, Bonder Prodigy')}&days=180&dec=1`);
  assert.strictEqual(mu.status, 200);
});

test('buscador de cartas: sugerencias e informe por la API, con filtros y caché', async () => {
  const sug = JSON.parse((await get('/api/cards?q=' + encodeURIComponent('thassa'))).body);
  assert.ok(sug.length >= 1 && /thassa/i.test(sug[0].card));
  assert.deepStrictEqual(JSON.parse((await get('/api/cards?q=a')).body), []);
  const url = '/api/card?name=' + encodeURIComponent(sug[0].card) + '&days=180';
  const a = await get(url), b = await get(url);
  assert.strictEqual(a.status, 200);
  const rep = JSON.parse(a.body);
  assert.strictEqual(rep.card, sug[0].card);
  assert.ok(rep.decks > 0 && rep.commanders.length >= 1 && rep.trend.length === 6);
  assert.deepStrictEqual(JSON.parse(b.body), rep);
  assert.strictEqual((await get('/api/card?name=' + encodeURIComponent('Carta que no existe zzz'))).status, 404);
  assert.strictEqual((await get('/api/card')).status, 404);
});
