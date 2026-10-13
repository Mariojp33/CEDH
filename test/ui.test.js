'use strict';
// Pruebas de la interfaz en un Chrome real (sin interfaz gráfica). Si no hay Chrome instalado, se omiten.
// Se arranca el servidor en modo demo y un pequeño proxy que sirve la página con un guion de prueba añadido, así no se
// toca la carpeta public/. El guion recorre la web como lo haría una persona y devuelve lo que ha visto.
const test = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHROME = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find(b => spawnSync('which', [b]).status === 0);
const SKIP = !CHROME ? 'no hay Chrome instalado' : typeof WebSocket === 'undefined' ? 'este Node no trae WebSocket (usa Node 22+ o --experimental-websocket)' : false;
const APP = 4500 + (process.pid % 30), PROXY = APP + 40;
let server, proxy, dir;

// Código que se ejecuta DENTRO de la página
const BROWSER = String.raw`
const errs = []; window.addEventListener('error', e => errs.push(e.message)); window.addEventListener('unhandledrejection', e => errs.push(String(e.reason)));
// Scryfall simulado: tipo y coste según el nombre, para comprobar la agrupación sin depender de la red
const realFetch = window.fetch.bind(window);
window.fetch = (u, o) => {
  if (String(u).includes('api.scryfall.com/cards/collection')) {
    const ids = JSON.parse(o.body).identifiers;
    const types = ['Legendary Creature — Human', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Artifact Creature — Golem', 'Planeswalker — Jace'];
    const data = ids.map(({ name }, i) => ({ name, type_line: types[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % types.length], cmc: [...name].length % 9, image_uris: { small: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', normal: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' } }));
    return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  return realFetch(u, o);
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, n = 80) => { for (let i = 0; i < n; i++) { if (f()) return true; await wait(250); } return false; };
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const tabs = sel => $$(sel + ' [role=tab]').map(b => b.textContent.trim());
async function scenario(name) {
  const out = {};
  await until(() => document.querySelector('.tabs'));
  if (name === 'alias') {                      // enlaces de versiones anteriores
    await until(() => document.querySelector('#mas-host [data-sub]') || document.querySelector('#meta-host [data-sub]'));
    out.pestaña = (document.querySelector('.tabs [aria-selected=true]') || {}).textContent;
    out.apartado = (document.querySelector('[data-sub].on') || {}).textContent;
    return out;
  }
  out.cabecera = { buscador: !!document.getElementById('gq'), resumen: document.getElementById('fsum').textContent };
  out.inicio = tabs('.tabs');
  out.atajos = $$('.quick button').length;
  const filas = () => $$('#rows tr').length;
  const pocos = Number(document.getElementById('nfew').textContent);
  const antes = filas(); document.getElementById('showall').click();
  out.pocosMazos = { ocultos: pocos, antes, despues: filas() }; document.getElementById('showall').click();
  // Meta con sus apartados
  document.getElementById('tab-meta').click();
  await until(() => document.querySelector('#meta .tier'));
  out.meta = { apartados: $$('#meta-host [data-sub]').map(b => b.textContent), niveles: $$('#meta .tier').length, hash: location.hash };
  document.querySelector('#meta-host [data-sub=novedades]').click();
  await until(() => !/Calculando/.test(document.getElementById('nov').textContent));
  out.novedades = { hash: location.hash, cargado: !/Calculando/.test(document.getElementById('nov').textContent) };
  // Torneos y listas: podio, top cut, lista con comparación y búsqueda de listas por comandante
  document.getElementById('tab-torneos').click();
  await until(() => document.querySelector('#tr-out table'), 60);
  out.torneos = { apartados: $$('#tor-host [data-sub]').map(b => b.textContent), filas: $$('#tr-out tbody tr').length };
  document.querySelector('#tr-out [data-tid]').click();
  await until(() => document.querySelector('#tr-det table'), 60);
  out.topcut = $$('#tr-det tbody tr').length;
  const tsc = document.getElementById('tt-scope'); tsc.value = 'all'; tsc.dispatchEvent(new Event('change'));
  const todos = $$('#tr-det tbody tr').length;
  const tso = document.getElementById('tt-sort'); tso.value = 'wr'; tso.dispatchEvent(new Event('change'));
  const wrs = $$('#tr-det tbody tr').map(tr => { const m = /·\s*(\d+)%/.exec(tr.cells[3].textContent); return m ? +m[1] : -1; });
  out.torneoTodos = { todos, ordenadoPorWr: wrs.every((v, i) => i === 0 || wrs[i - 1] >= v) };
  tsc.value = 'cut'; tsc.dispatchEvent(new Event('change')); tso.value = 'rank'; tso.dispatchEvent(new Event('change'));
  out.colEnlace = $$('#tr-det thead th').map(h => h.textContent).includes('Enlace');
  document.querySelector('#tr-det [data-deck]').click();
  await until(() => document.querySelector('#tr-deck table'), 60);
  await until(() => document.querySelector('#dk-img .dgroup'), 60);
  out.visual = { grupos: $$('#dk-img .dgroup h3').map(h => h.textContent.replace(/\s*\(\d+\)/, '').trim()), cartas: $$('#dk-img .dcard').length, curva: $$('#dk-img .curve .cb').length, tablaOculta: document.getElementById('dk-tab').hidden };
  document.querySelector('#dk-views [data-v=tab]').click();
  out.visual.tablaVisible = !document.getElementById('dk-tab').hidden && document.getElementById('dk-img').hidden;
  out.lista = { titulo: (document.querySelector('#tr-deck h2') || {}).textContent, cartas: $$('#tr-deck tbody tr').length, copiar: !!document.getElementById('dk-copy'), distinta: /Qué tiene de distinta/.test(document.getElementById('tr-deck').textContent) };
  document.querySelector('#tor-host [data-sub=listas]').click();
  await until(() => document.querySelector('#td-out table'), 60);
  out.listasTop = $$('#td-out tbody tr').length;
  document.getElementById('td-cmd').value = 'Kinnan, Bonder Prodigy'; document.getElementById('td-scope').value = 'win'; document.getElementById('td-go').click();
  await wait(1200);
  out.kinnanGanadores = $$('#td-out tbody tr').map(tr => tr.textContent).every(t => /Kinnan/.test(t)) && $$('#td-out tbody tr').length > 0;
  // Buscar carta: al abrir una carta sale su foto
  document.getElementById('tab-cartas').click();
  await until(() => document.getElementById('cs-q'));
  const cq = document.getElementById('cs-q'); cq.value = 'Sol Ring'; cq.dispatchEvent(new Event('input'));
  await until(() => document.querySelector('#cs-sug button'), 40);
  document.querySelector('#cs-sug button').click();
  await until(() => document.querySelector('#cs-out #cs-img'), 60);
  const foto = document.querySelector('#cs-img img, #cs-img .miss');
  out.cartaFoto = { hay: !!foto, src: foto && foto.tagName === 'IMG' ? foto.getAttribute('src') : 'sin imagen' };
  // Más: guía, matriz, fiabilidad
  document.getElementById('tab-mas').click();
  await until(() => document.querySelector('#mas-host [data-sub]'));
  out.mas = { apartados: $$('#mas-host [data-sub]').map(b => b.textContent), guia: /Cómo leer esta web/.test(document.querySelector('[data-subpanel=guia]').textContent) };
  document.querySelector('#mas-host [data-sub=matriz]').click(); await until(() => document.querySelector('#matrix table'));
  out.matriz = !!document.querySelector('#matrix table');
  document.querySelector('#mas-host [data-sub=fiabilidad]').click(); await until(() => document.querySelector('#validation table'), 120);
  out.fiabilidad = !!document.querySelector('#validation table');
  // Buscador único → ficha
  const q = document.getElementById('gq'); q.value = 'kinnan'; q.dispatchEvent(new Event('input'));
  await until(() => !document.getElementById('gs').hidden);
  out.buscador = { grupos: $$('#gs .gh').map(g => g.textContent), primera: (document.querySelector('#gs button span') || {}).textContent };
  q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await until(() => document.querySelector('.head h2'));
  out.ficha = { titulo: (document.querySelector('.head h2') || {}).textContent, pestañas: tabs('.tabs'), sinMapa: !document.querySelector('svg.scatter'),
    asociadasPlegadas: document.querySelector('details.assoc') ? !document.querySelector('details.assoc').open : null, cartasMasJugadas: $$('#crows tr').length };
  document.getElementById('tab-juega').click(); await until(() => document.querySelector('#variants .variant'), 120);
  out.juega = !!document.querySelector('#variants .variant');
  document.getElementById('tab-resultados').click(); await until(() => document.querySelector('#mu table') && document.querySelector('#trend svg'), 120);
  out.resultados = { matchups: !!document.querySelector('#mu table'), evolucion: !!document.querySelector('#trend svg') };
  // Torneos del comandante: lista, filtros y paginación
  document.getElementById('tab-torneos').click(); await until(() => document.querySelector('#ct-out table'), 60);
  const todas = $$('#ct-out tbody tr').length, resumen = document.getElementById('ct-sum').textContent;
  const sc = document.getElementById('ct-scope'); sc.value = 'win'; sc.dispatchEvent(new Event('change')); await wait(1200);
  const campeones = $$('#ct-out tbody tr');
  const colJugadores = $$('#ct-out thead th').map(h => h.textContent).includes('Jugadores') && campeones.every(tr => /^\d+$/.test(tr.cells[2].textContent.trim()));
  const conPorcentaje = campeones.every(tr => /\d+-\d+-\d+\s*·\s*\d+%/.test(tr.textContent));
  const qq = document.getElementById('ct-q'); sc.value = 'all'; qq.value = 'zzz-no-existe'; qq.dispatchEvent(new Event('input')); await wait(1500);
  out.torneosCmd = { todas, resumen, campeones: campeones.length, colJugadores, conPorcentaje, soloGanadores: campeones.every(tr => /campeón/.test(tr.textContent)), vacio: /Ningún mazo coincide/.test(document.getElementById('ct-out').textContent), mas: !document.getElementById('ct-more').hidden };
  // Revisar mi lista: con sección de comandantes, sin sección, y ambigua
  document.getElementById('back').click(); await until(() => document.querySelector('.quick'));
  document.getElementById('tab-lista').click(); await until(() => document.getElementById('rl-go') && document.querySelectorAll('#rl-cmd option').length > 5);
  const rep = await (await fetch('/api/commander?name=' + encodeURIComponent('Kinnan, Bonder Prodigy') + '&days=90&dec=1')).json();
  const cartas = rep.popular.slice(0, 70).map(c => '1 ' + c.card);
  const vacio = document.getElementById('rl-msg');
  document.getElementById('rl-go').click(); out.listaVacia = vacio.textContent;
  document.getElementById('rl-text').value = '~~Commanders~~\n1 Kinnan, Bonder Prodigy\n\n~~Mainboard~~\n' + cartas.join('\n');
  document.getElementById('rl-go').click();
  await until(() => document.querySelector('#ml-out h2'), 120);
  out.revisar = { ficha: (document.querySelector('.head h2') || {}).textContent, pestaña: (document.querySelector('.tabs [aria-selected=true]') || {}).textContent,
    informe: $$('#ml-out h2').map(h => h.textContent.trim()).slice(0, 3) };
  // Sin sección: el comandante aparece como una carta más
  document.getElementById('back').click(); await until(() => document.querySelector('.quick'));
  document.getElementById('tab-lista').click(); await until(() => document.getElementById('rl-go') && document.querySelectorAll('#rl-cmd option').length > 5);
  document.getElementById('rl-text').value = ['1 Kinnan, Bonder Prodigy'].concat(cartas).join('\n');
  document.getElementById('rl-go').click();
  await until(() => document.querySelector('.head h2') || /comandante/i.test(document.getElementById('rl-msg').textContent), 80);
  out.sinSeccion = (document.querySelector('.head h2') || {}).textContent || document.getElementById('rl-msg').textContent;
  return out;
}
(async () => {
  const name = new URLSearchParams(location.search).get('s') || 'main';
  let out;
  try { out = await scenario(name); } catch (e) { out = { error: String(e) }; }
  out.errs = errs;
  const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
})();
`;

