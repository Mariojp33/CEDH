'use strict';
// Renueva el seed (seed/records.json): carga el actual, descarga de TopDeck solo los días que faltan, lo une y lo
// vuelve a guardar. Lo usa el script `npm run seed:update`, que ejecuta cada pocos días una tarea de GitHub Actions.
const fs = require('node:fs');
const cache = require('./cache');
const { buildRecords } = require('./stats');
const dataset = require('./dataset');
const topdeck = require('./topdeck');

async function updateSeed({
  file, apiKey, maxDays = 180, windowDays = 3, participantMin = 16, minKeep = 0.9,
  fetchTournaments = topdeck.fetchTournaments, now = Date.now(), log = console.log,
}) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const decoded = cache.decodeAny(j);
  if (!decoded) throw new Error('Formato de seed no reconocido');
  const excluded = new Map(j.excluded || []);
  const records = dataset.splitCedh(decoded, excluded);
  const covered = j.days || maxDays;
  const full = covered < maxDays; // el seed cubre menos días de los pedidos: se descarga todo el periodo
  const days = full ? maxDays : cache.refreshDays(j.updatedAt, maxDays, { now });
  log(`Seed actual: ${records.length} mazos cEDH, datos de ${j.updatedAt}. Se descargan ${days} días.`);

  let fresh = [];
  await fetchTournaments({
    apiKey, days, participantMin, windowDays,
    onBatch: batch => { fresh.push(...cache.interned(buildRecords(batch))); }, // cada ventana se reduce al momento
    onProgress: p => log(`Descargando ${p.done}/${p.total} ventanas, ${p.tournaments} torneos`),
  });
  fresh = dataset.splitCedh(fresh, excluded);
  const merged = dataset.mergeFresh(records, fresh, { cutoff: Math.floor(now / 1000) - maxDays * 86400 });

  // Comprobación de cordura: no se guarda un seed que haya perdido buena parte de los datos
  if (!full && merged.length < records.length * minKeep) {
    throw new Error(`El seed nuevo tendría ${merged.length} mazos frente a los ${records.length} actuales: no se guarda`);
  }
  const updatedAt = new Date(now).toISOString();
  const tmp = file + '.tmp';
  cache.writeStream(fs, tmp, { updatedAt, days: full ? maxDays : covered, excluded: [...excluded] }, merged);
  fs.renameSync(tmp, file);
  const summary = { before: records.length, after: merged.length, fresh: fresh.length, days, updatedAt, excludedTournaments: excluded.size };
  log(`Seed guardado: ${summary.after} mazos (${summary.after - summary.before >= 0 ? '+' : ''}${summary.after - summary.before}), ${summary.excludedTournaments} torneos no cEDH recordados.`);
  return summary;
}

module.exports = { updateSeed };
