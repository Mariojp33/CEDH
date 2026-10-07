'use strict';
// Servidor sin dependencias: descarga torneos de TopDeck.gg, los cachea y sirve estadísticas por comandante.
const http = require('node:http');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { fetchTournaments } = require('./lib/topdeck');
const { BASICS, buildRecords, filterRecords, commanderList, classifyTournaments, neighborsReport, commanderReport, metaWinRate, decisive, decisiveSeats, validationReport, myListReport, packagesReport, trendReport, variantsReport, matchups, matrix, cardsVsOpponent } = require('./lib/stats');
const cache = require('./lib/cache');
const { parseText } = require('./lib/parse');
const dataset = require('./lib/dataset');
const { buildCardIndexAsync, suggestCards, cardReport, noveltiesReport, alternativesReport } = require('./lib/cardindex');
const { metaReport } = require('./lib/meta');
const { tableReport } = require('./lib/table');
const combos = require('./lib/combos');
const threats = require('./lib/threats');
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
const SEED_FILE = path.join(__dirname, 'seed', 'records.json');
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
    { label: ' (copia del repositorio)', get: async () => JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')) },
  ];
  for (const { label, get } of sources) {
    try {
      const j = await get();
      const records = cache.decodeAny(j);
      if (!records || records.length < 100) { console.log(`Datos${label} no válidos: se prueba el siguiente origen`); continue; }
      for (const [tid, n] of j.excluded || []) excluded.set(tid, n);
      // Un seed guardado por esta versión ya viene filtrado (lleva la lista `excluded`): no hace falta volver a clasificar
      state.records = Array.isArray(j.excluded) ? records : keepCedh(records);
      rebuildIndex();
      state.updatedAt = j.updatedAt;
      state.coveredDays = j.days || 90; // las cachés anteriores solo guardaban 90 días
      console.log(`Caché cargada${label}: ${state.records.length} mazos (${j.updatedAt}) · listo en ${((Date.now() - T0) / 1000).toFixed(1)} s · memoria ${mb()}`);
      return;
    } catch (e) {
      // El primero (caché en disco) falla siempre en una instalación nueva: solo se comenta el resto
      if (label) console.log(`No se pudo usar el origen${label}: ${e.message}`);
    }
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

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const wantsGzip = res => /\bgzip\b/.test(String(res.req && res.req.headers['accept-encoding'] || ''));

function json(res, code, body) {
  const raw = Buffer.from(JSON.stringify(body));
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60', Vary: 'Accept-Encoding' };
  if (raw.length > 1024 && wantsGzip(res)) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(code, headers);
    return res.end(zlib.gzipSync(raw)); // las respuestas grandes (la ficha de un comandante pesa cientos de KB) bajan a una fracción
  }
  res.writeHead(code, headers);
  res.end(raw);
}

// Archivos estáticos: se leen una vez (y se comprimen) mientras no cambien en disco.
const staticCache = new Map();
function serveStatic(res, file) {
  const mtime = fs.statSync(file).mtimeMs;
  let e = staticCache.get(file);
  if (!e || e.mtime !== mtime) {
    const raw = fs.readFileSync(file);
    e = { mtime, raw, gz: /\.(html|js|css|svg)$/.test(file) ? zlib.gzipSync(raw) : null };
    staticCache.set(file, e);
  }
  const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
  if (e.gz && wantsGzip(res)) { headers['Content-Encoding'] = 'gzip'; res.writeHead(200, headers); return res.end(e.gz); }
  res.writeHead(200, headers); res.end(e.raw);
}

// Los cálculos pesados (sinergias, variantes, matchups…) se guardan hasta la siguiente actualización de datos.
const memo = new Map();
let memoStamp = null;
const seatCache = { stamp: null, map: new Map() };
const MEMO_PATHS = new Set(['/api/threats', '/api/table', '/api/card', '/api/card-alternatives', '/api/novelties', '/api/meta', '/api/packages', '/api/variants', '/api/trend', '/api/matchups', '/api/matrix', '/api/cards-vs', '/api/validation']);

