'use strict';
// Servidor sin dependencias: descarga torneos de TopDeck.gg, los cachea y sirve estadísticas por comandante.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { fetchTournaments } = require('./lib/topdeck');
const { buildRecords } = require('./lib/stats');
const cache = require('./lib/cache');
const dataset = require('./lib/dataset');
const { buildCardIndexAsync } = require('./lib/cardindex');
const { createHandler } = require('./lib/routes');
const { SECURITY_HEADERS, fail } = require('./lib/http');
const combos = require('./lib/combos');
const { mockTournaments } = require('./lib/mock');

const PORT = Number(process.env.PORT) || 3000;
const MOCK = process.env.MOCK === '1';
// La clave de TopDeck solo se lee del entorno (en Render: Environment → TOPDECK_API_KEY). Nunca va en el código.
const API_KEY = process.env.TOPDECK_API_KEY;
const DAYS = Number(process.env.DAYS) || 180; // máximo que se puede elegir en la web (6 meses)
const PARTICIPANT_MIN = Number(process.env.PARTICIPANT_MIN) || 16;
// Ventana de descarga en días: más pequeña = menos memoria por petición (más peticiones, 100/min permitidas).
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS) || 3;
const REFRESH_HOURS = Number(process.env.REFRESH_HOURS) || 6;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'records.json');
// Copia de la caché incluida en el repositorio (npm run seed). Sirve de punto de partida cuando el disco
// no persiste (p. ej. Render gratis): se carga al instante y solo se descargan los días que faltan.
const SEED_FILE = process.env.SEED_FILE || path.join(__dirname, 'seed', 'records.json'); // copia local opcional (carpeta ignorada por git)
const PUBLIC = path.join(__dirname, 'public');
// Seed publicado por la tarea programada de GitHub como archivo de una «release» (que se sobrescribe en cada
// ejecución y no engorda el historial de git). Al arrancar sin caché en disco se descarga de ahí; si falla,
// se usa la copia del repositorio. SEED_URL='' lo desactiva.
const DEFAULT_SEED_URL = 'https://github.com/Mariojp33/CEDH/releases/download/seed/records.json';
const SEED_URL = process.env.SEED_URL === undefined ? DEFAULT_SEED_URL : process.env.SEED_URL;

if (!MOCK && !API_KEY) {
  // Sin clave el servidor no se cae: sirve los datos del seed y avisa de que no puede actualizarse.
  console.warn('Falta TOPDECK_API_KEY (consíguela gratis en https://topdeck.gg/developers): se usarán solo los datos del seed, sin actualizaciones.');
}

// Estado en memoria. Los registros se guardan con `cards` como array para poder serializarlos.
let state = { records: [], updatedAt: null, refreshing: false, error: null, coveredDays: 0, index: null, indexPromise: null };
// Índice carta -> mazos (buscador). Se rehace en segundo plano cada vez que cambian los registros (al cargar y al
// actualizar), sin retrasar el arranque; las peticiones del buscador esperan a que esté listo.
function rebuildIndex() {
  const records = state.records, t = Date.now();
  state.index = null;
  state.indexPromise = buildCardIndexAsync(records).then(ix => {
    if (state.records !== records) return state.index;      // los datos cambiaron mientras tanto: otro índice viene detrás
    state.index = ix;
    console.log(`Índice de cartas listo: ${ix.names.length} cartas en ${((Date.now() - t) / 1000).toFixed(1)} s`);
    return ix;
  });
  return state.indexPromise;
}
const mb = () => Math.round(process.memoryUsage().rss / 1048576) + ' MB';
const T0 = Date.now();

// Solo se conservan los torneos cEDH. Los demás (casuales, precons, presupuesto, brawl…) se descartan al cargar
// y al descargar; solo se recuerda cuántos mazos tenía cada uno para poder avisar de ello en la web.
// ALL_TOURNAMENTS=1 los conserva (solo depuración).
const KEEP_ALL = process.env.ALL_TOURNAMENTS === '1';
const excluded = new Map(); // tid -> nº de mazos
function keepCedh(records) { return dataset.splitCedh(records, excluded, { keepAll: KEEP_ALL }); }

// La caché se guarda en formato compacto (lib/cache.js, v4). Se siguen leyendo las v3 anteriores.

async function fetchRemoteSeed(url, timeoutMs = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'cedh-stats' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return JSON.parse(await res.text());
  } finally { clearTimeout(timer); }
}

