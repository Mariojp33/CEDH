'use strict';
// Arranque del servidor sin clave de TopDeck y con el seed publicado en una release de GitHub (simulada).
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cache = require('../lib/cache');
const { buildRecords } = require('../lib/stats');
const { mockTournaments } = require('../lib/mock');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = (port, p) => new Promise((resolve, reject) => {
  http.get({ port, path: p }, res => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() })); }).on('error', reject);
});

// Arranca el servidor SIN clave y sin MOCK; devuelve su log y un método para pararlo
async function start(port, env, before) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedh-load-'));
  if (before) before(dir);                                // para dejar una caché previa en la carpeta de datos
  const e = { ...process.env, PORT: String(port), DATA_DIR: dir, ...env };
  delete e.TOPDECK_API_KEY; delete e.MOCK;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: e, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 80; i++) { try { await get(port, '/api/status'); break; } catch { await sleep(150); } }
  return { child, dir, log: () => log, stop: () => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('sin TOPDECK_API_KEY el servidor no se cae: sirve el seed y avisa de que no se actualiza', async () => {
  const s = await start(4101, { SEED_URL: '' });          // sin descarga remota: usa la copia del repositorio
  try {
    const st = JSON.parse((await get(4101, '/api/status')).body);
    assert.ok(st.decks > 1000, 'responde con datos del seed');
    assert.match(String(st.error), /Sin clave de TopDeck/);
    assert.match(s.log(), /Falta TOPDECK_API_KEY/);
    assert.match(s.log(), /copia del repositorio/);
    assert.strictEqual((await get(4101, '/api/commanders?days=90')).status, 200);
  } finally { s.stop(); }
});

test('al arrancar descarga el seed publicado y lo prefiere al del repositorio', async () => {
  // «Release» simulada: un seed pequeño reconocible (mazos de demostración con una fecha de datos propia)
  const recs = buildRecords(mockTournaments()).slice(0, 3000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedh-rel-'));
  const file = path.join(dir, 'records.json');
  cache.writeStream(fs, file, { updatedAt: '2030-01-02T03:04:05.000Z', days: 180, excluded: [] }, recs);
  const srv = http.createServer((req, res) => {
    if (req.url !== '/records.json') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => srv.listen(4102, r));
  const s = await start(4103, { SEED_URL: 'http://localhost:4102/records.json' });
  try {
    assert.match(s.log(), /Caché cargada \(seed descargado de GitHub\): \d+ mazos \(2030-01-02/);
    const st = JSON.parse((await get(4103, '/api/status')).body);
    assert.strictEqual(st.updatedAt, '2030-01-02T03:04:05.000Z');
  } finally { s.stop(); srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('si el seed publicado no existe o está roto, se usa el del repositorio', async () => {
  for (const [port, mode] of [[4104, '404'], [4106, 'roto']]) {
    const srv = http.createServer((req, res) => {
      if (mode === '404') { res.writeHead(404); return res.end('no existe'); }
      res.writeHead(200); res.end('{esto no es json');
    });
    await new Promise(r => srv.listen(port + 1, r));
    const s = await start(port + 10, { SEED_URL: `http://localhost:${port + 1}/records.json` });
    try {
      assert.match(s.log(), /No se pudo usar el origen \(seed descargado de GitHub\)/);
      assert.match(s.log(), /Caché cargada \(copia del repositorio\)/);
      assert.strictEqual((await get(port + 10, '/api/status')).status, 200);
    } finally { s.stop(); srv.close(); }
  }
});

test('si no hay conexión con el seed publicado, el arranque no se queda esperando', async () => {
  const t = Date.now();
  const s = await start(4120, { SEED_URL: 'http://localhost:9/records.json' });   // puerto cerrado
  try {
    assert.match(s.log(), /Caché cargada \(copia del repositorio\)/);
    assert.ok(Date.now() - t < 10000, 'arranca en menos de 10 s');
  } finally { s.stop(); }
});


// Una caché antigua (sin la posición final de los mazos) no debe tapar a un seed publicado que sí la tiene
const oldCache = (dir, updatedAt) => {
  const recs = buildRecords(mockTournaments()).slice(0, 3000);
  for (const r of recs) delete r.rank;
  cache.writeStream(fs, path.join(dir, 'records.json'), { updatedAt, days: 180, excluded: [] }, recs);
};

test('una caché sin posiciones se descarta si el seed publicado las trae', async () => {
  const recs = buildRecords(mockTournaments()).slice(0, 3000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedh-rel-'));
  const file = path.join(dir, 'records.json');
  cache.writeStream(fs, file, { updatedAt: '2031-01-02T03:04:05.000Z', days: 180, excluded: [] }, recs);
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); fs.createReadStream(file).pipe(res); });
  await new Promise(r => srv.listen(4104, r));
  const s = await start(4105, { SEED_URL: 'http://localhost:4104/records.json' }, d => oldCache(d, '2029-05-05T00:00:00.000Z'));
  try {
    assert.match(s.log(), /sin posiciones de torneo/);
    assert.match(s.log(), /seed descargado de GitHub\): \d+ mazos \(2031-01-02/);
    const t = JSON.parse((await get(4105, '/api/tournaments?days=0&limit=1')).body);
    assert.ok(t.ranked > 1000, 'ya hay puestos: ' + t.ranked);
  } finally { s.stop(); srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('si ningún origen tiene posiciones se usa el primero válido (la caché) en vez de fallar', async () => {
  const s = await start(4106, { SEED_URL: '' }, d => oldCache(d, '2029-05-05T00:00:00.000Z'));
  try {
    const st = JSON.parse((await get(4106, '/api/status')).body);
    assert.strictEqual(st.updatedAt, '2029-05-05T00:00:00.000Z', 'se quedó con la caché, que tiene prioridad');
    assert.ok(st.decks > 1000);
  } finally { s.stop(); }
});