// Chrome se maneja por el protocolo de depuración: se abre la página y se espera (en tiempo real) a que el guion deje su resultado.
// Es asíncrono a propósito: el proxy vive en este mismo proceso y debe poder responder mientras Chrome carga la página.
async function chromeRun(url, maxMs = 150000) {
  const port = 9300 + (process.pid % 500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cedh-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    let tab;
    for (let i = 0; i < 80 && !tab; i++) {
      try { tab = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json(); } catch { await sleep(250); }
    }
    assert.ok(tab && tab.webSocketDebuggerUrl, 'Chrome no arrancó');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('no se pudo conectar con Chrome')); });
    let seq = 0; const pending = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); const f = pending.get(m.id); if (f) { pending.delete(m.id); f(m.result); } };
    const ev = expression => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); });
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const r = await ev(`(document.getElementById('result') || {}).textContent || ''`);
      const v = r && r.result && r.result.value;
      if (v) { ws.close(); return JSON.parse(v); }
      await sleep(500);
    }
    const st = await ev(`JSON.stringify({ url: location.href, errs: typeof errs === 'undefined' ? null : errs, tabs: document.querySelectorAll('.tabs').length, texto: document.body.innerText.slice(0, 300) })`);
    throw new Error('la página no devolvió resultado a tiempo: ' + (st && st.result && st.result.value));
  } finally { chrome.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
}