// Orígenes de los datos, por orden: caché en disco, seed publicado en GitHub, seed del repositorio.
async function loadCache() {
  const sources = [
    { label: '', get: async () => JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) },
    ...(SEED_URL ? [{ label: ' (seed descargado de GitHub)', get: () => fetchRemoteSeed(SEED_URL) }] : []),
    { label: ' (copia local)', get: async () => JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')) },
  ];
  // Una caché o un seed guardado antes de que se guardara la posición final de cada mazo no la tiene: se prefiere cualquier
  // otro origen que sí la tenga (por ejemplo el seed publicado en GitHub), y solo si no hay ninguno se usa el primero válido.
  const obsolete = raw => raw.filter(r => r.rank).length < raw.length * 0.5;   // `raw`: registros tal como están en el archivo
  let fallback = null;
  const apply = ({ label, j, records }) => {
    for (const [tid, n] of j.excluded || []) excluded.set(tid, n);
    // Un seed guardado por esta versión ya viene filtrado (lleva la lista `excluded`): no hace falta volver a clasificar
    state.records = Array.isArray(j.excluded) ? records : keepCedh(records);
    rebuildIndex();
    state.updatedAt = j.updatedAt;
    state.coveredDays = j.days || 90; // las cachés anteriores solo guardaban 90 días
    console.log(`Caché cargada${label}: ${state.records.length} mazos (${j.updatedAt}) · listo en ${((Date.now() - T0) / 1000).toFixed(1)} s · memoria ${mb()}`);
  };
  for (const { label, get } of sources) {
    try {
      let j = await get();
      // Se comprueba sobre los datos crudos, antes de decodificarlos: decodificar un seed entero ocupa mucha memoria
      if (!j || !Array.isArray(j.records) || j.records.length < 100) { console.log(`Datos${label} no válidos: se prueba el siguiente origen`); continue; }
      if (obsolete(j.records)) {
        console.log(`Datos${label} sin posiciones de torneo (versión anterior): se busca un origen más reciente`);
        fallback = fallback || { label, get };   // solo se recuerda cómo volver a leerla: no se mantiene en memoria mientras se prueba el resto
        j = null;
        continue;
      }
      const records = cache.decodeAny(j);
      if (!records || records.length < 100) { console.log(`Datos${label} no válidos: se prueba el siguiente origen`); continue; }
      return apply({ label, j, records });
    } catch (e) {
      // El primero (caché en disco) falla siempre en una instalación nueva: solo se comenta el resto
      if (label) console.log(`No se pudo usar el origen${label}: ${e.message}`);
    }
  }
  if (fallback) {
    try { const j = await fallback.get(); apply({ label: fallback.label, j, records: cache.decodeAny(j) }); }
    catch (e) { console.log(`No se pudo volver a leer los datos${fallback.label}: ${e.message}`); }
  }
}

function saveCache() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Se escribe a un archivo temporal y se renombra: un corte a mitad no deja la caché a medias.
  const tmp = CACHE_FILE + '.tmp';
  cache.writeStream(fs, tmp, { updatedAt: state.updatedAt, days: state.coveredDays, excluded: [...excluded] }, state.records);
  fs.renameSync(tmp, CACHE_FILE);
}

let retryTimer = null;
async function refresh() {
  if (state.refreshing) return;
  if (!MOCK && !API_KEY) {
    state.error = 'Sin clave de TopDeck: se muestran los datos del seed, sin actualización en directo';
    return;
  }
  const t0 = Date.now();
  state.refreshing = true;
  try {
    // Si la caché cubre menos días de los pedidos (p. ej. se subió DAYS), se descarga todo el periodo.
    const firstLoad = state.records.length === 0 || state.coveredDays < DAYS;
    // Primera carga: todo el periodo. Después solo los días transcurridos desde la última actualización.
    const days = firstLoad ? DAYS : cache.refreshDays(state.updatedAt, DAYS);
    // Cada ventana descargada se convierte enseguida en registros compactos y se descarta el resto,
    // para que el pico de memoria sea el de una ventana y no el de todo el histórico.
    let fresh = [];
    if (MOCK) fresh.push(...cache.interned(buildRecords(mockTournaments())));
    else {
      await fetchTournaments({
        apiKey: API_KEY, days, participantMin: PARTICIPANT_MIN, windowDays: WINDOW_DAYS,
        onBatch: batch => { fresh.push(...cache.interned(buildRecords(batch))); },
        onProgress: p => console.log(`Descargando ${p.done}/${p.total} ventanas, ${p.tournaments} torneos`),
      });
    }
    fresh = keepCedh(fresh);
    const cutoff = Math.floor(Date.now() / 1000) - DAYS * 86400;
    state.records = dataset.mergeFresh(state.records, fresh, { cutoff, keepOld: MOCK });
    rebuildIndex();
    state.updatedAt = new Date().toISOString();
    if (firstLoad) state.coveredDays = DAYS;
    state.error = null;
    if (!MOCK) saveCache();
    console.log(`Actualizado: ${state.records.length} mazos · ${Math.round((Date.now() - t0) / 1000)} s de descarga y proceso · memoria ${mb()}`);
  } catch (e) {
    state.error = e.message;
    console.error('Error al actualizar:', e.message);
    // Reintento en 10 minutos (si no, la siguiente actualización sería dentro de REFRESH_HOURS)
    if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; refresh(); }, 10 * 60 * 1000).unref();
  } finally {
    state.refreshing = false;
  }
}

const handle = createHandler({ state, excluded, config: { MOCK, DAYS, PARTICIPANT_MIN, COMBOS_API: process.env.COMBOS_API || combos.DEFAULT_API, PUBLIC } });
const server = http.createServer((req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  try { handle(req, res); } catch (e) { fail(res, e); }
});
// Red de seguridad para errores fuera de una petición (por ejemplo en una actualización)
process.on('uncaughtException', e => console.error('Error no controlado:', e && e.stack || e));
process.on('unhandledRejection', e => console.error('Promesa rechazada:', e && e.stack || e));

loadCache().then(() => {
  server.listen(PORT, () => console.log(`http://localhost:${PORT} ${MOCK ? '(modo demo)' : ''}`));
  refresh();
  setInterval(refresh, REFRESH_HOURS * 3600 * 1000).unref();
});
