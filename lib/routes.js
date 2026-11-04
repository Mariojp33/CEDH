'use strict';
// Rutas de la API. Cada una es una función (ctx) => respuesta; el contexto lo prepara `createHandler`
// (filtros comunes, vista de datos, caché de respuestas pesadas).
const fs = require('node:fs');
const path = require('node:path');
const tournaments = require('./tournaments');
const S = require('./stats');
const { parseText } = require('./parse');
const { suggestCards, cardReport, noveltiesReport, alternativesReport } = require('./cardindex');
const { metaReport } = require('./meta');
const { tableReport } = require('./table');
const combos = require('./combos');
const threats = require('./threats');
const { json, serveStatic, fail } = require('./http');

const { BASICS, filterRecords, decisive, decisiveSeats } = S;
const escHtml = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, def = 0) => parseInt(v, 10) || def;
const text = (q, k, max) => (q.get(k) || '').slice(0, max);

// opts: { state, excluded, config: { MOCK, DAYS, PARTICIPANT_MIN, COMBOS_API, PUBLIC } }
function createHandler({ state, excluded, config }) {
  const { MOCK, DAYS, PARTICIPANT_MIN, COMBOS_API, PUBLIC } = config;

  // ---- Combos (Commander Spellbook) ----
  // Se consulta solo cuando alguien abre los combos de un comandante; el resultado se guarda 24 h y las consultas
  // simultáneas del mismo comandante comparten una sola petición. El uso se calcula siempre sobre nuestros mazos.
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

  // Los cálculos pesados se guardan hasta la siguiente actualización de datos.
  const memo = new Map();
  let memoStamp = null;
  const seatCache = { stamp: null, map: new Map() };

  // Histórico completo (respeta solo el filtro de jugadores) y su vista con/sin empates
  const history = c => { const all = filterRecords(state.records, { minPlayers: c.minPlayers, maxPlayers: c.maxPlayers }); return c.dec ? decisive(all) : all; };
  // Espera al índice de cartas si aún se está construyendo (justo tras arrancar o actualizar)
  const withIndex = (c, fn) => {
    const ready = state.index ? Promise.resolve(state.index) : (state.indexPromise || Promise.resolve(null));
    ready.then(() => { try { fn(state.index); } catch (e) { fail(c.res, e); } });
  };
  const shareFn = ix => c => { const id = ix.ids.get(c.toLowerCase()); return id === undefined ? 0 : ix.decks[id].length / (ix.size || 1); };

  // `memo: true` = respuesta pesada que se guarda hasta la próxima actualización. Las respuestas con `send` se guardan; las de `json`, no.
  const routes = {
    '/api/status': c => c.json(200, {
      mock: MOCK, updatedAt: state.updatedAt, refreshing: state.refreshing, error: state.error,
      decks: c.records.length, days: DAYS, coveredDays: state.coveredDays, metaWinRate: S.metaWinRate(c.view), participantMin: PARTICIPANT_MIN,
      tournaments: new Set(c.records.map(r => r.tid)).size,
      // torneos descartados por no parecer cEDH (se guardan solo para poder avisar de ello)
      excluded: { tournaments: excluded.size, decks: [...excluded.values()].reduce((x, y) => x + y, 0) },
    }),

    // ---- Torneos y listas que hicieron top (solo lee los mazos ya descargados) ----
    '/api/tournaments': { memo: true, run: c => c.send(200, tournaments.tournamentsReport(c.records, { q: c.q.get('q') || '', limit: Math.min(100, num(c.q.get('limit'), 30)), offset: num(c.q.get('offset')), sort: c.q.get('sort') === 'size' ? 'size' : 'date' })) },
    '/api/regulars': { memo: true, run: c => {
      const s = c.q.get('sort');
      return c.send(200, tournaments.regularsReport(c.view, { minTournaments: Math.min(30, Math.max(2, num(c.q.get('min'), 5))), sort: ['tournaments', 'luck', 'winrate'].includes(s) ? s : 'tournaments', q: text(c.q, 'q', 60) }));
    } },
    '/api/teams': { memo: true, run: c => c.send(200, tournaments.teamsReport(c.view, { q: text(c.q, 'q', 40) })) },
    '/api/players': { memo: true, run: c => c.send(200, tournaments.playersSearch(c.view, text(c.q, 'q', 60))) },
    '/api/player': { memo: true, run: c => {
      const rep = tournaments.playerReport(c.view, tournaments.nameKey(text(c.q, 'key', 80)), { meta: S.metaWinRate(c.view), seatRecords: c.seatRecords() });
      return rep ? c.send(200, rep) : c.send(404, { error: 'Jugador no encontrado en este periodo' });
    } },
    '/api/commander-decks': { memo: true, run: c => {
      const rep = tournaments.commanderDecksReport(c.records, text(c.q, 'name', 120), { q: text(c.q, 'q', 120), scope: text(c.q, 'scope', 120) || 'all', sort: text(c.q, 'sort', 120) || 'date', limit: num(c.q.get('limit'), 30), offset: num(c.q.get('offset')) });
      return rep ? c.send(200, rep) : c.send(404, { error: 'Comandante no encontrado' });
    } },
    '/api/tournament': { memo: true, run: c => {
      const rep = tournaments.tournamentDetail(c.records, c.q.get('tid') || '');
      return rep ? c.send(200, rep) : c.send(404, { error: 'Torneo no encontrado (o sin posiciones guardadas todavía)' });
    } },
    '/api/decks': { memo: true, run: c => c.send(200, tournaments.decksReport(c.records, { commander: text(c.q, 'commander', 120), card: text(c.q, 'card', 120), player: text(c.q, 'player', 120), scope: text(c.q, 'scope', 120) || 'cut', limit: Math.min(200, num(c.q.get('limit'), 60)) })) },
    '/api/deck': { memo: true, run: c => {
      const rep = tournaments.deckDetail(c.records, c.q.get('tid') || '', num(c.q.get('rank')));
      return rep ? c.send(200, rep) : c.send(404, { error: 'Lista no encontrada' });
    } },

    // ---- Comandantes ----
    '/api/commanders': c => c.json(200, S.commanderList(c.view, Math.max(1, Number(c.q.get('min')) || 5))),
    '/api/commander': c => {
      const name = c.q.get('name'), minWith = Math.max(2, Number(c.q.get('minWith')) || 5);
      const rep = name && S.commanderReport(c.view, name, { minWith, minWithout: minWith });
      return rep ? c.json(200, rep) : c.json(404, { error: 'Comandante no encontrado' });
    },
    '/api/mylist': c => {
      if (c.req.method !== 'POST') return false;   // cae al 404 de estáticos, como antes
      let body = '';
      c.req.on('data', d => { body += d; if (body.length > 200000) c.req.destroy(); });
      c.req.on('end', () => { try {
        let j; try { j = JSON.parse(body); } catch { return c.json(400, { error: 'JSON no válido' }); }
        const deck = parseText(String(j.list || ''));
        if (!deck.cards.size || !j.commander) return c.json(400, { error: 'Pega una lista con al menos una carta' });
        const names = new Set(deck.cards.keys());
        const rep = S.myListReport(c.view, j.commander, names);
        if (rep) {
          // Variante más parecida y listas reales parecidas (solo con datos de TopDeck)
          const vr = S.variantsReport(c.view, j.commander, { k: 3, deckCards: names });
          rep.variant = vr.yours ? { ...vr.variants[vr.yours.index], ...vr.yours, total: vr.variants.length, baseline: vr.baseline } : null;
          rep.neighbors = S.neighborsReport(c.view, j.commander, names);
        }
        return rep ? c.json(200, rep) : c.json(404, { error: 'Comandante sin datos en este periodo' });
      } catch (e) { fail(c.res, e); } });
    },
    // Tendencias y validación: todo el histórico (respetando solo el filtro de jugadores)
    '/api/validation': { memo: true, run: c => {
      const rep = S.validationReport(history(c));
      return rep ? c.send(200, rep) : c.send(404, { error: 'Muestra insuficiente para validar' });
    } },
    '/api/card-trend': { memo: true, run: c => {
      const name = text(c.q, 'name', 200), card = text(c.q, 'card', 120);
      const rep = name && card && S.cardTrendReport(history(c), name, card);
      return rep ? c.send(200, rep) : c.send(404, { error: 'Comandante no encontrado' });
    } },
    '/api/trend': { memo: true, run: c => {
      const name = c.q.get('name');
      const rep = name && S.trendReport(history(c), name);
      return rep ? c.send(200, rep) : c.send(404, { error: 'Comandante sin datos' });
    } },
    '/api/combos': c => {
      const name = c.q.get('name');
      if (!name) return c.json(404, { error: 'Falta el comandante' });
      const ready = state.index ? Promise.resolve() : (state.indexPromise || Promise.resolve());
      ready.then(async () => {
        try {
          const { data, t, stale } = await commanderCombos(name, c.req);
          const ix = state.index, share = ix && shareFn(ix);
          const out = combos.summarize(data, c.records.filter(r => r.key === name), name.split(' / '), { metaShare: x => share ? share(x) : 0 });
          return c.json(200, { commander: name, ...out, fetchedAt: t, stale: !!stale });
        } catch (e) {
          if (e instanceof combos.ComboApiError) return c.json(e.status, { error: e.message });
          fail(c.res, e);
        }
      });
    },
    '/api/meta': { memo: true, run: c => {
      // Meta del momento: presencia, resultados con intervalo, niveles, evolución y empates
      const allView = history(c);
      return c.send(200, metaReport(allView, c.days ? filterRecords(allView, { days: c.days }) : allView));
    } },

    // ---- Consultas por carta (esperan al índice) ----
    '/api/cards': c => withIndex(c, ix => {
      if (!ix) return c.json(503, { error: 'El buscador se está preparando; prueba en unos segundos' });
      c.json(200, suggestCards(ix, c.q.get('q')));
    }),
    '/api/novelties': { memo: true, run: c => withIndex(c, ix => {
      if (!ix) return c.json(503, { error: 'El buscador se está preparando; prueba en unos segundos' });
      c.send(200, noveltiesReport(ix, state.records, { minPlayers: c.minPlayers, maxPlayers: c.maxPlayers }));
    }) },
    '/api/threats': { memo: true, run: c => withIndex(c, ix => {
      if (!ix) return c.json(503, { error: 'El buscador se está preparando; prueba en unos segundos' });
      // Cartas a tener en cuenta de un comandante: lo que lo define y remates, interacción, tutores, maná y odio
      const name = c.q.get('name'), shareOf = shareFn(ix);
      const rep = name && S.commanderReport(c.view, name, { minWith: 5, minWithout: 5 });
      if (!rep) return c.send(404, { error: 'Comandante sin datos con estos filtros' });
      c.send(200, { commander: name, ...threats.threatProfile(c.records.filter(r => r.key === name), shareOf),
        defining: threats.definingCards(rep.popular, shareOf, { isBasic: x => BASICS.has(x.toLowerCase()) }) });
    }) },
    '/api/table': { memo: true, run: c => withIndex(c, ix => {
      if (!ix) return c.json(503, { error: 'El buscador se está preparando; prueba en unos segundos' });
      // Preparar mesa: tu comandante (me) y hasta tres rivales (r1, r2, r3)
      const me = c.q.get('me'), rivals = ['r1', 'r2', 'r3'].map(k => c.q.get(k)).filter(Boolean);
      const rep = me && tableReport(c.seatRecords(), c.view, me, rivals, { metaShare: shareFn(ix) });
      rep ? c.send(200, rep) : c.send(404, { error: 'Comandante sin mesas registradas con estos filtros' });
    }) },
    '/api/card-alternatives': { memo: true, run: c => withIndex(c, ix => {
      if (!ix) return c.json(503, { error: 'El buscador se está preparando; prueba en unos segundos' });
      const name = c.q.get('name');
      const rep = name && alternativesReport(ix, state.records, name, c.q.get('commander'), { minPlayers: c.minPlayers, maxPlayers: c.maxPlayers, days: c.days });
      rep ? c.send(200, rep) : c.send(404, { error: 'Carta o comandante no encontrados' });
    }) },
    '/api/card': { memo: true, run: c => withIndex(c, ix => {
      if (!ix) return c.json(503, { error: 'El buscador se está preparando; prueba en unos segundos' });
      const name = c.q.get('name');
      const rep = name && cardReport(ix, state.records, name, { minPlayers: c.minPlayers, maxPlayers: c.maxPlayers, days: c.days });
      rep ? c.send(200, rep) : c.send(404, { error: 'Carta no encontrada en los mazos de este periodo' });
    }) },

    // ---- Dentro de un comandante ----
    '/api/packages': { memo: true, run: c => {
      // Paquetes (cartas que se juegan juntas) y alternativas (cartas que casi nunca coinciden)
      const name = c.q.get('name'), rep = name && S.packagesReport(c.view, name);
      return rep ? c.send(200, rep) : c.send(404, { error: 'Comandante sin datos' });
    } },
    '/api/variants': { memo: true, run: c => {
      const name = c.q.get('name');
      const rep = name && S.variantsReport(c.view, name, { k: num(c.q.get('k'), 3), detail: c.q.get('detail') === '1' });
      return rep ? c.send(200, rep) : c.send(404, { error: 'Comandante sin datos' });
    } },
    '/api/matchups': { memo: true, run: c => {
      const name = c.q.get('name'), minPods = Math.max(5, Number(c.q.get('minPods')) || 15);
      const rep = name && S.matchups(c.seatRecords(), name, { minPods });
      return rep ? c.send(200, rep) : c.send(404, { error: 'Comandante sin mesas registradas' });
    } },
    '/api/matrix': { memo: true, run: c => c.send(200, S.matrix(c.seatRecords(), Math.min(20, Math.max(3, Number(c.q.get('top')) || 12)))) },
    '/api/cards-vs': { memo: true, run: c => {
      const name = c.q.get('name'), vs = c.q.get('vs'), minWith = Math.max(5, Number(c.q.get('minWith')) || 15);
      const rep = name && vs && S.cardsVsOpponent(c.seatRecords(), name, vs, { minWith });
      return rep ? c.send(200, rep) : c.send(404, { error: 'Sin datos para ese enfrentamiento' });
    } },
  };

  // Portada con las etiquetas de vista previa (Open Graph) rellenas; con ?c=COMANDANTE, las de ese comandante.
  let indexCache = { mtime: 0, html: '' };
  function serveIndex(req, res, q) {
    const file = path.join(PUBLIC, 'index.html'), mtime = fs.statSync(file).mtimeMs;
    if (indexCache.mtime !== mtime) indexCache = { mtime, html: fs.readFileSync(file, 'utf8') };
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() === 'https' ? 'https' : 'http';
    const origin = `${proto}://${String(req.headers.host || 'localhost').replace(/[^\w.:-]/g, '')}`;
    let v = { TITLE: 'cEDH Stats por comandante', DESC: 'Winrates, meta, cartas y listas de los torneos de cEDH, por comandante.', IMAGE: origin + '/og.png', URL: origin + '/', CARD: 'summary_large_image' };
    const name = text(q, 'c', 120);
    const cmd = name && S.commanderList(filterRecords(state.records, { days: 90 }), 1).find(c => c.commander === name);
    if (cmd) {
      v = { ...v, TITLE: `${cmd.commander} · cEDH Stats`, URL: `${origin}/?c=${encodeURIComponent(cmd.commander)}`,
        DESC: `${cmd.decks} mazos en los últimos 3 meses de cEDH · winrate ${(cmd.winRate * 100).toFixed(1)} % · ${(cmd.metaShare * 100).toFixed(1)} % del meta.`,
        IMAGE: `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cmd.commander.split(' / ')[0])}&format=image&version=art_crop` };
    }
    const html = indexCache.html.replace(/__(TITLE|DESC|IMAGE|URL|CARD)__/g, (_, k) => escHtml(v[k]))
      .replace(/<title>.*?<\/title>/, `<title>${escHtml(v.TITLE)}</title>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(html);
  }

  return function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : null;
    const run = route && (route.run || route);
    const memoKey = route && route.memo ? req.url : null;
    if (memoKey) {
      if (memoStamp !== state.updatedAt) { memo.clear(); memoStamp = state.updatedAt; }
      const hit = memo.get(memoKey);
      if (hit) return json(res, hit.code, hit.body);
    }
    if (run) {
      const q = url.searchParams;
      // Filtro opcional por jugadores del torneo y periodo (últimos N días; 0 = todo lo descargado), comunes a todos los endpoints
      const minPlayers = Math.max(0, num(q.get('minPlayers'))), maxPlayers = Math.max(0, num(q.get('maxPlayers')));
      const days = Math.min(DAYS, Math.max(0, num(q.get('days'))));
      const records = filterRecords(state.records, { minPlayers, maxPlayers, days });
      // dec=1: «solo partidas con ganador» (los empates salen del denominador). Afecta a todo, también a matchups y matriz.
      const dec = q.get('dec') === '1';
      const c = {
        req, res, q, records, dec, days, minPlayers, maxPlayers,
        view: dec ? decisive(records) : records,
        json: (code, body) => json(res, code, body),
        send: (code, body) => { if (memoKey) { if (memo.size > 400) memo.clear(); memo.set(memoKey, { code, body }); } return json(res, code, body); },
        // Para matchups y matriz: con dec=1, solo mesas con ganador y rivales conocidos. Reconstruirlas cuesta ~150 ms:
        // se guardan por combinación de filtros hasta la próxima actualización.
        seatRecords() {
          if (!dec) return records;
          const k = `${state.updatedAt}|${minPlayers}|${maxPlayers}|${days}`;
          if (seatCache.stamp !== state.updatedAt) { seatCache.map.clear(); seatCache.stamp = state.updatedAt; }
          if (!seatCache.map.has(k)) { if (seatCache.map.size >= 8) seatCache.map.clear(); seatCache.map.set(k, decisiveSeats(records)); }
          return seatCache.map.get(k);
        },
      };
      if (run(c) !== false) return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') return serveIndex(req, res, url.searchParams);
    // Estáticos (con protección frente a path traversal)
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('No encontrado');
    }
    return serveStatic(res, file);
  };
}

module.exports = { createHandler };
