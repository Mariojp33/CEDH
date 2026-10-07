'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cache = require('../lib/cache');
const dataset = require('../lib/dataset');
const { buildRecords } = require('../lib/stats');
const { mockTournaments } = require('../lib/mock');
const { updateSeed } = require('../lib/seedupdate');

const rec = (tid, date, extra = {}) => ({ key: 'K', tid, tournament: tid, date, size: 20, player: 'p', games: 2, wins: 1, draws: 0, losses: 1, cards: new Set(['A']), seats: [], ...extra });

test('mergeFresh: lo descargado sustituye a su torneo anterior y se descarta lo que sale del periodo', () => {
  const old = [rec('t1', 100), rec('t1', 100), rec('t2', 200), rec('viejo', 5)];
  const fresh = [rec('t1', 100, { wins: 2 }), rec('t3', 300)];
  const out = dataset.mergeFresh(old, fresh, { cutoff: 50 });
  assert.deepStrictEqual(out.map(r => r.tid).sort(), ['t1', 't2', 't3']);          // t1 una vez (la nueva); 'viejo' fuera
  assert.strictEqual(out.find(r => r.tid === 't1').wins, 2);
  assert.strictEqual(dataset.mergeFresh(old, fresh, { cutoff: 50, keepOld: true }).length, 4);
});

test('splitCedh: se queda con los torneos cEDH y recuerda cuántos mazos tenían los demás', () => {
  const staples = ['Mana Crypt', 'Chrome Mox', 'Force of Will', 'Mystical Tutor', 'Demonic Tutor', 'Rhystic Study', 'Ancient Tomb', 'Underground Sea', 'Badlands'];
  const recs = [];
  for (let i = 0; i < 6; i++) recs.push(rec('cedh', 1, { tournament: 'Open', cards: new Set([...staples, 'X' + i]) }));
  for (let i = 0; i < 6; i++) recs.push(rec('casual', 1, { tournament: 'Liga de los martes', cards: new Set(['Sol Ring', 'Y' + i]) }));
  const excluded = new Map();
  const kept = dataset.splitCedh(recs, excluded);
  assert.strictEqual(kept.length, 6);
  assert.deepStrictEqual([...excluded], [['casual', 6]]);
  assert.strictEqual(dataset.splitCedh(recs, new Map(), { keepAll: true }).length, 12);
});

// Seed de partida: los torneos de demostración, con la fecha de datos en el pasado
function makeSeed(dir, { updatedAt, days = 180, shiftDays = 0 } = {}) {
  const recs = buildRecords(mockTournaments());
  for (const r of recs) r.date -= shiftDays * 86400;
  const file = path.join(dir, 'records.json');
  cache.writeStream(fs, file, { updatedAt, days, excluded: [['viejo-casual', 10]] }, recs);
  return { file, recs };
}

test('updateSeed: descarga solo los días que faltan, une, guarda y conserva lo recordado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedh-seed-'));
  try {
    const now = Date.now();
    const { file, recs } = makeSeed(dir, { updatedAt: new Date(now - 5 * 86400000).toISOString() });
    const before = JSON.parse(fs.readFileSync(file, 'utf8'));
    let asked = null;
    const fakeFetch = async opts => {      // simula la API: entrega 20 torneos nuevos en una ventana
      asked = opts;
      const nuevos = mockTournaments().slice(0, 20).map(t => ({ ...t, TID: 'nuevo-' + t.TID }));
      await opts.onBatch(nuevos);
      opts.onProgress({ done: 1, total: 1, tournaments: nuevos.length });
    };
    const out = await updateSeed({ file, apiKey: 'k', fetchTournaments: fakeFetch, now, log: () => {}, minKeep: 0 });
    assert.strictEqual(asked.days, 7, '5 días desde el seed + 2 de margen');
    assert.strictEqual(asked.windowDays, 3);
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(after.version, cache.VERSION);
    assert.strictEqual(after.updatedAt, new Date(now).toISOString());
    assert.ok(after.updatedAt > before.updatedAt);
    assert.ok(after.excluded.some(([tid]) => tid === 'viejo-casual'), 'conserva los torneos no cEDH ya recordados');
    const back = cache.decodeAny(after);
    assert.ok(back.some(r => String(r.tid).startsWith('nuevo-')), 'incluye lo recién descargado');
    assert.strictEqual(back.length, out.after);
    assert.ok(back.length > 0 && fs.readdirSync(dir).every(f => !f.endsWith('.tmp')), 'no deja archivos temporales');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('updateSeed: no guarda un seed que perdería casi todos los datos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedh-seed-'));
  try {
    const now = Date.now();
    // Datos con 400 días de antigüedad: al aplicar el periodo de 180 días se descartarían casi todos
    const { file } = makeSeed(dir, { updatedAt: new Date(now - 86400000).toISOString(), shiftDays: 400 });
    const original = fs.readFileSync(file, 'utf8');
    await assert.rejects(updateSeed({ file, apiKey: 'k', fetchTournaments: async () => {}, now, log: () => {} }), /no se guarda/);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), original, 'el seed original queda intacto');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('updateSeed: si el seed cubre menos días de los pedidos, descarga todo el periodo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedh-seed-'));
  try {
    const now = Date.now();
    const { file } = makeSeed(dir, { updatedAt: new Date(now - 86400000).toISOString(), days: 90 });
    let asked = null;
    await updateSeed({ file, apiKey: 'k', maxDays: 180, fetchTournaments: async o => { asked = o; }, now, log: () => {}, minKeep: 0 });
    assert.strictEqual(asked.days, 180);
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).days, 180);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