test.before(async () => {
  if (SKIP) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedh-ui-'));
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, MOCK: '1', PORT: String(APP), DATA_DIR: dir, SEED_URL: '' }, stdio: 'ignore' });
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8').replace('</body>', () => `<script>${BROWSER}</script></body>`); // con función: así `$$` y `$'` del guion no se interpretan
  proxy = http.createServer((req, res) => {
    if (req.url.startsWith('/_ui.html')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html); }
    const up = http.request({ port: APP, path: req.url, method: req.method, headers: req.headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  await new Promise(r => proxy.listen(PROXY, r));
  for (let i = 0; i < 60; i++) { try { await new Promise((ok, no) => http.get({ port: APP, path: '/api/status' }, ok).on('error', no)); return; } catch { await new Promise(r => setTimeout(r, 250)); } }
  throw new Error('el servidor no arrancó');
});
test.after(() => { if (server) server.kill(); if (proxy) proxy.close(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

test('interfaz: recorrido por secciones, buscador único, ficha y «Revisar mi lista»', { skip: SKIP, timeout: 180000 }, async () => {
  const r = await chromeRun(`http://localhost:${PROXY}/_ui.html?s=main#d=90`);
  assert.ifError(r.error);
  assert.deepStrictEqual(r.errs, [], 'sin errores en la consola');
  assert.deepStrictEqual(r.inicio, ['Mazos', 'Meta', 'Torneos y listas', 'Preparar mesa', 'Revisar mi lista', 'Buscar carta', 'Más']);
  assert.strictEqual(r.atajos, 3);
  assert.ok(r.pocosMazos.ocultos > 0 && r.pocosMazos.despues === r.pocosMazos.antes + r.pocosMazos.ocultos, 'la casilla añade a la tabla los comandantes con menos de 5 mazos');
  assert.match(r.cabecera.resumen, /Filtros · 3 meses · empates fuera del cálculo/);
  assert.deepStrictEqual(r.meta.apartados, ['Panorama', 'Novedades de cartas']);
  assert.ok(r.meta.niveles >= 3 && /t=meta&s=panorama/.test(r.meta.hash.replace(/&amp;/g, '&')));
  assert.ok(r.novedades.cargado && /s=novedades/.test(r.novedades.hash));
  assert.deepStrictEqual(r.torneos.apartados, ['Torneos', 'Buscar listas top']);
  assert.ok(r.torneos.filas > 5 && r.topcut >= 4, 'torneos con su top cut');
  assert.ok(r.torneoTodos.todos > r.topcut && r.torneoTodos.ordenadoPorWr, 'el torneo se puede ver completo y ordenar por resultados');
  assert.ok(r.colEnlace, 'la tabla del top cut tiene columna de enlace a la lista');
  assert.strictEqual(r.visual.grupos[0], 'Comandante');
  assert.ok(r.visual.grupos.includes('Criaturas') && r.visual.grupos.includes('Instantáneos') && r.visual.grupos.includes('Tierras'), 'la lista se separa por tipos: ' + r.visual.grupos);
  assert.ok(r.visual.cartas > 20 && r.visual.curva === 8 && r.visual.tablaOculta && r.visual.tablaVisible, 'imágenes, curva de maná y cambio a tabla');
  assert.match(r.lista.titulo, /·/); assert.ok(r.lista.cartas > 20 && r.lista.copiar && r.lista.distinta, 'la lista se enseña y se compara con el comandante');
  assert.ok(r.listasTop > 5 && r.kinnanGanadores, 'buscar listas top por comandante');
  assert.ok(r.cartaFoto.hay, 'la carta buscada enseña su foto');
  assert.ok(/api\.scryfall\.com\/cards\/named\?exact=/.test(r.cartaFoto.src) || r.cartaFoto.src === 'sin imagen');
  assert.deepStrictEqual(r.mas.apartados, ['Cómo leer esto', 'Matriz de matchups', 'Fiabilidad del método']);
  assert.ok(r.mas.guia && r.matriz && r.fiabilidad);
  assert.deepStrictEqual(r.buscador.grupos, ['Comandantes', 'Cartas'].slice(0, r.buscador.grupos.length));
  assert.match(r.buscador.primera, /Kinnan/);
  assert.match(r.ficha.titulo, /Kinnan/);
  assert.deepStrictEqual(r.ficha.pestañas, ['Cartas', 'Cómo juega', 'Combos y amenazas', 'Resultados', 'Torneos', 'Mi lista']);
  assert.strictEqual(r.ficha.sinMapa, true, 'el mapa de cartas ya no está');
  assert.strictEqual(r.ficha.asociadasPlegadas, true, 'las cartas asociadas al winrate van plegadas');
  assert.ok(r.ficha.cartasMasJugadas > 20);
  assert.ok(r.torneosCmd.todas > 5 && /torneos/.test(r.torneosCmd.resumen) && r.torneosCmd.campeones > 0 && r.torneosCmd.soloGanadores && r.torneosCmd.conPorcentaje && r.torneosCmd.colJugadores && r.torneosCmd.vacio, 'torneos del comandante con filtros');
  assert.ok(r.juega && r.resultados.matchups && r.resultados.evolucion);
  assert.match(r.listaVacia, /Pega primero/);
  assert.match(r.revisar.ficha, /Kinnan/);
  assert.strictEqual(r.revisar.pestaña, 'Mi lista');
  assert.ok(r.revisar.informe.some(h => /parece tu lista al meta/.test(h)), 'el informe de la lista se genera solo al llegar');
  assert.match(r.sinSeccion, /Kinnan|comandante/i, 'detecta el comandante aunque la lista no tenga sección');
});

test('interfaz: los enlaces antiguos llevan a la pestaña y apartado nuevos', { skip: SKIP, timeout: 180000 }, async () => {
  for (const [old, tab, sub] of [['fiabilidad', 'Más', 'Fiabilidad del método'], ['novedades', 'Meta', 'Novedades de cartas'], ['matriz', 'Más', 'Matriz de matchups']]) {
    const r = await chromeRun(`http://localhost:${PROXY}/_ui.html?s=alias#d=90&t=${old}`);
    assert.deepStrictEqual(r.errs, []);
    assert.strictEqual(r.pestaña, tab, 'enlace antiguo ' + old);
    assert.strictEqual(r.apartado, sub, 'enlace antiguo ' + old);
  }
});
