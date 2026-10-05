'use strict';
// Crea seed/records.json a partir de la caché local (data/records.json) para incluirla en el repositorio.
//   node scripts/make-seed.js [--days 180] [--from ruta/records.json]
// Úsalo con la caché de tu ordenador ya actualizada; el servidor en Render la cargará al arrancar.
const fs = require('node:fs');
const path = require('node:path');
const cache = require('../lib/cache');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const from = arg('--from', path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'records.json'));
const days = Number(arg('--days', 0));
const out = path.join(__dirname, '..', 'seed', 'records.json');

const j = JSON.parse(fs.readFileSync(from, 'utf8'));
let records = cache.decodeAny(j);
if (!records) { console.error('Formato de caché no reconocido'); process.exit(1); }
if (days) {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  records = records.filter(r => r.date >= cutoff);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
cache.writeStream(fs, out, { updatedAt: j.updatedAt, days: days ? Math.min(days, j.days || days) : (j.days || 90) }, records);
const mb = fs.statSync(out).size / 1048576;
console.log(`seed/records.json: ${records.length} mazos, ${mb.toFixed(1)} MB, datos de ${j.updatedAt}`);
if (mb > 90) console.warn('Cuidado: GitHub rechaza archivos de más de 100 MB. Usa --days para reducirlo.');
