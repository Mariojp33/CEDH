'use strict';
// Servidor sin dependencias: descarga torneos de TopDeck.gg, los cachea y sirve estadísticas por comandante.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { fetchTournaments } = require('./lib/topdeck');
const { buildRecords, filterRecords, commanderList, commanderReport, myListReport, trendReport, synergyReport, variantsReport, matchups, matrix, cardsVsOpponent } = require('./lib/stats');
const cache = require('./lib/cache');
const { parseText } = require('./lib/parse');
const { mockTournaments } = require('./lib/mock');

const PORT = Number(process.env.PORT) || 3000;
const MOCK = process.env.MOCK === '1';
const API_KEY = '73d1500b-e4d1-4981-857d-74a6e8ec2541';
const DAYS = Number(process.env.DAYS) || 180; // máximo que se puede elegir en la web (6 meses)
const PARTICIPANT_MIN = Number(process.env.PARTICIPANT_MIN) || 16;
// Ventana de descarga en días: más pequeña = menos memoria por petición (más peticiones, 100/min permitidas).
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS) || 3;
const REFRESH_HOURS = Number(process.env.REFRESH_HOURS) || 6;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'records.json');
// Copia de la caché incluida en el repositorio (npm run seed). Sirve de punto de partida cuando el disco
// no persiste (p. ej. Render gratis): se carga al instante y solo se descargan los días que faltan.
const SEED_FILE = path.join(__dirname, 'seed', 'records.json');
const PUBLIC = path.join(__dirname, 'public');

if (!MOCK && !API_KEY) {
  console.error('Falta TOPDECK_API_KEY (consíguela gratis en https://topdeck.gg/developers). ' +
    'Para probar sin clave: MOCK=1 node server.js');
  process.exit(1);
}

// Estado en memoria. Los registros se guardan con `cards` como array para poder serializarlos.
let state = { records: [], updatedAt: null, refreshing: false, error: null, coveredDays: 0 };

// La caché se guarda en formato compacto (lib/cache.js, v4). Se siguen leyendo las v3 anteriores.

function loadCache() {
  for (const file of [CACHE_FILE, SEED_FILE]) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const records = cache.decodeAny(j);
      if (!records) { console.log(`Caché ${path.basename(path.dirname(file))}/ de otra versión: se ignora`); continue; }
      state.records = records;
      state.updatedAt = j.updatedAt;
      state.coveredDays = j.days || 90; // las cachés anteriores solo guardaban 90 días
      console.log(`Caché cargada${file === SEED_FILE ? ' (copia del repositorio)' : ''}: ${state.records.length} mazos (${j.updatedAt})`);
      return;
    } catch { /* no existe o está dañada: se prueba la siguiente */ }
  }
}