// ---- Combos y amenazas (Commander Spellbook) ----
// Se consulta a Spellbook solo cuando alguien abre los combos de un comandante; el resultado se guarda 24 h y las
// consultas simultáneas del mismo comandante comparten una sola petición. El uso se calcula siempre sobre nuestros mazos.
const COMBOS_API = process.env.COMBOS_API || combos.DEFAULT_API;
const comboCache = new Map();      // comandante -> { t, data }
const comboInflight = new Map();   // comandante -> promesa de la petición en curso
const COMBO_TTL = 24 * 3600 * 1000;
const comboHits = new Map();       // ip -> marcas de tiempo de sus peticiones que han ido a Spellbook
function limitedCombos(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
  const now = Date.now(), hits = (comboHits.get(ip) || []).filter(t => now - t < 60000);
  hits.push(now); comboHits.set(ip, hits);
  if (comboHits.size > 5000) comboHits.clear();
  return hits.length > 8;
}
async function commanderCombos(key, req) {
  const hit = comboCache.get(key);
  if (hit && Date.now() - hit.t < COMBO_TTL) return { data: hit.data, t: hit.t };
  if (comboInflight.has(key)) return { data: await comboInflight.get(key), t: Date.now() };
  const decks = state.records.filter(r => r.key === key);
  if (decks.length < 50) throw new combos.ComboApiError('Hacen falta al menos 50 mazos de este comandante para buscar combos', 404);
  if (limitedCombos(req)) throw new combos.ComboApiError('Demasiadas búsquedas de combos seguidas; espera un minuto', 429);
  const request = combos.unionRequest(decks, key.split(' / '), BASICS);
  const p = combos.fetchCombos({ ...request, api: COMBOS_API }).then(combos.compact).finally(() => comboInflight.delete(key));
  comboInflight.set(key, p);
  try {
    const data = await p;
    if (comboCache.size >= 60) comboCache.clear();
    comboCache.set(key, { t: Date.now(), data });
    return { data, t: Date.now() };
  } catch (e) {
    if (hit) return { data: hit.data, t: hit.t, stale: true };   // si Spellbook falla, se usa la última respuesta buena
    throw e;
  }
}

