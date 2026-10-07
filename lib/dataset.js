'use strict';
// Operaciones sobre el conjunto de mazos que comparten el servidor y el script que renueva el seed:
// quedarse solo con los torneos cEDH y unir lo recién descargado con lo que ya había.
const { classifyTournaments } = require('./stats');

// Marca los torneos (cEDH o no) y devuelve solo los cEDH. De los demás solo se recuerda cuántos mazos tenía
// cada uno (en `excluded`: tid -> nº de mazos), para poder avisar de ello. `keepAll` los conserva (depuración).
function splitCedh(records, excluded, { keepAll = false } = {}) {
  classifyTournaments(records);
  if (keepAll) return records;
  const batch = new Map(), kept = [];
  for (const r of records) {
    if (r.comp === false) batch.set(r.tid, (batch.get(r.tid) || 0) + 1); else kept.push(r);
  }
  for (const [tid, n] of batch) excluded.set(tid, n);
  return kept;
}

// Une lo descargado con lo que ya había: un torneo descargado sustituye a su versión anterior (pudo cambiar) y
// se descarta lo que queda fuera del periodo (`cutoff`, en segundos). `keepOld` conserva todo lo anterior.
function mergeFresh(old, fresh, { cutoff, keepOld = false } = {}) {
  const tids = new Set(fresh.map(r => r.tid));
  return old.filter(r => !tids.has(r.tid) && (keepOld || r.date >= cutoff)).concat(fresh);
}

module.exports = { splitCedh, mergeFresh };