function saveCache() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Se escribe a un archivo temporal y se renombra: un corte a mitad no deja la caché a medias.
  const tmp = CACHE_FILE + '.tmp';
  cache.writeStream(fs, tmp, { updatedAt: state.updatedAt, days: state.coveredDays }, state.records);
  fs.renameSync(tmp, CACHE_FILE);
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    // Si la caché cubre menos días de los pedidos (p. ej. se subió DAYS), se descarga todo el periodo.
    const firstLoad = state.records.length === 0 || state.coveredDays < DAYS;
    // Primera carga: todo el periodo. Después solo los días transcurridos desde la última actualización.
    const days = firstLoad ? DAYS : cache.refreshDays(state.updatedAt, DAYS);
    // Cada ventana descargada se convierte enseguida en registros compactos y se descarta el resto,
    // para que el pico de memoria sea el de una ventana y no el de todo el histórico.
    const fresh = [];
    if (MOCK) fresh.push(...cache.interned(buildRecords(mockTournaments())));
    else {
      await fetchTournaments({
        apiKey: API_KEY, days, participantMin: PARTICIPANT_MIN, windowDays: WINDOW_DAYS,
        onBatch: batch => { fresh.push(...cache.interned(buildRecords(batch))); },
        onProgress: p => console.log(`Descargando ${p.done}/${p.total} ventanas, ${p.tournaments} torneos`),
      });
    }
    const freshTids = new Set(fresh.map(r => r.tid));
    const cutoff = Math.floor(Date.now() / 1000) - DAYS * 86400;
    state.records = state.records
      .filter(r => !freshTids.has(r.tid) && (MOCK || r.date >= cutoff))
      .concat(fresh);
    state.updatedAt = new Date().toISOString();
    if (firstLoad) state.coveredDays = DAYS;
    state.error = null;
    if (!MOCK) saveCache();
    console.log(`Actualizado: ${state.records.length} mazos`);
  } catch (e) {
    state.error = e.message;
    console.error('Error al actualizar:', e.message);
  } finally {
    state.refreshing = false;
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // Filtro opcional por jugadores del torneo, común a todos los endpoints de estadísticas.
  const minPlayers = Math.max(0, parseInt(url.searchParams.get('minPlayers'), 10) || 0);
  const maxPlayers = Math.max(0, parseInt(url.searchParams.get('maxPlayers'), 10) || 0);
  // Periodo: solo últimos N días (1, 3 o 6 meses en la web); 0 = todo lo descargado.
  const days = Math.min(DAYS, Math.max(0, parseInt(url.searchParams.get('days'), 10) || 0));
  const records = filterRecords(state.records, { minPlayers, maxPlayers, days });

  if (url.pathname === '/api/status') {
    return json(res, 200, {
      mock: MOCK, updatedAt: state.updatedAt, refreshing: state.refreshing, error: state.error,
      decks: records.length, days: DAYS, coveredDays: state.coveredDays, participantMin: PARTICIPANT_MIN,
      tournaments: new Set(records.map(r => r.tid)).size,
    });
  }
  if (url.pathname === '/api/commanders') {
    const min = Math.max(1, Number(url.searchParams.get('min')) || 5);
    return json(res, 200, commanderList(records, min));
  }
  if (url.pathname === '/api/commander') {
    const name = url.searchParams.get('name');
    const minWith = Math.max(2, Number(url.searchParams.get('minWith')) || 5);
    const rep = name && commanderReport(records, name, { minWith, minWithout: minWith });
    return rep ? json(res, 200, rep) : json(res, 404, { error: 'Comandante no encontrado' });
  }

  if (url.pathname === '/api/mylist' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 200000) req.destroy(); });
    req.on('end', () => {
      let j; try { j = JSON.parse(body); } catch { return json(res, 400, { error: 'JSON no válido' }); }
      const deck = parseText(String(j.list || ''));
      if (!deck.cards.size || !j.commander) return json(res, 400, { error: 'Pega una lista con al menos una carta' });
      const rep = myListReport(records, j.commander, new Set(deck.cards.keys()));
      return rep ? json(res, 200, rep) : json(res, 404, { error: 'Comandante sin datos en este periodo' });
    });
    return;
  }
  if (url.pathname === '/api/trend') {
    const name = url.searchParams.get('name');
    // La tendencia usa todo el histórico (respetando solo el filtro de jugadores).
    const rep = name && trendReport(filterRecords(state.records, { minPlayers, maxPlayers }), name);
    return rep ? json(res, 200, rep) : json(res, 404, { error: 'Comandante sin datos' });
  }
  if (url.pathname === '/api/synergy') {
    const name = url.searchParams.get('name');
    const rep = name && synergyReport(records, name);
    return rep ? json(res, 200, rep) : json(res, 404, { error: 'Comandante sin datos' });
  }
  if (url.pathname === '/api/variants') {
    const name = url.searchParams.get('name');
    const rep = name && variantsReport(records, name, { k: parseInt(url.searchParams.get('k'), 10) || 3 });
    return rep ? json(res, 200, rep) : json(res, 404, { error: 'Comandante sin datos' });
  }
  if (url.pathname === '/api/matchups') {
    const name = url.searchParams.get('name');
    const minPods = Math.max(5, Number(url.searchParams.get('minPods')) || 15);
    const rep = name && matchups(records, name, { minPods });
    return rep ? json(res, 200, rep) : json(res, 404, { error: 'Comandante sin mesas registradas' });
  }
  if (url.pathname === '/api/matrix') {
    const top = Math.min(20, Math.max(3, Number(url.searchParams.get('top')) || 12));
    return json(res, 200, matrix(records, top));
  }
  if (url.pathname === '/api/cards-vs') {
    const name = url.searchParams.get('name'), vs = url.searchParams.get('vs');
    const minWith = Math.max(5, Number(url.searchParams.get('minWith')) || 15);
    const rep = name && vs && cardsVsOpponent(records, name, vs, { minWith });
    return rep ? json(res, 200, rep) : json(res, 404, { error: 'Sin datos para ese enfrentamiento' });
  }

  // Estáticos (con protección frente a path traversal)
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('No encontrado');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

loadCache();
server.listen(PORT, () => console.log(`http://localhost:${PORT} ${MOCK ? '(modo demo)' : ''}`));
refresh();
setInterval(refresh, REFRESH_HOURS * 3600 * 1000).unref();