const handle = (req, res) => {
  const url = new URL(req.url, 'http://x');
  const memoKey = MEMO_PATHS.has(url.pathname) ? req.url : null;
  if (memoKey) {
    if (memoStamp !== state.updatedAt) { memo.clear(); memoStamp = state.updatedAt; }
    const hit = memo.get(memoKey);
    if (hit) return json(res, hit.code, hit.body);
  }
  // Responde y, si el endpoint es de los pesados, guarda el resultado
  const send = (code, body) => { if (memoKey) { if (memo.size > 400) memo.clear(); memo.set(memoKey, { code, body }); } return json(res, code, body); };
  // Filtro opcional por jugadores del torneo, común a todos los endpoints de estadísticas.
  const minPlayers = Math.max(0, parseInt(url.searchParams.get('minPlayers'), 10) || 0);
  const maxPlayers = Math.max(0, parseInt(url.searchParams.get('maxPlayers'), 10) || 0);
  // Periodo: solo últimos N días (1, 3 o 6 meses en la web); 0 = todo lo descargado.
  const days = Math.min(DAYS, Math.max(0, parseInt(url.searchParams.get('days'), 10) || 0));
  const records = filterRecords(state.records, { minPlayers, maxPlayers, days });
  // dec=1: «solo partidas con ganador» (los empates salen del denominador). Afecta a todo: winrates, cartas,
  // sinergias, variantes, tendencia, validación y también matchups y matriz (solo mesas con ganador y rivales conocidos).
  const dec = url.searchParams.get('dec') === '1';
  // Para matchups y matriz: con dec=1, solo mesas con ganador y rivales conocidos
  const seatRecords = () => {
    if (!dec) return records;
    // Reconstruir los asientos con ganador cuesta ~150 ms: se guarda por combinación de filtros hasta la próxima actualización
    const k = `${state.updatedAt}|${minPlayers}|${maxPlayers}|${days}`;
    if (seatCache.stamp !== state.updatedAt) { seatCache.map.clear(); seatCache.stamp = state.updatedAt; }
    if (!seatCache.map.has(k)) { if (seatCache.map.size >= 8) seatCache.map.clear(); seatCache.map.set(k, decisiveSeats(records)); }
    return seatCache.map.get(k);
  };
  const view = dec ? decisive(records) : records;

  if (url.pathname === '/api/status') {
    return json(res, 200, {
      mock: MOCK, updatedAt: state.updatedAt, refreshing: state.refreshing, error: state.error,
      decks: records.length, days: DAYS, coveredDays: state.coveredDays, metaWinRate: metaWinRate(view), participantMin: PARTICIPANT_MIN,
      tournaments: new Set(records.map(r => r.tid)).size,
      // torneos descartados por no parecer cEDH (se guardan solo para poder avisar de ello)
      excluded: { tournaments: excluded.size, decks: [...excluded.values()].reduce((x, y) => x + y, 0) },
    });
  }
  if (url.pathname === '/api/commanders') {
    const min = Math.max(1, Number(url.searchParams.get('min')) || 5);
    return json(res, 200, commanderList(view, min));
  }
  if (url.pathname === '/api/commander') {
    const name = url.searchParams.get('name');
    const minWith = Math.max(2, Number(url.searchParams.get('minWith')) || 5);
    const rep = name && commanderReport(view, name, { minWith, minWithout: minWith });
    return rep ? json(res, 200, rep) : json(res, 404, { error: 'Comandante no encontrado' });
  }

  if (url.pathname === '/api/mylist' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 200000) req.destroy(); });
    req.on('end', () => { try {
      let j; try { j = JSON.parse(body); } catch { return json(res, 400, { error: 'JSON no válido' }); }
      const deck = parseText(String(j.list || ''));
      if (!deck.cards.size || !j.commander) return json(res, 400, { error: 'Pega una lista con al menos una carta' });
      const names = new Set(deck.cards.keys());
      const rep = myListReport(view, j.commander, names);
      if (rep) {
        // Variante más parecida y listas reales parecidas (solo con datos de TopDeck)
        const vr = variantsReport(view, j.commander, { k: 3, deckCards: names });
        rep.variant = vr.yours ? { ...vr.variants[vr.yours.index], ...vr.yours, total: vr.variants.length, baseline: vr.baseline } : null;
        rep.neighbors = neighborsReport(view, j.commander, names);
      }
      return rep ? json(res, 200, rep) : json(res, 404, { error: 'Comandante sin datos en este periodo' });
    } catch (e) { fail(res, e); } });
    return;
  }
  if (url.pathname === '/api/validation') {
    // Usa todo el histórico (respetando solo el filtro de jugadores).
    const all = filterRecords(state.records, { minPlayers, maxPlayers });
    const rep = validationReport(dec ? decisive(all) : all);
    return rep ? send(200, rep) : send(404, { error: 'Muestra insuficiente para validar' });
  }
  if (url.pathname === '/api/trend') {
    const name = url.searchParams.get('name');
    // La tendencia usa todo el histórico (respetando solo el filtro de jugadores).
    const all = filterRecords(state.records, { minPlayers, maxPlayers });
    const rep = name && trendReport(dec ? decisive(all) : all, name);
    return rep ? send(200, rep) : send(404, { error: 'Comandante sin datos' });
  }
  if (url.pathname === '/api/combos') {
    const name = url.searchParams.get('name');
    if (!name) return json(res, 404, { error: 'Falta el comandante' });
    const ready = state.index ? Promise.resolve() : (state.indexPromise || Promise.resolve());
    ready.then(async () => {
      try {
        const { data, t, stale } = await commanderCombos(name, req);
        const ix = state.index;
        const metaShare = c => { const id = ix && ix.ids.get(c.toLowerCase()); return id === undefined || !ix ? 0 : ix.decks[id].length / (ix.size || 1); };
        const out = combos.summarize(data, records.filter(r => r.key === name), name.split(' / '), { metaShare });
        return json(res, 200, { commander: name, ...out, fetchedAt: t, stale: !!stale });
      } catch (e) {
        if (e instanceof combos.ComboApiError) return json(res, e.status, { error: e.message });
        fail(res, e);
      }
    });
    return;
  }
  if (url.pathname === '/api/meta') {
    // Meta del momento: presencia, resultados con intervalo, niveles, evolución y empates
    const all = filterRecords(state.records, { minPlayers, maxPlayers });
    const allView = dec ? decisive(all) : all;
    const period = days ? filterRecords(allView, { days }) : allView;
    return send(200, metaReport(allView, period));
  }
  if (['/api/cards', '/api/card', '/api/card-alternatives', '/api/novelties', '/api/table', '/api/threats'].includes(url.pathname)) {
    // Consultas por carta: esperan al índice si aún se está construyendo (justo tras arrancar o actualizar)
    const ready = state.index ? Promise.resolve(state.index) : (state.indexPromise || Promise.resolve(null));
    ready.then(() => {
      try {
        const ix = state.index, q = url.searchParams;
        if (!ix) return json(res, 503, { error: 'El buscador se está preparando; prueba en unos segundos' });
        if (url.pathname === '/api/cards') return json(res, 200, suggestCards(ix, q.get('q')));
        if (url.pathname === '/api/novelties') return send(200, noveltiesReport(ix, state.records, { minPlayers, maxPlayers }));
        if (url.pathname === '/api/threats') {
          // Cartas a tener en cuenta de un comandante: lo que lo define y remates, interacción, tutores, maná y odio
          const name = q.get('name');
          const shareOf = c => { const id = ix.ids.get(c.toLowerCase()); return id === undefined ? 0 : ix.decks[id].length / (ix.size || 1); };
          const rep = name && commanderReport(view, name, { minWith: 5, minWithout: 5 });
          if (!rep) return send(404, { error: 'Comandante sin datos con estos filtros' });
          const decks = records.filter(r => r.key === name);
          return send(200, { commander: name, ...threats.threatProfile(decks, shareOf),
            defining: threats.definingCards(rep.popular, shareOf, { isBasic: c => BASICS.has(c.toLowerCase()) }) });
        }
        if (url.pathname === '/api/table') {
          // Preparar mesa: tu comandante (me) y hasta tres rivales (r1, r2, r3)
          const me = q.get('me'), rivals = ['r1', 'r2', 'r3'].map(k => q.get(k)).filter(Boolean);
          const metaShare = c => { const id = ix.ids.get(c.toLowerCase()); return id === undefined ? 0 : ix.decks[id].length / (ix.size || 1); };
          const rep = me && tableReport(seatRecords(), view, me, rivals, { metaShare });
          return rep ? send(200, rep) : send(404, { error: 'Comandante sin mesas registradas con estos filtros' });
        }
        const name = q.get('name');
        if (url.pathname === '/api/card-alternatives') {
          const rep = name && alternativesReport(ix, state.records, name, q.get('commander'), { minPlayers, maxPlayers, days });
          return rep ? send(200, rep) : send(404, { error: 'Carta o comandante no encontrados' });
        }
        const rep = name && cardReport(ix, state.records, name, { minPlayers, maxPlayers, days });
        return rep ? send(200, rep) : send(404, { error: 'Carta no encontrada en los mazos de este periodo' });
      } catch (e) { fail(res, e); }
    });
    return;
  }
  if (url.pathname === '/api/packages') {
    // Paquetes (cartas que se juegan juntas) y alternativas (cartas que casi nunca coinciden), dentro de un comandante
    const name = url.searchParams.get('name');
    const rep = name && packagesReport(view, name);
    return rep ? send(200, rep) : send(404, { error: 'Comandante sin datos' });
  }
  if (url.pathname === '/api/variants') {
    const name = url.searchParams.get('name');
    const rep = name && variantsReport(view, name, { k: parseInt(url.searchParams.get('k'), 10) || 3, detail: url.searchParams.get('detail') === '1' });
    return rep ? send(200, rep) : send(404, { error: 'Comandante sin datos' });
  }
  if (url.pathname === '/api/matchups') {
    const name = url.searchParams.get('name');
    const minPods = Math.max(5, Number(url.searchParams.get('minPods')) || 15);
    const rep = name && matchups(seatRecords(), name, { minPods });
    return rep ? send(200, rep) : send(404, { error: 'Comandante sin mesas registradas' });
  }
  if (url.pathname === '/api/matrix') {
    const top = Math.min(20, Math.max(3, Number(url.searchParams.get('top')) || 12));
    return send(200, matrix(seatRecords(), top));
  }
  if (url.pathname === '/api/cards-vs') {
    const name = url.searchParams.get('name'), vs = url.searchParams.get('vs');
    const minWith = Math.max(5, Number(url.searchParams.get('minWith')) || 15);
    const rep = name && vs && cardsVsOpponent(seatRecords(), name, vs, { minWith });
    return rep ? send(200, rep) : send(404, { error: 'Sin datos para ese enfrentamiento' });
  }

  // Estáticos (con protección frente a path traversal)
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('No encontrado');
  }
  return serveStatic(res, file);
};

// Un error inesperado en una petición no debe tumbar el servidor: se responde 500 y se sigue.
const server = http.createServer((req, res) => {
  try { handle(req, res); } catch (e) { fail(res, e); }
});
function fail(res, e) {
  console.error('Error en la petición:', e && e.stack || e);
  if (!res.headersSent) { try { json(res, 500, { error: 'Error interno' }); } catch { res.destroy(); } } else res.end();
}
// Red de seguridad para errores fuera de una petición (por ejemplo en una actualización)
process.on('uncaughtException', e => console.error('Error no controlado:', e && e.stack || e));
process.on('unhandledRejection', e => console.error('Promesa rechazada:', e && e.stack || e));

loadCache().then(() => {
  server.listen(PORT, () => console.log(`http://localhost:${PORT} ${MOCK ? '(modo demo)' : ''}`));
  refresh();
  setInterval(refresh, REFRESH_HOURS * 3600 * 1000).unref();
});
