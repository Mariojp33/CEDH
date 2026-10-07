const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
const pp = x => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + ' pts';
const short = (s, n = 30) => s.length > n ? s.slice(0, n - 1) + '…' : s;

// Filtro global por jugadores del torneo: se añade a todas las llamadas a la API.
const F = { min: '', max: '', days: 90, dec: 1 }; // dec: 1 = los empates salen del cálculo del winrate
// Barra centrada en la referencia (la media del meta): verde a la derecha (mejor), roja a la izquierda (peor), escala ±`range`.
// Con `neutral` (diferencia que no se distingue del azar) sale en gris.
const track = (d, range, neutral = false) => `<div class="track"><i class="${neutral ? 'neu' : d >= 0 ? 'pos' : 'neg'}" style="width:${Math.min(50, Math.abs(d) / range * 50)}%"></i></div>`;
let view = { t: 'list' };
const api = async (p, o = {}) => {
  const u = new URL(p, location.origin);
  if (F.min) u.searchParams.set('minPlayers', F.min);
  if (F.max) u.searchParams.set('maxPlayers', F.max);
  const days = o.days ?? F.days;
  if (days) u.searchParams.set('days', days);
  if (F.dec) u.searchParams.set('dec', 1);
  const r = await fetch(u);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
};

let commanders = [];

// ¿El intervalo de confianza queda entero por encima (1) o por debajo (-1) de la referencia, o la incluye (0)?
const sig = (ci, base) => ci[0] > base ? 1 : ci[1] < base ? -1 : 0;
const tone = sg => sg > 0 ? 'pos-t' : sg < 0 ? 'neg-t' : 'muted';

// Nombre de carta (o de comandante) que enseña su imagen al pasar el ratón.
const cn = (name, label = name) => `<span class="cn" data-card="${esc(name)}">${esc(label)}</span>`;

// ---- Imagen de la carta al pasar el ratón (Scryfall) ----
// La imagen la carga el navegador directamente desde Scryfall; el servidor no interviene.
// Los comandantes con pareja («A / B») muestran las dos cartas.
const pop = document.createElement('div');
pop.id = 'cardpop'; pop.hidden = true; document.body.appendChild(pop);
const scry = (n, mode = 'exact') => `https://api.scryfall.com/cards/named?${mode}=${encodeURIComponent(n)}&format=image&version=normal`;
let popTimer = null, popFor = null, mouse = { x: 0, y: 0 };
function placePop() {
  const w = pop.offsetWidth, h = pop.offsetHeight, m = 16;
  let x = mouse.x + m, y = mouse.y + m;
  if (x + w > innerWidth - 8) x = Math.max(8, mouse.x - w - m);          // sin sitio a la derecha: a la izquierda
  if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8);      // sin sitio abajo: se sube
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
}
function showPop(name) {
  pop.replaceChildren(...name.split(' / ').slice(0, 2).map(n => {
    const img = new Image();
    img.alt = n; img.src = scry(n);
    img.onerror = () => {
      if (!img.dataset.retry) { img.dataset.retry = 1; img.src = scry(n, 'fuzzy'); return; } // caras dobles o divididas
      const d = document.createElement('div'); d.className = 'miss'; d.textContent = 'Imagen no disponible: ' + n;
      img.replaceWith(d); placePop();
    };
    return img;
  }));
  pop.hidden = false; placePop();
}
function hidePop() { clearTimeout(popTimer); popFor = null; pop.hidden = true; pop.replaceChildren(); }
document.addEventListener('mouseover', e => {
  const el = e.target.closest && e.target.closest('[data-card]');
  if (el === popFor) return;
  hidePop();
  if (!el) return;
  popFor = el;
  popTimer = setTimeout(() => showPop(el.dataset.card), 180); // pequeña espera: no se piden imágenes al cruzar la tabla
});
document.addEventListener('mousemove', e => { mouse = { x: e.clientX, y: e.clientY }; if (!pop.hidden) placePop(); });
document.addEventListener('scroll', hidePop, true);

// ---- Ordenar tablas pulsando su cabecera (vale para todas, también las que se generan después) ----
// Valor ordenable de una celda: número si lo es («23.6%», «+5.1 pts»), nivel si es una fiabilidad, texto si no.
// Las celdas vacías o «—» van siempre al final.
function cellKey(td) {
  const rl = td.querySelector('.rel');
  if (rl) return rl.classList.contains('hi') ? 3 : rl.classList.contains('mid') ? 2 : 1;
  const t = td.textContent.replace(/\s+/g, ' ').trim();
  if (!t || t === '—' || t === '·') return null;
  const n = t.replace(/\s*(%|pts)$/, '');
  return /^[+-]?\d+(\.\d+)?$/.test(n) ? parseFloat(n) : t.toLowerCase();
}
function sortTable(table) {
  const col = table.dataset.sc, tb = table.tBodies[0];
  if (col == null || !tb) return;
  const dir = table.dataset.sd === 'asc' ? 1 : -1;
  const rows = [...tb.rows].filter(r => r.cells.length > Number(col)) // se ignoran filas de aviso («Sin datos…»)
    .map((r, i) => ({ r, i, k: cellKey(r.cells[col]) }));
  rows.sort((a, b) => {
    if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1;
    const c = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : String(a.k).localeCompare(String(b.k), 'es');
    return c ? c * dir : a.i - b.i;
  });
  rows.forEach(x => tb.appendChild(x.r));
}
document.addEventListener('click', e => {
  const th = e.target.closest('thead th');
  const table = th && th.closest('table');
  if (!table || table.classList.contains('mx') || !th.textContent.trim() || !table.tBodies[0]) return;
  const col = th.cellIndex;
  if (table.dataset.sc === String(col)) table.dataset.sd = table.dataset.sd === 'asc' ? 'desc' : 'asc';
  else {
    table.dataset.sc = col;
    const first = [...table.tBodies[0].rows].map(r => r.cells[col] && cellKey(r.cells[col])).find(k => k !== null && k !== undefined);
    table.dataset.sd = typeof first === 'number' ? 'desc' : 'asc'; // números: de mayor a menor; texto: A-Z
  }
  table.querySelectorAll('thead th').forEach(h => delete h.dataset.dir);
  th.dataset.dir = table.dataset.sd;
  sortTable(table);
});

// Estado compartible en la dirección (#d=90&min=30&c=Comandante): se lee al abrir y se escribe al navegar.
function writeHash() {
  const h = new URLSearchParams();
  h.set('d', F.days);
  h.set('dec', F.dec);
  if (F.min) h.set('min', F.min);
  if (F.max) h.set('max', F.max);
  if (view.tab) h.set('t', view.tab);
  if (view.t === 'list' && view.card && view.tab === 'cartas') h.set('card', view.card);
  if (view.t === 'cmd') h.set('c', view.name);
  if (view.t === 'cmp') { h.set('c', view.a); h.set('vs', view.b); }
  try { history.replaceState(null, '', '#' + h); } catch { /* sin historial (vista previa) */ }
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const d = Number(h.get('d'));
  if ([30, 90, 180].includes(d)) F.days = d;
  if (h.get('dec') === '0') F.dec = 0;
  F.min = h.get('min') || ''; F.max = h.get('max') || '';
  $('#fmin').value = F.min; $('#fmax').value = F.max;
  const tab = h.get('t') || undefined;
  if (h.get('c') && h.get('vs')) view = { t: 'cmp', a: h.get('c'), b: h.get('vs') };
  else if (h.get('c')) view = { t: 'cmd', name: h.get('c'), minWith: 5, tab };
  else view = { t: 'list', tab, card: h.get('card') || undefined };
}
const store = {
  get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* almacenamiento bloqueado */ } },
};
// ---- Pestañas ----
// Cada pestaña carga sus datos la primera vez que se abre (así no se calculan sinergias o variantes si nadie las mira).
const TABS = {
  list: [['comandantes', 'Comandantes'], ['meta', 'Meta del momento'], ['novedades', 'Novedades'], ['mesa', 'Preparar mesa'], ['cartas', 'Buscar carta'], ['matriz', 'Matriz de matchups'], ['fiabilidad', 'Fiabilidad del método']],
  cmd: [['cartas', 'Cartas'], ['matchups', 'Matchups'], ['evolucion', 'Evolución'], ['variantes', 'Variantes y paquetes'], ['combos', 'Combos y amenazas'], ['lista', 'Mi lista']],
};
const pickTab = kind => TABS[kind].some(t => t[0] === view.tab) ? view.tab : TABS[kind][0][0];
const tabsHtml = (kind, active) => `<div class="tabs" role="tablist" aria-label="Secciones">${TABS[kind].map(([id, label]) =>
  `<button role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${id === active}" tabindex="${id === active ? 0 : -1}" data-tab="${id}">${label}</button>`).join('')}</div>`;
const tabPanel = (id, active, inner) => `<section class="tabpanel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}" ${id === active ? '' : 'hidden'}>${inner}</section>`;
function bindTabs(kind, loaders) {
  const done = new Set(), ids = TABS[kind].map(t => t[0]);
  const select = (id, focus) => {
    view.tab = id; writeHash();
    document.querySelectorAll('.tabs [role=tab]').forEach(b => {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    document.querySelectorAll('.tabpanel').forEach(p => { p.hidden = p.id !== 'panel-' + id; });
    if (!done.has(id)) { done.add(id); if (loaders[id]) loaders[id](); }
  };
  document.querySelectorAll('.tabs [role=tab]').forEach(b => {
    b.onclick = () => select(b.dataset.tab);
    b.onkeydown = e => { // flechas, Inicio y Fin cambian de pestaña con el teclado
      const i = ids.indexOf(b.dataset.tab);
      const to = { ArrowRight: ids[(i + 1) % ids.length], ArrowLeft: ids[(i + ids.length - 1) % ids.length], Home: ids[0], End: ids[ids.length - 1] }[e.key];
      if (to) { e.preventDefault(); select(to, true); }
    };
  });
  select(pickTab(kind));
}

async function ensureCommanders() { if (!commanders.length) commanders = await api('/api/commanders?min=5'); }

// Fiabilidad según q (proporción esperada de falsos positivos tras corregir por comparaciones múltiples).
const rel = q => q == null ? '' : q < 0.05 ? '<span class="rel hi" title="q &lt; 5 %: es poco probable que sea casualidad">● alta</span>'
  : q < 0.25 ? '<span class="rel mid" title="q &lt; 25 %: indicio razonable">◐ media</span>'
  : '<span class="rel lo" title="Puede ser casualidad">○ baja</span>';

// Gráfico: inclusión (x) frente a diferencia ajustada de winrate (y).
function scatter(cards) {
  const pts = cards.filter(c => c.adj != null);
  if (pts.length < 5) return '<div class="muted">Sin datos suficientes para el gráfico.</div>';
  const W = 720, H = 380, L = 46, R = 12, T = 14, B = 34;
  const xmax = Math.min(1, Math.max(0.3, ...pts.map(c => c.inclusion)) + 0.03);
  const ymax = Math.max(0.01, ...pts.map(c => Math.abs(c.adj))) * 1.15;
  const X = v => L + v / xmax * (W - L - R), Y = v => T + (1 - (v + ymax) / (2 * ymax)) * (H - T - B);
  const rad = c => 3 + Math.min(7, Math.sqrt(c.decks) / 2.2);
  const xTicks = [0, .2, .4, .6, .8, 1].filter(v => v <= xmax);
  const yStep = ymax > 0.06 ? 0.04 : 0.02;
  const yTicks = []; for (let v = -Math.floor(ymax / yStep) * yStep; v <= ymax; v += yStep) yTicks.push(Math.round(v * 1000) / 1000);
  const labelled = new Set([...pts].filter(c => c.q < 0.25).sort((a, b) => Math.abs(b.adj) - Math.abs(a.adj)).slice(0, 12));
  const dots = pts.map(c => `<circle data-card="${esc(c.card)}" cx="${X(c.inclusion).toFixed(1)}" cy="${Y(c.adj).toFixed(1)}" r="${rad(c).toFixed(1)}"
      fill="var(${c.adj >= 0 ? '--good' : '--bad'})" fill-opacity="${c.q < 0.25 ? 0.85 : 0.3}" stroke="var(--panel)" stroke-width="1">
      <title>${esc(c.card)}\nEn ${c.decks} mazos (${pct(c.inclusion, 0)})\nDiferencia ajustada ${pp(c.adj)} (bruta ${pp(c.lift)})</title></circle>`).join('');
  const placed = [];
  const labels = [...labelled].map(c => {
    const t = short(c.card, 22), w = t.length * 5.6, cx = X(c.inclusion), cy = Y(c.adj) + 3;
    const left = cx + rad(c) + 3 + w > W - R;
    const x0 = left ? cx - rad(c) - 3 - w : cx + rad(c) + 3;
    if (placed.some(b => Math.abs(b.y - cy) < 12 && x0 < b.x + b.w && b.x < x0 + w)) return ''; // se solaparía con otra etiqueta
    placed.push({ x: x0, y: cy, w });
    return `<text class="pl" data-card="${esc(c.card)}" x="${(left ? cx - rad(c) - 3 : x0).toFixed(1)}" y="${cy.toFixed(1)}" ${left ? 'text-anchor="end"' : ''}>${esc(t)}</text>`;
  }).join('');
  return `<svg class="scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="Inclusión frente a diferencia de winrate por carta">
    ${yTicks.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" ${v === 0 ? 'stroke-width="2"' : ''}/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}</text>`).join('')}
    ${xTicks.map(v => `<text x="${X(v)}" y="${H - 14}" text-anchor="middle">${(v * 100).toFixed(0)} %</text>`).join('')}
    <line x1="${X(0.4)}" x2="${X(0.4)}" y1="${T}" y2="${H - B}" stroke="var(--line)" stroke-dasharray="4 4"/>
    <text class="q" x="${W - R - 4}" y="${T + 12}" text-anchor="end">Estándar que funciona</text>
    <text class="q" x="${L + 6}" y="${T + 12}">Tech infrautilizada</text>
    <text class="q" x="${W - R - 4}" y="${H - B - 6}" text-anchor="end">Posibles trampas</text>
    <text class="q" x="${L + 6}" y="${H - B - 6}">Poco jugadas y flojas</text>
    <text x="${(L + W - R) / 2}" y="${H - 1}" text-anchor="middle">% de mazos que la juegan →</text>
    <text x="12" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(T + H - B) / 2})">diferencia ajustada de winrate (pts)</text>
    ${dots}${labels}</svg>`;
}

// Panel «Mi lista»: la lista pegada se compara con lo que juega el meta con este comandante.
function bindMyList(name) {
  const saved = store.get('list:' + name);
  if (saved) { $('#ml-text').value = saved; $('#ml-text').placeholder = ''; }
  $('#ml-copy').onclick = () => copyText($('#ml-text').value, $('#ml-copy'));
  $('#ml-go').onclick = async () => {
    const out = $('#ml-out'), list = $('#ml-text').value;
    store.set('list:' + name, list); // se recuerda en este navegador para no pegarla cada vez
    if (!list.trim()) { out.innerHTML = '<span class="muted">Pega primero una lista.</span>'; return; }
    out.innerHTML = '<span class="muted">Analizando…</span>';
    try {
      const u = new URL('/api/mylist', location.origin);
      if (F.min) u.searchParams.set('minPlayers', F.min);
      if (F.max) u.searchParams.set('maxPlayers', F.max);
      if (F.days) u.searchParams.set('days', F.days);
      if (F.dec) u.searchParams.set('dec', 1);
      const res = await fetch(u, { method: 'POST', body: JSON.stringify({ commander: name, list }) });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || res.status);
      // Columnas: % de las listas más parecidas a la tuya que la llevan, y % de todos los mazos del comandante
      const row = c => `<tr><td>${cn(c.card)}${c.core ? ' <span class="tag">core</span>' : ''}</td><td class="n">${pct(c.peer, 0)}</td><td class="n muted">${pct(c.inclusion, 0)}</td></tr>`;
      const tbl = (rows, empty) => rows.length
        ? `<table><thead><tr><th>Carta</th><th class="n" title="% de las listas más parecidas a la tuya que la llevan">En listas parecidas</th><th class="n" title="% de todos los mazos de este comandante">En todos</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table>`
        : `<div class="muted">${empty}</div>`;
      const P = r.profile, tot = Math.max(1, P.standard + P.common + P.tech + P.rare);
      const seg = (n, cls, label) => n ? `<i class="${cls}" style="width:${n / tot * 100}%" title="${label}: ${n}"></i>` : '';
      const chips = (list, note) => list.length ? `<div class="chips">${list.map(c => `<span class="chip" data-card="${esc(c.card)}">${esc(short(c.card, 28))} <small>${pct(c.inVariant, 0)}</small></span>`).join('')}</div>` : `<div class="muted">${note}</div>`;
      const v = r.variant;
      const variantBox = v ? `
        <div class="variant" style="margin-bottom:6px">
          <h3>Variante ${v.index + 1} de ${v.total}: ${esc(short(v.signature.slice(0, 2).map(c => c.card).join(' + ') || 'sin rasgos claros', 60))}</h3>
          <div>Llevas <b>${v.typical.have} de las ${v.typical.total}</b> cartas típicas (las juega la mitad o más) de esta variante.</div>
          <div class="muted" style="margin-top:4px">${v.decks} mazos (${pct(v.share, 0)} del total) · winrate ${pct(v.winRate)} (IC 95 %: ${pct(v.ci[0])}–${pct(v.ci[1])}) · ${pp(v.winRate - v.baseline)} frente a la media del meta</div>
          <div class="cols" style="margin-top:10px">
            <div><b>Cartas típicas que no llevas</b>${chips(v.missing, 'Llevas todas las cartas típicas de esta variante.')}</div>
            <div><b>Cartas tuyas que casi nadie de esta variante juega</b>${chips(v.extra, 'Ninguna: todas tus cartas aparecen en esta variante.')}</div>
          </div>
        </div>` : '<div class="muted">No hay mazos suficientes (se piden al menos 40) para separar variantes con el periodo y los filtros actuales.</div>';
      const nbRows = (r.neighbors || []).map(n => `
        <tr><td class="n">${pct(n.similarity, 0)}</td><td class="n">${n.shared}</td>
          <td>${esc(short(n.tournament, 46))} <span class="muted">· ${n.size} jug. · ${n.date}</span></td>
          <td class="n" title="victorias-derrotas-empates">${n.record}</td>
          <td><details><summary>Ver diferencias</summary>
            <div class="muted" style="margin-top:6px">Ellos llevan y tú no</div><div class="chips">${n.onlyThem.map(c => `<span class="chip" data-card="${esc(c)}">${esc(short(c, 26))}</span>`).join('') || '—'}</div>
            <div class="muted" style="margin-top:6px">Tú llevas y ellos no</div><div class="chips">${n.onlyYou.map(c => `<span class="chip" data-card="${esc(c)}">${esc(short(c, 26))}</span>`).join('') || '—'}</div>
          </details></td></tr>`).join('');
      const allRows = r.all.map(row).join('');
      out.innerHTML = `
        <div class="muted" style="margin-bottom:12px">${r.cards} cartas reconocidas (sin tierras básicas) sobre ${r.decks} mazos del meta.
          ${r.unknown.length ? `<br>No aparecen en ningún mazo de este comandante (¿nombre mal escrito o carta nueva?): ${esc(r.unknown.slice(0, 12).join(', '))}${r.unknown.length > 12 ? '…' : ''}` : ''}</div>

        <h2>Cuánto se parece tu lista al meta</h2>
        <div class="profile" role="img" aria-label="Estándar ${P.standard}, comunes ${P.common}, tech ${P.tech}, raras ${P.rare}">${seg(P.standard, 's1', 'Estándar')}${seg(P.common, 's2', 'Comunes')}${seg(P.tech, 's3', 'Tech')}${seg(P.rare, 's4', 'Raras')}</div>
        <div class="legend"><span><i class="s1"></i>Estándar ${P.standard} <small>(las juega el 40 % o más)</small></span><span><i class="s2"></i>Comunes ${P.common} <small>(10–40 %)</small></span><span><i class="s3"></i>Tech ${P.tech} <small>(2–10 %)</small></span><span><i class="s4"></i>Raras ${P.rare} <small>(menos del 2 %)</small></span></div>
        <div class="note" style="margin-bottom:18px">Más cartas estándar = una lista más parecida a la media; más tech o raras = una lista más personal. Ninguna de las dos cosas es mejor por sí sola: es solo una forma de ver cuánto se parece tu lista a lo que se juega.</div>

        <h2>Variante más parecida</h2>
        ${variantBox}

        <h2 style="margin-top:20px">Listas reales más parecidas a la tuya</h2>
        ${nbRows ? `<table><thead><tr><th class="n">Parecido</th><th class="n">Cartas en común</th><th>Torneo</th><th class="n" title="victorias-derrotas-empates">Récord</th><th></th></tr></thead><tbody>${nbRows}</tbody></table>
        <div class="note">Cada fila es un mazo real (sin nombre de jugador) y lo que sacó en ese torneo. Son pocas partidas por mazo, así que sirve para ver cómo rindieron listas casi iguales a la tuya, <b>no para predecir tu resultado</b>: lo hemos comprobado y las listas parecidas no predicen mejor que la media del comandante. Las listas idénticas cuentan una sola vez.</div>` : '<div class="muted">No hay listas suficientes para comparar.</div>'}

        <h2 style="margin-top:22px">Qué te falta o te sobra frente a listas como la tuya</h2>
        <div class="muted" style="margin-bottom:10px">Se compara con las <b>${r.peers.n} listas más parecidas</b> a la tuya (parecido medio ${pct(r.peers.similarity, 0)}), no con todo el meta, para que las sugerencias encajen con tu plan de juego.</div>
        <div class="cols wide">
          <div><div class="row"><h2>Las llevan casi todas y tú no</h2>${r.missing.length ? '<button class="ghost" data-copy="missing">Copiar lista</button>' : ''}</div>${tbl(r.missing, 'Llevas todo lo que juega la mayoría de listas parecidas.')}</div>
          <div><div class="row"><h2>Alternativas habituales que no llevas</h2>${r.options.length ? '<button class="ghost" data-copy="options">Copiar lista</button>' : ''}</div>${tbl(r.options, 'Ninguna alternativa se repite lo bastante en listas parecidas.')}</div>
        </div>
        <h2 style="margin-top:16px">Cartas tuyas poco habituales en listas como la tuya</h2>${tbl(r.unusual, 'Todas tus cartas las juega alguna lista parecida.')}
        <div class="note">Una carta poco habitual puede ser una decisión tuya (una carta de tu meta local, un plan propio). Aquí solo se señala qué se aparta de lo común: <b>no hay evidencia de que sea peor</b>. Estas sugerencias reflejan lo que juegan las listas parecidas, no una promesa de que mejoren tu resultado: lo comprobamos con cambios reales de lista de los mismos jugadores y el winrate asociado a cada carta no predice mejoras.</div>

        <details style="margin-top:20px"><summary><b>Todas tus cartas (${r.all.length}) y cuánto se usan</b></summary>
          <table style="margin-top:8px"><thead><tr><th>Carta</th><th class="n" title="% de las listas más parecidas a la tuya que la llevan">En listas parecidas</th><th class="n" title="% de todos los mazos de este comandante">En todos</th></tr></thead><tbody>${allRows}</tbody></table>
        </details>`;
      out.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => copyText(r[b.dataset.copy].map(c => '1 ' + c.card).join('\n'), b));
    } catch (e) { out.innerHTML = `<span class="muted">${esc(e.message)}</span>`; }
  };
}

async function loadStatus() {
  const st = await api('/api/status');
  const per = { 30: 'último mes', 90: 'últimos 3 meses', 180: 'últimos 6 meses' }[F.days] || `últimos ${F.days} días`;
  const f = (F.min || F.max) ? ` · filtro: ${F.min || 0}–${F.max || '∞'} jugadores` : '';
  $('#status').textContent = st.updatedAt
    ? `${st.tournaments} torneos · ${st.decks} mazos · ${per}${f}${F.dec ? ' · solo partidas con ganador' : ''}${st.excluded && st.excluded.tournaments ? ` · ${st.excluded.tournaments} torneos no cEDH excluidos (casuales, precon, presupuesto…: ${st.excluded.decks} mazos)` : ''} · actualizado ${new Date(st.updatedAt).toLocaleString('es-ES')}`
    : (st.refreshing ? 'Descargando datos por primera vez, puede tardar unos minutos…' : 'Sin datos todavía');
  $('#banners').innerHTML =
    (st.mock ? '<div class="banner demo"><b>Modo demo:</b> datos sintéticos generados localmente, no son resultados reales.</div>' : '') +
    (st.coveredDays && F.days > st.coveredDays ? `<div class="banner demo">Solo hay datos de los últimos ${st.coveredDays} días${st.refreshing ? '; se está descargando el resto, recarga en unos minutos' : ''}, así que este periodo muestra lo mismo que ${st.coveredDays} días.</div>` : '') +
    (st.error ? (/^Sin clave/.test(st.error)
      ? `<div class="banner demo"><b>Aviso:</b> ${esc(st.error)}.</div>`            // no es un fallo: solo falta la clave de TopDeck
      : `<div class="banner">Error al actualizar: ${esc(st.error)}</div>`) : '');
  F.meta = st.metaWinRate ?? 0.25;
  return st;
}

async function show() {
  await loadStatus();
  if (view.t === 'cmd') {
    try { return await openCommander(view.name, view.minWith); }
    catch { view = { t: 'list' }; } // el comandante no tiene datos con este filtro
  }
  if (view.t === 'cmp') {
    try { return await openCompare(view.a, view.b); }
    catch { view = { t: 'list' }; }
  }
  commanders = await api('/api/commanders?min=5');
  renderList();
}

async function boot() {
  const st = await loadStatus();
  if (!st.decks) { setTimeout(boot, 5000); return; }
  await show();
}

function bindFilters() {
  const apply = () => { F.min = $('#fmin').value; F.max = $('#fmax').value; show().catch(e => { $('#status').textContent = 'Error: ' + e.message; }); };
  $('#fmin').onchange = apply; $('#fmax').onchange = apply;
  const seg = () => {
    document.querySelectorAll('#period button').forEach(b => { const on = Number(b.dataset.d) === F.days; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    document.querySelectorAll('#draws button').forEach(b => { const on = Number(b.dataset.dec) === F.dec; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  };
  document.querySelectorAll('#period button').forEach(b => b.onclick = () => { F.days = Number(b.dataset.d); seg(); apply(); });
  document.querySelectorAll('#draws button').forEach(b => b.onclick = () => { F.dec = Number(b.dataset.dec); seg(); apply(); });
  seg();
  document.querySelectorAll('#filters [data-p]').forEach(b => b.onclick = () => {
    const [a, c] = b.dataset.p.split(',');
    $('#fmin').value = a === '0' ? '' : a; $('#fmax').value = c === '0' ? '' : c;
    apply();
  });
}

// ---- Preparar mesa ----
async function bindTableTool() {
  const box = $('#tb-pick');
  await ensureCommanders();
  const opts = (selected) => commanders.map(c => `<option value="${esc(c.commander)}" ${c.commander === selected ? 'selected' : ''}>${esc(cmdLabel(c.commander))} (${c.decks})</option>`).join('');
  const saved = JSON.parse(store.get('mesa') || '{}');
  box.innerHTML = `
    <label>Tu comandante <select id="tb-me">${opts(saved.me)}</select></label>
    ${[1, 2, 3].map(i => `<label>Rival ${i}${i > 1 ? ' (opcional)' : ''} <select id="tb-r${i}"><option value="">—</option>${opts(saved['r' + i])}</select></label>`).join('')}
    <button class="primary" id="tb-go">Preparar mesa</button>`;
  $('#tb-go').onclick = runTable;
  if (saved.me && saved.r1) runTable();
}

async function runTable() {
  const out = $('#tb-out');
  const me = $('#tb-me').value, rs = [1, 2, 3].map(i => $('#tb-r' + i).value);
  if (!rs[0]) { out.innerHTML = '<div class="panel muted">Elige al menos un rival.</div>'; return; }
  store.set('mesa', JSON.stringify({ me, r1: rs[0], r2: rs[1], r3: rs[2] }));
  out.innerHTML = '<div class="panel muted">Calculando…</div>';
  try {
    const r = await api(`/api/table?me=${encodeURIComponent(me)}${rs.map((x, i) => x ? `&r${i + 1}=${encodeURIComponent(x)}` : '').join('')}`);
    const tone2 = x => x.z == null ? 'muted' : x.z >= 2 ? 'pos-t' : x.z <= -2 ? 'neg-t' : 'muted';
    const cell = (x, label) => !x.pods ? '<span class="muted">sin mesas</span>' : x.enough ? `${pct(x.winRate)}` : `<span class="muted" title="Menos de ${r.minPods} mesas">${pct(x.winRate)} · pocas</span>`;
    const rows = r.rows.map(x => `<tr><td>${cmdBtn(x.rival)}</td><td class="n">${x.pods}</td><td class="n">${cell(x)}</td><td class="n muted">${x.winRateWithout == null ? '—' : pct(x.winRateWithout)}</td>
      <td class="n ${tone2(x)}">${x.enough ? pp(x.lift) : '—'}</td><td class="n muted">${x.enough ? x.z.toFixed(1) : 'muestra insuficiente'}</td></tr>`).join('');
    const multi = r.any ? `<div style="margin-top:10px">
        <div>Mesas con <b>alguno</b> de ellos: <b>${r.any.pods}</b> · winrate ${r.any.winRate == null ? '—' : pct(r.any.winRate)} (sin ninguno: ${r.any.winRateWithout == null ? '—' : pct(r.any.winRateWithout)})</div>
        <div>Mesas con <b>todos a la vez</b>: <b>${r.all.pods}</b>${r.all.enough ? ` · winrate ${pct(r.all.winRate)}` : ` <span class="muted">(muy pocas para concluir nada)</span>`}</div></div>` : '';
    const rivalCards = r.cards.map(c => `
      <div class="panel"><h2>${cmdBtn(c.rival, cmdLabel(c.rival))} <small class="muted">${c.decks} mazos</small></h2>
        ${c.distinctive.length ? `<div class="muted" style="margin-bottom:6px">Lo que lo distingue (lo lleva mucho más que el meta en general):</div>
          <div class="chips">${c.distinctive.map(x => `<span class="chip" data-card="${esc(x.card)}" title="Lo lleva el ${pct(x.inclusion, 0)} de sus mazos frente al ${pct(x.meta, 0)} de todo el meta">${esc(short(x.card, 26))} <small>${pct(x.inclusion, 0)} <span class="muted">vs ${pct(x.meta, 0)}</span></small></span>`).join('')}</div>`
          : '<div class="muted">No tiene cartas que lo distingan claramente del resto del meta.</div>'}
        <div class="threats" data-rival="${esc(c.rival)}"><span class="muted">Consultando sus combos…</span></div>
        <details style="margin-top:8px"><summary class="muted">Sus cartas más jugadas</summary><div class="chips" style="margin-top:6px">${c.top.map(x => `<span class="chip" data-card="${esc(x.card)}">${esc(short(x.card, 26))} <small>${pct(x.inclusion, 0)}</small></span>`).join('')}</div></details>
      </div>`).join('');
    out.innerHTML = `
      <div class="panel">
        <h2>${cmdBtn(r.me, cmdLabel(r.me))} contra ${r.rows.map(x => esc(cmdLabel(x.rival))).join(', ')}</h2>
        <div class="muted" style="margin-bottom:8px">${r.pods} mesas de este comandante · winrate general ${pct(r.baseline)}</div>
        <table><thead><tr><th>Rival en la mesa</th><th class="n">Mesas con él</th><th class="n">Winrate con él</th><th class="n">Sin él</th><th class="n">Diferencia</th><th class="n">z</th></tr></thead><tbody>${rows}</tbody></table>
        ${multi}
        <div class="note">Los matchups en cEDH suelen ser <b>casi planos</b>: un z cerca de 0 significa que no se distingue de jugar sin ese rival (solo se colorea con |z| ≥ 2). Es histórico, no una predicción: las mesas de un mismo torneo no son independientes y cambiar de rival cambia también a quién más te sientas. ${F.dec ? 'Solo mesas con ganador y rivales conocidos.' : 'Los empates cuentan como mesa no ganada.'}</div>
      </div>
      ${r.shared.length ? `<div class="panel"><h2>Cartas que verás casi seguro</h2>
        <div class="muted" style="margin-bottom:6px">Las llevan al menos el 60 % de los mazos de dos o más de tus rivales y no las juega todo el meta.</div>
        <div class="chips">${r.shared.map(x => `<span class="chip" data-card="${esc(x.card)}" title="La llevan ${x.rivals} de tus rivales; en todo el meta, el ${pct(x.meta, 0)}">${esc(short(x.card, 26))} <small>${x.rivals}/${r.rows.length}</small></span>`).join('')}</div></div>` : ''}
      <div class="cols wide">${rivalCards}</div>`;
    out.querySelectorAll('.threats').forEach(el => loadThreats(el));
  } catch (e) { out.innerHTML = `<div class="panel muted">${esc(e.message)}</div>`; }
}

// Amenazas de un rival: sus líneas de combo más jugadas y las piezas clave (el detalle está en la ficha del comandante)
async function loadThreats(el) {
  try {
    // Las cartas por función no dependen de Spellbook: salen enseguida aunque su servicio tarde o falle
    const th = await api(`/api/threats?name=${encodeURIComponent(el.dataset.rival)}`).catch(() => null);
    const top = id => th ? (th.categories.find(c => c.id === id) || { cards: [] }).cards.filter(c => c.inclusion >= 0.4).slice(0, 4) : [];
    const brief = [['Remates', 'finishers'], ['Esperar interacción', 'interaction']].map(([label, id]) => top(id).length
      ? `<div class="muted" style="margin-top:4px">${label}: ${top(id).map(c => `${cardBtn(c.card)} (${pct(c.inclusion, 0)})`).join(' · ')}</div>` : '').join('');
    el.innerHTML = `<h4 style="margin:12px 0 6px;font-size:13px">De qué preocuparse</h4>${brief}<div class="muted" style="margin-top:6px">Consultando sus combos…</div>`;
    const r = await api(`/api/combos?name=${encodeURIComponent(el.dataset.rival)}`, { days: F.days });
    const lines = [...r.lines.filter(l => l.kind === 'win'), ...r.lines.filter(l => l.kind !== 'win' && l.usage < 0.9)].slice(0, 3);
    el.innerHTML = `<h4 style="margin:12px 0 6px;font-size:13px">De qué preocuparse</h4>${brief}
      <div class="muted" style="margin-top:8px">Líneas de combo:</div>
      ${lines.length ? lines.map(l => `<div class="tline k-${l.kind}"><span class="tl-k">${cardBtn(l.key)}</span> <b>${pct(l.usage, 0)}</b>
        <span class="muted">${l.kind === 'win' ? 'gana la partida' : 'motor'} · ${esc(l.effects.slice(0, 2).map(e => e.name).join(', '))}</span></div>`).join('')
        : '<div class="muted">No se detectan líneas de combo claras.</div>'}
      ${r.keyPieces.length ? `<div class="muted" style="margin-top:6px">Piezas clave: ${r.keyPieces.slice(0, 3).map(k => `${cardBtn(k.card)} (${pct(k.usage, 0)})`).join(' · ')}</div>` : ''}`;
  } catch (e) {
    el.querySelectorAll('.muted').forEach(m => { if (/Consultando sus combos/.test(m.textContent)) m.remove(); });
    el.insertAdjacentHTML('beforeend', `<div class="muted" style="margin-top:8px">Combos no disponibles ahora: ${esc(e.message)}</div>`);
  }
}

// ---- Abrir un comandante o buscar una carta desde cualquier tabla (elementos con data-open-cmd / data-open-card) ----
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-open-cmd],[data-open-card]');
  if (!el) return;
  if (el.dataset.openCmd) { view = { t: 'cmd', name: el.dataset.openCmd, minWith: 5 }; openCommander(el.dataset.openCmd); return; }
  await ensureCommanders();
  view = { t: 'list', tab: 'cartas', card: el.dataset.openCard };
  renderList();
});
// Etiqueta corta de un comandante: con pareja, solo los nombres de pila («Rograkh + Thrasios»); si no, el nombre recortado
const cmdLabel = name => name.includes(' / ') ? name.split(' / ').map(p => p.split(',')[0]).join(' + ') : short(name, 34);
const cmdBtn = (name, label) => `<button type="button" class="linklike" data-open-cmd="${esc(name)}" data-card="${esc(name)}" title="${esc(name)}">${esc(label ?? cmdLabel(name))}</button>`;
const cardBtn = name => `<button type="button" class="linklike" data-open-card="${esc(name)}" data-card="${esc(name)}">${esc(name)}</button>`;
const dayMonth = t => new Date(t).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });

// ---- Cartas a tener en cuenta (remates, interacción, tutores, maná rápido y odio) ----
async function loadThreatCards(name) {
  const box = $('#th');
  try {
    const r = await api(`/api/threats?name=${encodeURIComponent(name)}`);
    const chip = c => `<span class="chip" data-card="${esc(c.card)}" title="Lo lleva el ${pct(c.inclusion, 0)} de sus mazos; en todo el meta, el ${pct(c.meta, 0)}">${esc(short(c.card, 26))} <small>${pct(c.inclusion, 0)}</small></span>`;
    box.className = 'muted-reset';
    box.innerHTML = `
      ${r.defining.length ? `<h3 class="sec">Lo que define a este mazo</h3><div class="muted" style="margin-bottom:6px">Cartas que lleva mucho más que el meta en general (el número es su porcentaje de mazos).</div>
        <div class="chips">${r.defining.map(chip).join('')}</div>` : ''}
      ${r.categories.map(cat => {
        const more = cat.avg - cat.metaAvg;
        return `<h3 class="sec">${esc(cat.label)} <small class="muted">· de media ${cat.avg.toFixed(1)} por mazo (meta: ${cat.metaAvg.toFixed(1)})${Math.abs(more) >= 1 ? (more > 0 ? ' <b>más que el meta</b>' : ' <b>menos que el meta</b>') : ''}</small></h3>
          <div class="muted" style="margin-bottom:6px">${esc(cat.hint)}</div>
          ${cat.cards.length ? `<div class="chips">${cat.cards.map(chip).join('')}</div>` : '<div class="muted">Casi ninguna de estas cartas aparece en sus mazos.</div>'}`;
      }).join('')}
      <div class="note">Las listas por función son de criterio (no salen de los datos) y se pueden editar en <code>lib/threats.js</code>; el porcentaje sí sale de los ${r.decks} mazos de este comandante. Mana Crypt, Jeweled Lotus y Dockside Extortionist están prohibidas en Commander y no figuran.</div>`;
  } catch (e) { box.className = 'muted'; box.textContent = e.message; }
}

// ---- Combos y amenazas (datos de Commander Spellbook cruzados con nuestros mazos) ----
const effChip = e => `<span class="eff ${e.terminal ? 'win' : ''}" title="${e.terminal ? 'Gana la partida' : e.status === 'S' ? 'Efecto autónomo' : 'Efecto auxiliar'}">${esc(e.name)}</span>`;
function lineHtml(l) {
  const kindTag = { win: 'Gana la partida', engine: 'Motor: necesita un remate', helper: 'Auxiliar' }[l.kind];
  return `<div class="line k-${l.kind}">
    <div class="lh"><span class="lk">${cardBtn(l.key)}</span>
      <div class="wr" style="min-width:150px"><b>${pct(l.usage, 0)}</b><div class="bar" style="flex:1"><i class="pos" style="left:0;width:${l.usage * 100}%"></i></div></div>
      <span class="tag" title="Combos distintos que usan esta pieza como pieza clave">${l.combos} ${l.combos === 1 ? 'combo' : 'combos'}</span></div>
    <div class="muted" style="font-size:12.5px">${kindTag} · lo pueden hacer el ${pct(l.usage, 0)} de los mazos</div>
    <div class="effs">${l.effects.map(effChip).join('')}</div>
    ${l.enablers.length ? `<div class="muted" style="margin-top:6px">Con: ${l.enablers.map(e => cardBtn(e.card)).join(' · ')}</div>` : ''}
    <details style="margin-top:6px"><summary class="muted">Cómo funciona</summary>
      ${l.best.map(b => `<div class="combo"><div class="chips">${b.cards.map(c => `<span class="chip" data-card="${esc(c)}">${esc(short(c, 26))}</span>`).join('')}</div>
        <div class="muted" style="margin:4px 0">Lo juega el ${pct(b.usage, 0)} de los mazos · <a href="${esc(b.url)}" target="_blank" rel="noopener">ver en Commander Spellbook</a></div>
        ${b.prerequisites ? `<div class="muted" style="font-size:12.5px"><b>Requisitos:</b> ${esc(b.prerequisites).replace(/\n/g, '<br>')}</div>` : ''}
        ${b.steps ? `<pre class="steps">${esc(b.steps)}</pre>` : ''}</div>`).join('')}
    </details></div>`;
}
async function loadCombos(name) {
  const box = $('#cb');
  try {
    const r = await api(`/api/combos?name=${encodeURIComponent(name)}`, { days: F.days });
    const wins = r.lines.filter(l => l.kind === 'win');
    const rest = r.lines.filter(l => l.kind !== 'win');
    const base = rest.filter(l => l.usage >= 0.9), engines = rest.filter(l => l.usage < 0.9);
    box.className = 'muted-reset';
    box.innerHTML = `
      <div><b>${r.shown}</b> de los ${r.totalCombos} combos que encajan con las cartas de este comandante se juegan en torneos cEDH; el <b>${pct(r.coverage, 0)}</b> de los ${r.decks} mazos tiene al menos uno.</div>
      <h2 style="margin-top:18px">Líneas que ganan la partida</h2>
      ${wins.length ? wins.map(lineHtml).join('') : '<div class="muted">Ningún combo de victoria directa se juega con frecuencia: este comandante suele ganar con un motor y un remate (mira los motores).</div>'}
      <h2 style="margin-top:18px">Motores <small class="muted">(infinitos que necesitan un remate)</small></h2>
      ${engines.length ? engines.map(lineHtml).join('') : '<div class="muted">Sin motores destacados.</div>'}
      ${base.length ? `<details style="margin-top:14px"><summary><b>Lo que casi todos los mazos hacen</b> <span class="muted">(${base.length}; 90 % o más)</span></summary>${base.map(lineHtml).join('')}</details>` : ''}
      <h2 style="margin-top:18px">Piezas clave: de qué preocuparse</h2>
      ${r.keyPieces.length ? `<table><thead><tr><th>Carta</th><th class="n" title="% de mazos que dependen de ella para algún combo jugado">Mazos que la usan en un combo</th></tr></thead><tbody>${r.keyPieces.map(k => `<tr><td>${cardBtn(k.card)}</td><td class="n">${pct(k.usage, 0)}</td></tr>`).join('')}</tbody></table>
        <div class="note">Si te enfrentas a este comandante, son las piezas cuya carta (o su respuesta) más líneas de combo condiciona. Se excluyen las cartas que juega casi todo el meta (Sol Ring, Mana Vault…).</div>` : '<div class="muted">Sin piezas destacadas.</div>'}
      <div class="note">Combos de <a href="https://commanderspellbook.com" target="_blank" rel="noopener">Commander Spellbook</a>, cruzados con los mazos de TopDeck. Solo se consultan las cartas que este comandante juega en al menos el 10 % de sus mazos; recoge combos infinitos y de victoria, <b>no remates por valor ni victorias sin combo</b>, así que «sin combo detectado» no significa inofensivo. Los nombres de los efectos están en inglés, como en su web.${r.stale ? ' <b>Datos guardados:</b> Spellbook no responde ahora.' : ''}</div>`;
  } catch (e) { box.className = 'muted'; box.textContent = e.message; }
}

// ---- Meta del momento ----
const TIERS = {
  S: 'Claramente por encima de la media', A: 'Por encima de la media', B: 'En la media o sin datos claros',
  C: 'Por debajo de la media', D: 'Claramente por debajo de la media',
};
const PALETTE = ['#b4532a', '#2f7d4f', '#3b6ea8', '#c28b1e', '#7a4fa3', '#2a8f8f', '#b3372f', '#6b8e23'];
async function loadMeta() {
  const box = $('#meta');
  try {
    const r = await api('/api/meta');
    if (!r.commanders.length) { box.textContent = 'Sin datos suficientes con el periodo y filtros actuales.'; return; }
    const top = r.commanders.slice(0, 8), n = r.buckets.length, H = 190;
    const col = i => {            // i = 0 más antiguo … n-1 más reciente
      const segs = top.map(c => c.series[i]), other = Math.max(0, 1 - segs.reduce((a, b) => a + b, 0));
      return { segs, other };
    };
    const stack = r.buckets.map((b, i) => {
      const { segs, other } = col(i);
      return `<div class="stackcol"><div class="stackbar" role="img" aria-label="Periodo hasta ${dayMonth(b.end)}">
        <i style="height:${other * H}px;background:var(--line)" title="Otros: ${pct(other)}"></i>
        ${segs.map((v, k) => `<i style="height:${v * H}px;background:${PALETTE[k]}" title="${esc(top[k].commander)}: ${pct(v)}"></i>`).reverse().join('')}
        </div><small>${dayMonth(b.end)}</small></div>`;
    }).join('');
    const legend = top.map((c, k) => `<span title="${esc(c.commander)}"><i style="background:${PALETTE[k]}"></i>${esc(cmdLabel(c.commander))} <small>${pct(c.share, 0)}</small></span>`).join('') + `<span><i style="background:var(--line)"></i>Otros</span>`;
    const by = {}; for (const c of r.commanders) (by[c.tier] = by[c.tier] || []).push(c);
    const tiers = Object.keys(TIERS).filter(t => by[t]).map(t => `
      <div class="tier t${t}"><div class="tl"><b>${t}</b><small>${TIERS[t]}</small></div>
        <div class="tc">${by[t].map(c => `<span class="tchip">${cmdBtn(c.commander)} <small>${pct(c.winRate)} · ${c.decks} mazos</small></span>`).join('')}</div></div>`).join('');
    const movers = [...r.commanders].sort((a, b) => b.change - a.change);
    const mv = list => list.map(c => `<tr><td>${cmdBtn(c.commander)}</td><td class="n">${pct(c.series[n - 1], 1)}</td><td class="n ${c.change >= 0 ? 'pos-t' : 'neg-t'}">${pp(c.change)}</td></tr>`).join('');
    const draws = [...r.commanders].sort((a, b) => b.drawRate - a.drawRate);
    const maxDraw = Math.max(0.01, ...r.buckets.map(b => b.drawRate || 0));
    const dr = list => list.map(c => `<tr><td>${cmdBtn(c.commander)}</td><td class="n">${pct(c.drawRate, 0)}</td></tr>`).join('');
    box.className = 'muted-reset';
    box.innerHTML = `
      <div>Meta de los últimos días elegidos: <b>${r.decksInPeriod}</b> mazos cEDH · winrate medio <b>${pct(r.mean)}</b> ${F.dec ? '(solo partidas con ganador)' : '(empates como no ganadas)'}.</div>

      <h2 style="margin-top:18px">Presencia en el meta, mes a mes</h2>
      <div class="stack">${stack}</div>
      <div class="legend" style="margin-top:8px">${legend}</div>
      <div class="note">Cada barra es un periodo de 30 días (etiquetado con su fecha final) y su altura reparte el 100 % de los mazos de ese periodo entre los ocho comandantes más jugados y el resto.</div>

      <h2 style="margin-top:20px">Niveles por resultados</h2>
      <div class="tiers">${tiers}</div>
      <div class="note">El nivel sale del <b>intervalo de confianza del winrate</b> frente a la media del meta (${pct(r.mean)}): S y D solo si el intervalo queda a más de 2 puntos de la media; A y C si queda entero por encima o por debajo; B si no se distingue de la media (poca muestra o rendimiento medio). Solo entran los comandantes con ${r.minDecks} mazos o más. <b>Es una descripción de resultados, no de la fuerza del mazo</b>: el winrate refleja también al jugador y al plan.</div>

      <div class="cols wide" style="margin-top:20px">
        <div><h2>Suben en presencia</h2><table><thead><tr><th>Comandante</th><th class="n">Ahora</th><th class="n" title="Último periodo frente a la media de los dos anteriores">Cambio</th></tr></thead><tbody>${mv(movers.slice(0, 5))}</tbody></table></div>
        <div><h2>Bajan en presencia</h2><table><thead><tr><th>Comandante</th><th class="n">Ahora</th><th class="n" title="Último periodo frente a la media de los dos anteriores">Cambio</th></tr></thead><tbody>${mv(movers.slice(-5).reverse())}</tbody></table></div>
      </div>

      <h2 style="margin-top:20px">Empates</h2>
      <div class="spark">${r.buckets.map(b => `<div class="sb" title="${b.decks} mazos"><small>${b.drawRate == null ? '—' : pct(b.drawRate, 1)}</small>
        <i style="height:${b.drawRate == null ? 0 : Math.max(2, b.drawRate / maxDraw * 60)}px"></i><small class="d">${dayMonth(b.end)}</small></div>`).join('')}</div>
      <div class="note" style="margin-bottom:10px">Porcentaje de partidas que acaban en empate, por periodos de 30 días. La tasa de empates es una característica estable de cada comandante.</div>
      <div class="cols wide">
        <div><h2>Más empates</h2><table><thead><tr><th>Comandante</th><th class="n">Empates</th></tr></thead><tbody>${dr(draws.slice(0, 6))}</tbody></table></div>
        <div><h2>Menos empates</h2><table><thead><tr><th>Comandante</th><th class="n">Empates</th></tr></thead><tbody>${dr(draws.slice(-6).reverse())}</tbody></table></div>
      </div>`;
  } catch (e) { box.textContent = e.message; }
}

// ---- Novedades del meta ----
async function loadNovelties() {
  const box = $('#nov');
  try {
    const r = await api('/api/novelties');
    if (r.tooFew) { box.textContent = 'Hacen falta más mazos recientes para detectar novedades con los filtros actuales.'; return; }
    const where = c => c.commanders.map(x => cmdBtn(x.commander)).join(' · ');
    const table = (rows, empty, extra) => rows.length ? `<table><thead><tr><th>Carta</th><th class="n" title="% de mazos que la llevaban en los dos meses anteriores">Antes</th><th class="n">Último mes</th><th class="n">Cambio</th><th>Dónde se juega más</th></tr></thead>
      <tbody>${rows.map(c => `<tr><td>${cardBtn(c.card)}${extra ? extra(c) : ''}</td><td class="n muted">${pct(c.base, 0)}</td><td class="n">${pct(c.recent, 0)}</td>
        <td class="n ${c.change >= 0 ? 'pos-t' : 'neg-t'}">${pp(c.change)}</td><td>${where(c)}</td></tr>`).join('')}</tbody></table>` : `<div class="muted">${empty}</div>`;
    box.className = 'muted-reset';
    box.innerHTML = `
      <div>Se compara el <b>último mes</b> (${r.recentDecks} mazos) con los <b>dos meses anteriores</b> (${r.baseDecks} mazos). Pulsa una carta para ver su ficha.</div>
      <h2 style="margin-top:16px">Cartas nuevas en el meta</h2>
      ${table(r.fresh, 'No hay cartas que hayan aparecido en los datos hace poco con uso apreciable.', c => ` <span class="tag" title="Primera vez en los datos: ${new Date(c.firstSeen).toLocaleDateString('es-ES')}">nueva</span>`)}
      <div class="cols wide" style="margin-top:18px">
        <div><h2>En ascenso</h2>${table(r.rising, 'Ninguna carta sube de forma clara.')}</div>
        <div><h2>En descenso</h2>${table(r.falling, 'Ninguna carta baja de forma clara.')}</div>
      </div>
      <div class="note">Un cambio solo cuenta si es de al menos 2 puntos y estadísticamente claro (z ≥ 3), para que no se cuele el ruido. Solo describe qué se juega, <b>no si la carta funciona mejor o peor</b>. «Nueva» significa que no aparece en los datos hasta hace poco (por ejemplo, una edición recién publicada).</div>`;
  } catch (e) { box.textContent = e.message; }
}

// ---- Alternativas a una carta (dentro del buscador) ----
async function loadAlternatives(card, commander) {
  const out = $('#alt-out');
  out.innerHTML = '<span class="muted">Calculando…</span>';
  try {
    const r = await api(`/api/card-alternatives?name=${encodeURIComponent(card)}&commander=${encodeURIComponent(commander)}`);
    if (r.tooFew) {
      out.innerHTML = `<div class="muted">No hay mazos parecidos sin ${esc(card)} con los que comparar (${r.withoutCard} sin ella, ${r.similar ?? 0} parecidos): los que no la llevan juegan otra versión del mazo.</div>`;
      return;
    }
    out.innerHTML = `<div class="muted" style="margin-bottom:8px">Se comparan los <b>${r.withCard}</b> mazos que la llevan con los <b>${r.similar}</b> mazos que no la llevan pero se parecen a ellos (de ${r.withoutCard} sin ella).</div>
      ${r.alternatives.length ? `<table><thead><tr><th>Carta</th><th class="n" title="% de los mazos parecidos sin la carta que la llevan">Sin ${esc(short(card, 18))}</th><th class="n">Con ella</th></tr></thead>
      <tbody>${r.alternatives.map(a => `<tr><td>${cardBtn(a.card)}</td><td class="n">${pct(a.withoutCard, 0)}</td><td class="n muted">${pct(a.withCard, 0)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="muted">Ninguna carta destaca como alternativa clara.</div>'}
      <div class="note">Es lo que juegan <b>en su lugar</b> los mazos parecidos, no una prueba de que sean equivalentes. A veces reflejan otra versión del mazo.</div>`;
  } catch (e) { out.innerHTML = `<span class="muted">${esc(e.message)}</span>`; }
}

// ---- Buscador de cartas ----
function bindCardSearch() {
  const q = $('#cs-q'), box = $('#cs-sug');
  let timer = null;
  const pick = name => { q.value = name; box.innerHTML = ''; searchCard(name); };
  q.oninput = () => {
    clearTimeout(timer);
    const v = q.value.trim();
    if (v.length < 2) { box.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const r = await api('/api/cards?q=' + encodeURIComponent(v));
        // Cada sugerencia: nombre de la carta y, apagado, cuántos mazos la llevan; la imagen sale al pasar el ratón
        box.innerHTML = r.map(x => `<button type="button" class="sug" data-n="${esc(x.card)}" data-card="${esc(x.card)}">
          <span class="nm">${esc(x.card)}</span><span class="ct">${x.decks.toLocaleString('es-ES')} ${x.decks === 1 ? 'mazo' : 'mazos'}</span></button>`).join('');
        box.querySelectorAll('button').forEach(b => { b.onclick = () => pick(b.dataset.n); });
      } catch { box.innerHTML = ''; }
    }, 150);
  };
  q.onkeydown = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = box.querySelector('button');
    if (first) pick(first.dataset.n); else if (q.value.trim()) searchCard(q.value.trim());
  };
  if (view.card) { q.value = view.card; searchCard(view.card); }
}

async function searchCard(name) {
  const out = $('#cs-out');
  view.card = name; writeHash();
  out.innerHTML = '<div class="panel muted">Buscando…</div>';
  try {
    const r = await api('/api/card?name=' + encodeURIComponent(name));
    const day = t => new Date(t).toLocaleDateString('es-ES');
    const maxShare = Math.max(0.01, ...r.trend.map(b => b.share || 0));
    const last = r.trend[r.trend.length - 1], prev = r.trend[r.trend.length - 2];
    const delta = last && prev && last.share != null && prev.share != null ? last.share - prev.share : null;
    const isNew = r.firstSeen && r.dataStart && r.firstSeen - r.dataStart > 14 * 86400000;
    const per = { 30: 'último mes', 90: 'últimos 3 meses', 180: 'últimos 6 meses' }[F.days] || `últimos ${F.days} días`;
    out.innerHTML = `
      <div class="panel">
        <h2 style="font-size:20px">${cn(r.card)}</h2>
        <div>Se juega en <b>${r.decks}</b> de ${r.total} mazos cEDH (<b>${pct(r.share)}</b>) · ${per}</div>
        ${isNew ? `<div class="muted">Aparece por primera vez en los datos el ${day(r.firstSeen)}: es una carta reciente en el meta.</div>` : ''}
        <h2 style="margin-top:16px">Evolución (% de todos los mazos que la llevan, por periodos de 30 días)</h2>
        <div class="spark">${r.trend.map(b => `<div class="sb" title="${b.decks} de ${b.total} mazos hasta el ${day(b.end)}">
          <small>${b.share == null ? '—' : pct(b.share, b.share < 0.1 ? 1 : 0)}</small>
          <i style="height:${b.share == null ? 0 : Math.max(2, b.share / maxShare * 60)}px"></i>
          <small class="d">${new Date(b.end).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}</small></div>`).join('')}</div>
        ${delta == null ? '' : `<div class="note">Último periodo frente al anterior: <b class="${delta >= 0 ? 'pos-t' : 'neg-t'}">${pp(delta)}</b>.</div>`}
      </div>
      <div class="cols wide">
        <div class="panel"><h2>Comandantes que la juegan</h2>
          ${r.commanders.length ? `<table><thead><tr><th>Comandante</th><th class="n" title="Mazos con la carta de los mazos totales del comandante">Mazos</th><th>% de sus mazos</th></tr></thead>
          <tbody>${r.commanders.map(c => `<tr class="click" data-c="${esc(c.commander)}" tabindex="0" role="link" aria-label="Abrir ${esc(c.commander)}">
            <td>${cn(c.commander)}</td><td class="n">${c.decks} <span class="muted">de ${c.of}</span></td>
            <td><div class="wr"><b>${pct(c.share, 0)}</b><div class="bar" style="flex:1"><i class="pos" style="left:0;width:${c.share * 100}%"></i></div></div></td></tr>`).join('')}</tbody></table>`
          : '<div class="muted">Ningún comandante la juega en al menos 3 mazos con el periodo y los filtros actuales.</div>'}</div>
        <div class="panel"><h2>Suele ir con</h2>
          ${r.together.length ? `<div class="muted" style="margin-bottom:8px">Cartas que llevan muchos más de los mazos que la juegan que el resto (frecuencia con ella frente a la general).</div>
          <table><thead><tr><th>Carta</th><th class="n">Con ${esc(short(r.card, 20))}</th><th class="n">En general</th></tr></thead>
          <tbody>${r.together.map(c => `<tr><td>${cn(c.card)}</td><td class="n">${pct(c.withCard, 0)}</td><td class="n muted">${pct(c.overall, 0)}</td></tr>`).join('')}</tbody></table>`
          : '<div class="muted">No hay cartas que la acompañen de forma destacada.</div>'}</div>
      </div>`;
    // Alternativas: solo si hay comandantes donde la carta no la lleven todos
    const eligible = r.commanders.filter(c => c.decks >= 25 && c.of - c.decks >= 25).slice(0, 10);
    out.insertAdjacentHTML('beforeend', `<div class="panel"><h2>¿Qué juegan en su lugar?</h2>${eligible.length
      ? `<label class="muted">Comandante: <select id="alt-cmd" style="width:auto">${eligible.map(c => `<option value="${esc(c.commander)}">${esc(short(c.commander, 46))} (${c.of - c.decks} mazos sin ella)</option>`).join('')}</select></label>
         <div id="alt-out" style="margin-top:10px"></div>`
      : '<div class="muted">En los comandantes que la juegan casi todos los mazos la llevan: no hay otros mazos con los que comparar.</div>'}</div>`);
    if (eligible.length) {
      $('#alt-cmd').onchange = e => loadAlternatives(r.card, e.target.value);
      loadAlternatives(r.card, eligible[0].commander);
    }
    const tb = out.querySelector('tbody');
    if (tb) {
      const open = e => { const tr = e.target.closest('tr[data-c]'); if (tr) { view = { t: 'cmd', name: tr.dataset.c, minWith: 5 }; openCommander(tr.dataset.c); } };
      out.querySelector('.cols .panel tbody').onclick = open;
      out.querySelector('.cols .panel tbody').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } };
    }
  } catch (e) { out.innerHTML = `<div class="panel muted">${esc(e.message)}</div>`; }
}

// Texto sobre cómo se cuentan los empates, según el modo elegido.
const drawNote = () => F.dec
  ? `Solo se cuentan las partidas con ganador: las empatadas salen del cálculo (su frecuencia está en «Empates»). Así la referencia ronda el 25 %, lo esperable con 4 jugadores.`
  : `Los empates cuentan como partida no ganada, por eso la media del meta queda por debajo del 25 %.`;

function renderList() {
  view = { t: 'list', tab: view.tab, card: view.card }; writeHash();
  const active = pickTab('list');
  $('#app').innerHTML = tabsHtml('list', active) +
    tabPanel('comandantes', active, `
    <div class="panel">
      <label class="sr" for="q">Buscar comandante</label>
      <input type="search" id="q" placeholder="Buscar comandante…" autofocus>
      <table style="margin-top:12px"><thead><tr>
        <th>Comandante</th><th class="n">Mazos</th><th class="n">Presencia en el meta</th><th>Winrate (la línea marca la media: ${pct(F.meta)})</th><th class="n">vs media</th><th class="n" title="Partidas empatadas sobre el total">Empates</th>
      </tr></thead><tbody id="rows"></tbody></table>
      <div class="note">La referencia es la <b>media del meta</b> en el periodo elegido (${pct(F.meta)}). ${drawNote()} Verde o rojo solo si el intervalo de confianza al 95 % queda entero por encima o por debajo de la media; en <b>gris</b> no se distingue de ella (suele ser falta de partidas). Se cuentan las partidas suizas y las eliminatorias.</div>
    </div>`) +
    tabPanel('meta', active, `<div id="meta" class="panel muted">Calculando…</div>`) +
    tabPanel('novedades', active, `<div id="nov" class="panel muted">Calculando…</div>`) +
    tabPanel('mesa', active, `
    <div class="panel">
      <h2>Preparar una mesa</h2>
      <div class="muted" style="margin-bottom:10px">Elige tu comandante y hasta tres rivales que esperas. Verás cómo le ha ido a tu comandante en las mesas donde estaban y qué cartas distinguen a esos mazos.</div>
      <div class="tablepick" id="tb-pick"><span class="muted">Cargando comandantes…</span></div>
    </div>
    <div id="tb-out"></div>`) +
    tabPanel('cartas', active, `
    <div class="panel">
      <h2>Buscar una carta</h2>
      <div class="muted" style="margin-bottom:8px">Escribe el nombre de una carta y mira en qué comandantes se juega, cuánto, si sube o baja y qué cartas suelen acompañarla. Solo mira lo que se juega en torneos cEDH, no si «funciona» mejor.</div>
      <label class="sr" for="cs-q">Nombre de la carta</label>
      <input type="search" id="cs-q" placeholder="Rhystic Study, Thassa's Oracle…" autocomplete="off">
      <div id="cs-sug" class="sugs" role="listbox" aria-label="Sugerencias de cartas"></div>
    </div>
    <div id="cs-out"></div>`) +
    tabPanel('matriz', active, `
    <div class="panel">
      <h2>Matriz de matchups (12 comandantes más jugados)</h2>
      <div id="matrix" class="muted">Calculando…</div>
      <div class="note">Cada celda es el winrate del comandante de la fila en mesas donde está el de la columna. Verde = por encima de su media, rojo = por debajo (color completo a ±8 puntos). «—»: menos de 30 mesas. ${F.dec ? 'Solo cuentan las mesas con ganador y con todos los comandantes conocidos.' : 'Los empates cuentan como mesa no ganada.'}</div>
    </div>`) +
    tabPanel('fiabilidad', active, `
    <div class="panel">
      <h2>¿Cuánto se puede fiar de las cartas recomendadas?</h2>
      <div id="validation" class="muted">Calculando…</div>
    </div>`);
  const maxShare = Math.max(0.001, ...commanders.map(c => c.metaShare));
  const draw = () => {
    const q = $('#q').value.toLowerCase();
    $('#rows').innerHTML = commanders.filter(c => c.commander.toLowerCase().includes(q)).map(c => `
      <tr class="click" data-c="${esc(c.commander)}" tabindex="0" role="link" aria-label="Abrir ${esc(c.commander)}">
        <td>${cn(c.commander)}</td><td class="n">${c.decks}</td>
        <td><div class="share">${pct(c.metaShare)}<span style="width:${Math.min(100, c.metaShare / maxShare * 60)}px"></span></div></td>
        <td><div class="wr"><b>${pct(c.winRate)}</b>${track(c.winRate - F.meta, .10, !sig(c.ci, F.meta))}</div></td>
        <td class="n ${tone(sig(c.ci, F.meta))}">${pp(c.winRate - F.meta)}</td>
        <td class="n muted">${pct(c.drawRate)}</td>
      </tr>`).join('');
    sortTable($('#rows').closest('table'));
  };
  $('#q').oninput = draw; draw();
  const open = e => { const tr = e.target.closest('tr'); if (tr) { view.tab = undefined; openCommander(tr.dataset.c); } };
  $('#rows').onclick = open;
  $('#rows').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } };
  bindTabs('list', { meta: loadMeta, novedades: loadNovelties, mesa: bindTableTool, cartas: bindCardSearch, matriz: loadMatrix, fiabilidad: loadValidation });
}

async function openCommander(name, minWith = 5) {
  view = { ...view, t: 'cmd', name, minWith }; writeHash();
  $('#app').innerHTML = '<div class="muted">Calculando…</div>';
  const r = await api(`/api/commander?name=${encodeURIComponent(name)}&minWith=${minWith}`);
  const maxLift = Math.max(0.01, ...[...r.best, ...r.worst].map(c => Math.abs(c.adj)));
  const lo = r.ci[0], hi = r.ci[1];
  // Escala del medidor: 0 % a un máximo redondeado que deje espacio a ambos lados del 25 %.
  const gmax = Math.max(0.5, Math.ceil((hi + 0.05) * 10) / 10);
  const gx = v => (Math.max(0, Math.min(gmax, v)) / gmax * 100).toFixed(1);

  const liftRows = list => list.slice(0, 25).map(c => `
    <tr><td>${cn(c.card)}</td>
      <td class="n">${pct(c.inclusion, 0)}</td>
      <td class="n muted">${pp(c.lift)}</td>
      <td class="n ${c.adj >= 0 ? 'pos-t' : 'neg-t'}">${pp(c.adj)}</td>
      <td style="width:90px"><div class="bar"><i class="${c.adj >= 0 ? 'pos' : 'neg'}" style="width:${Math.abs(c.adj) / maxLift * 50}%"></i></div></td>
      <td>${rel(c.q)}</td></tr>`).join('');
  const head = '<thead><tr><th>Carta</th><th class="n">En mazos</th><th class="n">Dif. bruta</th><th class="n" title="Diferencia encogida hacia 0 según el tamaño de la muestra">Ajustada</th><th></th><th>Fiabilidad</th></tr></thead>';

  const active = pickTab('cmd');
  $('#app').innerHTML = `
    <button class="back" id="back">← Todos los comandantes</button>
    <div class="head">
      <h2 style="font-size:20px">${cn(r.commander)}</h2>
      <div class="ctl" style="margin:0">
        <label>Comparar con: <select id="cmp"><option value="">— elige comandante —</option></select></label>
        <button class="ghost" id="share" title="Copia la dirección con el periodo, los filtros y este comandante">Copiar enlace</button>
      </div>
    </div>
    <div class="tiles" style="margin-top:12px">
      <div class="tile"><div class="v">${r.decks}</div><div class="l">mazos en ${r.tournaments} torneos</div></div>
      <div class="tile"><div class="v">${pct(r.winRate)}</div><div class="l">winrate (IC 95 %: ${pct(lo)}–${pct(hi)})</div></div>
      <div class="tile"><div class="v ${tone(sig(r.ci, r.baseline))}">${pp(r.winRate - r.baseline)}</div><div class="l">frente a la media del meta (${pct(r.baseline)})</div></div>
      <div class="tile"><div class="v">${r.games}</div><div class="l">${F.dec ? 'partidas con ganador' : 'partidas jugadas'}</div></div>
      <div class="tile"><div class="v">${pct(r.drawRate)}</div><div class="l">de las partidas acaban en empate</div></div>
    </div>
    <div class="panel">
      <h2>¿Rinde por encima de la media del meta?</h2>
      <div class="gauge">
        <div class="ci" style="left:${gx(lo)}%;width:${gx(hi) - gx(lo)}%"></div>
        <div class="mk" style="left:${gx(r.chance)}%;opacity:.22" title="25 %: azar puro en mesas de 4"></div>
        <div class="mk" style="left:${gx(r.baseline)}%"></div>
        <div class="pt" style="left:${gx(r.winRate)}%"></div>
        <span class="lb t2" style="left:${gx(r.baseline)}%">media del meta ${pct(r.baseline)}</span>
        <span class="lb t" style="left:${gx(r.winRate)}%;color:var(--accent);font-weight:600">${pct(r.winRate)}</span>
        ${gx(hi) - gx(lo) < 14
          ? `<span class="lb b" style="left:${(Number(gx(lo)) + Number(gx(hi))) / 2}%">IC 95 %: ${pct(lo)}–${pct(hi)}</span>`
          : `<span class="lb b" style="left:${gx(lo)}%">${pct(lo)}</span><span class="lb b" style="left:${gx(hi)}%">${pct(hi)}</span>`}
      </div>
      <div class="note" style="margin:0">${lo > r.baseline ? '<b class="pos-t">Por encima de la media</b>: el intervalo de confianza (zona sombreada) queda entero a la derecha de la media del meta.'
        : hi < r.baseline ? '<b class="neg-t">Por debajo de la media</b>: el intervalo queda entero a la izquierda de la media del meta.'
        : '<b>No se distingue de la media</b>: el intervalo (zona sombreada) incluye la media del meta; hacen falta más partidas para decidir.'}
        La línea tenue marca el 25 % del azar puro. ${drawNote()}</div>
    </div>
    ${tabsHtml('cmd', active)}
    ${tabPanel('cartas', active, `
      <div class="ctl">
        <label>Mínimo de mazos con la carta (y sin ella):
          <select id="min">${[3, 5, 10, 20].map(n => `<option ${n === minWith ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <div class="cols wide">
        <div class="panel"><h2>Cartas asociadas a más winrate</h2><table>${head}<tbody>${liftRows(r.best) || '<tr><td class="muted">Sin datos suficientes</td></tr>'}</tbody></table></div>
        <div class="panel"><h2>Cartas asociadas a menos winrate</h2><table>${head}<tbody>${liftRows(r.worst) || '<tr><td class="muted">Sin datos suficientes</td></tr>'}</tbody></table></div>
      </div>
      <div class="panel">
        <h2>Mapa de cartas: popularidad frente a rendimiento</h2>
        ${scatter(r.popular)}
        <div class="note">Cada punto es una carta; pasa el ratón para ver el detalle. Los puntos tenues son los de menos fiabilidad. Tamaño = nº de mazos que la juegan.</div>
      </div>
      <div class="panel">
        <h2>Cartas más jugadas con este comandante</h2>
        <label class="sr" for="cq">Filtrar carta</label>
        <input type="search" id="cq" placeholder="Filtrar carta…">
        <table style="margin-top:12px"><thead><tr><th>Carta</th><th class="n">Inclusión</th><th class="n">Winrate con ella</th><th class="n">Diferencia</th></tr></thead><tbody id="crows"></tbody></table>
      </div>
      <div class="panel note" style="margin:0">
        <b>Cómo leerlo.</b> «Dif. bruta» compara el winrate de los mazos que juegan la carta con los que no, para este comandante.
        <b>Ajustada</b> es esa diferencia «encogida» hacia 0 cuanto menos mazos hay: una carta en 6 mazos con +30 pts no gana a otra en 200 mazos con +5 pts (las tablas se ordenan por ella).
        <b>Fiabilidad</b> corrige por comparar cientos de cartas a la vez: «alta» = es poco probable que sea casualidad. Es <b>correlación, no causalidad</b>: una carta puede aparecer más en los mazos de jugadores mejores, o en mazos con otro plan de juego.
        Las cartas que casi todos juegan (<span class="tag">core</span>) no se pueden comparar por falta de mazos sin ellas.
      </div>`)}
    ${tabPanel('matchups', active, `
      <div class="panel">
        <h2>Rendimiento contra el meta</h2>
        <div id="mu" class="muted">Calculando…</div>
      </div>
      <div id="cv"></div>`)}
    ${tabPanel('evolucion', active, `
      <div class="panel">
        <h2>Evolución en el tiempo</h2>
        <div id="trend" class="muted">Calculando…</div>
      </div>`)}
    ${tabPanel('variantes', active, `
      <div class="panel">
        <div class="row"><h2>Variantes de este comandante</h2>
          <label class="muted">Grupos: <select id="vk" style="width:auto">${[2, 3, 4, 5].map(n => `<option ${n === 3 ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
        <div id="variants" class="muted">Calculando…</div>
      </div>
      <div class="panel">
        <h2>Paquetes y alternativas</h2>
        <div id="syn" class="muted">Calculando…</div>
      </div>`)}
    ${tabPanel('combos', active, `
      <div class="panel">
        <h2>Cartas a tener en cuenta</h2>
        <div id="th" class="muted">Calculando…</div>
      </div>
      <div class="panel">
        <h2>Combos y amenazas</h2>
        <div id="cb" class="muted">Consultando Commander Spellbook (la primera vez puede tardar unos segundos)…</div>
      </div>`)}
    ${tabPanel('lista', active, `
      <div class="panel">
        <h2>Mi lista</h2>
        <div class="muted" style="margin-bottom:8px">Pega tu lista (formato Moxfield/Archidekt: «1 Sol Ring») y la comparo con lo que juega el meta con ${esc(short(r.commander, 40))} en el periodo elegido.</div>
        <label class="sr" for="ml-text">Tu lista de cartas</label>
        <textarea class="list" id="ml-text" placeholder="1 Sol Ring&#10;1 Mana Crypt&#10;1 Rhystic Study&#10;…"></textarea>
        <div style="margin:10px 0; display:flex; gap:10px; align-items:center; flex-wrap:wrap">
          <button class="primary" id="ml-go">Analizar mi lista</button>
          <button class="ghost" id="ml-copy" title="Copia la lista para pegarla en Commander Spellbook">Copiar mi lista</button>
          <span class="muted" style="font-size:13px">¿Combos de tu lista? Pégala en <a href="https://commanderspellbook.com/find-my-combos/" target="_blank" rel="noopener">Commander Spellbook</a>.</span>
        </div>
        <div id="ml-out"></div>
      </div>`)}`;
  $('#back').onclick = () => { view.tab = undefined; renderList(); };
  bindMyList(name);
  $('#share').onclick = () => copyText(location.href, $('#share'));
  ensureCommanders().then(() => {
    $('#cmp').insertAdjacentHTML('beforeend', commanders.filter(c => c.commander !== name).map(c => `<option>${esc(c.commander)}</option>`).join(''));
  });
  $('#cmp').onchange = e => e.target.value && openCompare(name, e.target.value);
  $('#vk').onchange = e => loadVariants(name, Number(e.target.value));
  $('#min').onchange = e => openCommander(name, Number(e.target.value));
  const drawCards = () => {
    const q = $('#cq').value.toLowerCase();
    $('#crows').innerHTML = r.popular.filter(c => c.card.toLowerCase().includes(q)).slice(0, 150).map(c => `
      <tr><td>${cn(c.card)} ${c.core ? '<span class="tag">core</span>' : ''}</td><td class="n">${pct(c.inclusion, 0)}</td>
      <td class="n">${pct(c.winRateWith)}</td>
      <td class="n ${c.lift == null ? 'muted' : c.lift >= 0 ? 'pos-t' : 'neg-t'}">${c.lift == null ? '—' : pp(c.lift)}</td></tr>`).join('');
    sortTable($('#crows').closest('table'));
  };
  $('#cq').oninput = drawCards; drawCards();
  window.scrollTo(0, 0);
  bindTabs('cmd', {
    matchups: () => loadMatchups(name),
    evolucion: () => loadTrend(name),
    variantes: () => { loadVariants(name, 3); loadPackages(name); },
    combos: () => { loadThreatCards(name); loadCombos(name); },
  });
}

async function copyText(text, btn) {
  const done = () => { if (btn) { const t = btn.textContent; btn.textContent = '¡Copiado!'; setTimeout(() => btn.textContent = t, 1500); } };
  try { await navigator.clipboard.writeText(text); return done(); } catch { /* sin permiso: alternativa */ }
  const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch { /* nada más que hacer */ }
  ta.remove();
}

// Evolución: winrate (con su intervalo) y presencia en el meta por periodos de 30 días.
async function loadTrend(name) {
  const box = $('#trend');
  try {
    const t = await api(`/api/trend?name=${encodeURIComponent(name)}`, { days: 0 });
    const S = t.series;
    if (S.length < 2) { box.textContent = 'Hace falta más de un periodo de datos.'; return; }
    const W = 720, H = 330, L = 44, R = 12, n = S.length;
    const X = i => L + i / (n - 1) * (W - L - R);
    const wr = S.filter(b => b.winRate != null);
    const metas = S.map(b => b.meta).filter(v => v != null);
    const lo = Math.min(...metas, ...wr.map(b => b.ci[0])) - .02, hi = Math.max(...metas, ...wr.map(b => b.ci[1])) + .02;
    const Y = v => 14 + (1 - (v - lo) / (hi - lo)) * 170;
    const share = Math.max(0.01, ...S.map(b => b.metaShare)), bar = v => v / share * 44;
    const lab = b => new Date(b.end * 1000).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    const pts = S.map((b, i) => b.winRate == null ? null : [X(i), Y(b.winRate)]).filter(Boolean);
    const line = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
    const withCi = S.map((b, i) => b.ci && [X(i), Y(b.ci[1]), Y(b.ci[0])]).filter(Boolean);
    const band = withCi.length > 1
      ? 'M' + withCi.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L') + ' L' + [...withCi].reverse().map(q => q[0].toFixed(1) + ' ' + q[2].toFixed(1)).join(' L') + ' Z' : '';
    const yt = []; for (let v = Math.ceil(lo * 20) / 20; v <= hi; v += .05) yt.push(v);
    const row = (c, sign) => `<tr><td>${cn(c.card)}</td><td class="n muted">${pct(c.prior, 0)}</td><td class="n">${pct(c.recent, 0)}</td><td class="n ${sign}">${pp(c.diff)}</td></tr>`;
    const tb = (rows, sign) => rows.length
      ? `<table><thead><tr><th>Carta</th><th class="n">Antes</th><th class="n">Último periodo</th><th class="n">Cambio</th></tr></thead><tbody>${rows.map(c => row(c, sign)).join('')}</tbody></table>`
      : '<div class="muted">Sin cambios claros.</div>';
    box.innerHTML = `
      <svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución del winrate y de la presencia en el meta">
        ${yt.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" /><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${(v * 100).toFixed(0)} %</text>`).join('')}
 
        ${metas.length > 1 ? `<path d="${S.map((b, i) => b.meta == null ? '' : (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(b.meta).toFixed(1)).join(' ').replace(/^L/, 'M')}" fill="none" stroke="var(--ink)" stroke-opacity=".55" stroke-width="2" stroke-dasharray="5 4"><title>Media del meta en cada periodo</title></path>` : ''}
        ${band ? `<path d="${band}" fill="var(--accent)" fill-opacity=".18"/>` : ''}
        <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
        ${S.map((b, i) => b.winRate == null ? '' : `<circle cx="${X(i)}" cy="${Y(b.winRate)}" r="4" fill="var(--accent)"><title>Hasta ${lab(b)}: winrate ${pct(b.winRate)} (${b.decks} mazos, ${b.games} partidas)</title></circle>`).join('')}
        <text x="${W - R}" y="10" text-anchor="end">Winrate (línea discontinua = media del meta en cada periodo; zona = IC 95 %)</text>
        ${S.map((b, i) => `<rect x="${X(i) - 12}" y="${284 - bar(b.metaShare)}" width="24" height="${bar(b.metaShare)}" rx="3" fill="var(--accent)" fill-opacity=".5"><title>Presencia en el meta: ${pct(b.metaShare)} (${b.decks} mazos)</title></rect>
          <text x="${X(i)}" y="${280 - bar(b.metaShare)}" text-anchor="middle">${pct(b.metaShare, 1)}</text>
          <text x="${X(i)}" y="304" text-anchor="middle">${lab(b)}</text>`).join('')}
        <text x="${L}" y="212">Presencia en el meta (% de todos los mazos) ↓</text>
        <text x="${(L + W - R) / 2}" y="322" text-anchor="middle">cada punto es un periodo de ${t.bucketDays} días, etiquetado con su fecha final</text>
      </svg>
      ${t.rising.length || t.falling.length ? `<div class="cols" style="margin-top:12px">
        <div><h2>Cartas en ascenso</h2>${tb(t.rising, 'pos-t')}</div>
        <div><h2>Cartas en descenso</h2>${tb(t.falling, 'neg-t')}</div></div>` : ''}
      <div class="note">Los periodos recientes tienen menos partidas, por eso su zona sombreada es más ancha: no leas una subida pequeña como tendencia. Las cartas en ascenso comparan el último periodo (${t.recentDecks} mazos) con todo lo anterior (${t.priorDecks}). Esta vista ignora el selector de periodo y usa todo el histórico.</div>`;
  } catch (e) { box.textContent = e.message; }
}

// Variantes: mazos agrupados automáticamente por las cartas que los diferencian.
// Núcleo y huecos de decisión de una variante (solo uso, no resultados)
function coreHtml(d) {
  if (!d) return '';
  const chip = c => `<span class="chip" data-card="${esc(c.card)}">${esc(short(c.card, 26))} <small>${pct(c.p, 0)}</small></span>`;
  return `<details class="coredet"><summary><b>Núcleo y huecos de decisión</b> <span class="muted">· ${d.core.length} cartas fijas, ≈${d.openSlots} plazas abiertas</span></summary>
    <div class="note" style="margin-top:6px">De las ≈${Math.round(d.avgCards)} cartas de cada mazo (sin tierras básicas), <b>${d.core.length}</b> las lleva casi todo el mundo (80 % o más). Quedan <b>≈${d.openSlots} plazas abiertas</b> que se reparten entre <b>${d.flexCount}</b> cartas candidatas (20-80 %) y ${d.techCount} de uso minoritario.</div>
    <h4>Huecos de decisión <small class="muted">(las que más se reparten, primero)</small></h4>
    <div class="chips">${d.flex.slice(0, 40).map(chip).join('')}</div>
    <h4>Núcleo <button class="ghost" data-copy-core="${esc(d.core.map(c => c.card).join('\n'))}" title="Copia las cartas del núcleo como lista">Copiar núcleo</button></h4>
    <div class="chips">${d.core.map(chip).join('')}</div>
    ${d.tech.length ? `<h4>Tech minoritario <small class="muted">(5-20 %)</small></h4><div class="chips">${d.tech.slice(0, 20).map(chip).join('')}</div>` : ''}
  </details>`;
}

async function loadVariants(name, k) {
  const box = $('#variants');
  box.textContent = 'Calculando…';
  try {
    const v = await api(`/api/variants?name=${encodeURIComponent(name)}&k=${k}&detail=1`);
    if (v.tooFew || !v.variants.length) { box.textContent = 'Hacen falta al menos 40 mazos con este comandante (en el periodo y filtro actuales) para separar variantes.'; return; }
    box.innerHTML = `<div class="variants">${v.variants.map((x, i) => `
      <div class="variant">
        <h3>Variante ${i + 1}: ${esc(short(x.signature.slice(0, 2).map(c => c.card).join(' + ') || 'sin rasgos claros', 44))}</h3>
        <div class="muted">${x.decks} mazos (${pct(x.share, 0)} del total) · empates ${pct(x.drawRate)}</div>
        <div class="wr" style="margin-top:8px"><b>${pct(x.winRate)}</b>${track(x.winRate - v.baseline, .10, !sig(x.ci, v.baseline))}</div>
        <div class="muted" style="font-size:12px">IC 95 %: ${pct(x.ci[0])}–${pct(x.ci[1])} · ${pp(x.winRate - v.winRate)} frente a la media del comandante</div>
        ${coreHtml(x.detail)}
        <div class="chips">${x.signature.map(c => `<span class="chip" data-card="${esc(c.card)}" title="Juegan la carta ${pct(c.inVariant, 0)} de esta variante frente a ${pct(c.inRest, 0)} del resto">${esc(short(c.card, 26))} <small>${pct(c.inVariant, 0)} vs ${pct(c.inRest, 0)}</small></span>`).join('')}</div>
      </div>`).join('')}</div>
      <div class="note">Los mazos se agrupan solos según qué cartas comparten (${v.features} cartas que no juega todo el mundo). Las etiquetas muestran las cartas más características de cada grupo, con el % de mazos del grupo que la juegan frente al resto. Cambia el número de grupos para afinar. Un grupo con menos winrate no es necesariamente peor construido: también puede reunir a jugadores con menos experiencia.</div>`;
    box.querySelectorAll('[data-copy-core]').forEach(b => { b.onclick = e => { e.preventDefault(); copyText(b.dataset.copyCore.split('\n').map(c => '1 ' + c).join('\n'), b); }; });
  } catch (e) { box.textContent = e.message; }
}

// Paquetes: cartas que se juegan juntas y cartas que casi nunca coinciden, dentro de este comandante.
// Es solo uso (qué llevan los jugadores), sin mirar resultados: el winrate de pares no se sostenía.
async function loadPackages(name) {
  const box = $('#syn');
  try {
    const r = await api(`/api/packages?name=${encodeURIComponent(name)}`);
    if (r.tooFew) { box.textContent = 'Hacen falta al menos 100 mazos con este comandante (en el periodo y filtro actuales) para detectar paquetes.'; return; }
    const together = x => `<tr><td>${cn(x.a, short(x.a, 26))} <span class="muted">→</span> ${cn(x.b, short(x.b, 26))}</td>
      <td class="n">${pct(x.withA, 0)}</td><td class="n muted">${pct(x.withoutA, 0)}</td><td class="n">${x.decks}</td></tr>`;
    const alt = x => `<tr><td>${cn(x.a, short(x.a, 26))} <span class="muted">↔</span> ${cn(x.b, short(x.b, 26))}</td>
      <td class="n">${x.decks}</td><td class="n muted">${Math.round(x.pA * x.pB * r.decks)}</td><td class="n">${pct(x.pA, 0)} / ${pct(x.pB, 0)}</td></tr>`;
    box.innerHTML = `<div class="cols wide">
      <div><h2>Suelen ir juntas</h2>${r.together.length
        ? `<table><thead><tr><th>Si llevas… → suele llevar</th><th class="n" title="% de los mazos con la primera carta que llevan también la segunda">Con la 1ª</th><th class="n" title="% de los mazos sin la primera carta que llevan la segunda">Sin la 1ª</th><th class="n">Mazos</th></tr></thead><tbody>${r.together.map(together).join('')}</tbody></table>`
        : '<div class="muted">Ningún paquete claro con el periodo y filtro actuales.</div>'}</div>
      <div><h2>Casi nunca van juntas</h2>${r.alternatives.length
        ? `<table><thead><tr><th>Pareja</th><th class="n">Mazos con ambas</th><th class="n" title="Mazos con ambas que habría si fueran independientes">Esperable</th><th class="n" title="% de mazos que llevan cada una">Uso</th></tr></thead><tbody>${r.alternatives.map(alt).join('')}</tbody></table>`
        : '<div class="muted">Ninguna pareja se excluye con claridad.</div>'}</div></div>
      <div class="note">Se mira solo qué cartas llevan los mazos de este comandante (${r.decks}), sin resultados. <b>Suelen ir juntas</b>: combos y paquetes de un plan (si llevas la primera, es mucho más probable que lleves la segunda). <b>Casi nunca van juntas</b>: son alternativas entre sí o pertenecen a planes distintos (mira las variantes). Es una descripción de lo que se juega, no una prueba de que funcionen mejor.</div>`;
  } catch (e) { box.textContent = e.message; }
}

// Comparar dos comandantes lado a lado.
async function openCompare(a, b) {
  view = { t: 'cmp', a, b }; writeHash();
  $('#app').innerHTML = '<div class="muted">Calculando…</div>';
  const [ra, rb, mu] = await Promise.all([
    api(`/api/commander?name=${encodeURIComponent(a)}`), api(`/api/commander?name=${encodeURIComponent(b)}`),
    api(`/api/matchups?name=${encodeURIComponent(a)}`).catch(() => ({ rows: [] }))]);
  const h2h = mu.rows.find(x => x.opponent === b);
  const col = r => {
    const cards = (l, sign) => l.filter(c => c.q < 0.25).slice(0, 8)
      .map(c => `<tr><td>${cn(c.card)}</td><td class="n">${pct(c.inclusion, 0)}</td><td class="n ${sign}">${pp(c.adj)}</td></tr>`).join('') || '<tr><td class="muted">Sin datos fiables</td></tr>';
    return `<div class="panel">
      <h2>${cn(r.commander)}</h2>
      <div class="wr"><b>${pct(r.winRate)}</b>${track(r.winRate - r.baseline, .10, !sig(r.ci, r.baseline))}</div>
      <div class="muted" style="margin:6px 0 10px">IC 95 %: ${pct(r.ci[0])}–${pct(r.ci[1])} · ${pp(r.winRate - r.baseline)} frente a la media del meta</div>
      <table><tbody><tr><td>Mazos</td><td class="n">${r.decks}</td></tr><tr><td>Torneos</td><td class="n">${r.tournaments}</td></tr>
        <tr><td>Partidas</td><td class="n">${r.games}</td></tr><tr><td>Empates</td><td class="n">${pct(r.drawRate)}</td></tr></tbody></table>
      <h2 style="margin-top:14px">Cartas que más ayudan</h2>
      <table><thead><tr><th>Carta</th><th class="n">En mazos</th><th class="n">Ajustada</th></tr></thead><tbody>${cards(r.best, 'pos-t')}</tbody></table>
      <h2 style="margin-top:14px">Cartas que más lastran</h2>
      <table><thead><tr><th>Carta</th><th class="n">En mazos</th><th class="n">Ajustada</th></tr></thead><tbody>${cards(r.worst, 'neg-t')}</tbody></table>
    </div>`;
  };
  $('#app').innerHTML = `
    <button class="back" id="back">← Volver a ${esc(short(a, 40))}</button>
    <h2 style="font-size:20px">Comparación</h2>
    <div class="panel">
      <h2>Cara a cara</h2>
      ${h2h ? `<div><b>${esc(short(a, 40))}</b> gana el <b>${pct(h2h.winRate)}</b> de las veces cuando <b>${esc(short(b, 40))}</b> está en su mesa (${h2h.pods} mesas), frente al ${pct(h2h.winRateWithout)} sin él: <span class="${h2h.lift >= 0 ? 'pos-t' : 'neg-t'}">${pp(h2h.lift)}</span>.</div>
      <div class="note">Mide solo mesas donde coinciden los dos. Recuerda el sesgo de composición de mesa (ver «Rendimiento contra el meta»).</div>`
        : '<div class="muted">No hay mesas suficientes donde coincidan ambos con el periodo y filtro actuales.</div>'}
    </div>
    <div class="cols">${col(ra)}${col(rb)}</div>`;
  $('#back').onclick = () => { view = { t: 'cmd', name: a, minWith: 5 }; openCommander(a); };
  window.scrollTo(0, 0);
}

async function loadMatchups(name) {
  const box = $('#mu');
  try {
    const r = await api(`/api/matchups?name=${encodeURIComponent(name)}`);
    if (!r.rows.length) { box.innerHTML = '<span class="muted">Muestra insuficiente con el filtro actual (se piden al menos 15 mesas con y sin cada rival).</span>'; return; }
    const maxMu = Math.max(0.02, ...r.rows.map(x => Math.abs(x.lift)));
    box.innerHTML = `
      <div class="muted" style="margin-bottom:8px">Haz clic en un rival para ver qué cartas rinden mejor contra él.</div>
      <table><thead><tr><th>Rival en la mesa</th><th class="n">Mesas</th><th class="n">Winrate con él</th><th class="n">Sin él</th><th class="n">Diferencia</th><th style="width:110px"></th><th class="n">z</th></tr></thead>
      <tbody>${r.rows.map(x => `
        <tr class="click" data-o="${esc(x.opponent)}"><td>${cn(x.opponent)}</td><td class="n">${x.pods}</td>
        <td class="n">${pct(x.winRate)}</td><td class="n muted">${pct(x.winRateWithout)}</td>
        <td class="n ${x.lift >= 0 ? 'pos-t' : 'neg-t'}">${pp(x.lift)}</td><td>${track(x.lift, maxMu)}</td><td class="n muted">${x.z.toFixed(1)}</td></tr>`).join('')}</tbody></table>
      <div class="note">Cada fila compara el winrate de este comandante en mesas donde está ese rival con las mesas donde no está. Hay un sesgo inevitable: también cambia <b>quién más</b> se sienta en la mesa, así que una diferencia pequeña puede deberse a eso y no al rival. Las mesas de un mismo torneo no son independientes: tomar z como orientativo.</div>`;
    box.querySelector('tbody').onclick = e => { const tr = e.target.closest('tr'); if (tr) loadCardsVs(name, tr.dataset.o); };
  } catch (e) { box.innerHTML = `<span class="muted">${esc(e.message)}</span>`; }
}

async function loadCardsVs(name, opp) {
  const box = $('#cv');
  box.innerHTML = '<div class="panel muted">Calculando…</div>';
  try {
    const r = await api(`/api/cards-vs?name=${encodeURIComponent(name)}&vs=${encodeURIComponent(opp)}`);
    const head = '<thead><tr><th>Carta</th><th class="n">Winrate con ella</th><th class="n">Dif. contra este rival</th><th class="n">Dif. general</th><th class="n">Exceso</th><th style="width:80px"></th><th class="n">z</th></tr></thead>';
    const empty = '<tr><td class="muted">Sin datos suficientes</td></tr>';
    const maxEx = Math.max(0.02, ...[...r.best, ...r.worst].map(c => Math.abs(c.excess || 0)));
    const row = c => `<tr><td>${cn(c.card)}</td><td class="n">${pct(c.winRateWith)}</td>
      <td class="n ${c.lift >= 0 ? 'pos-t' : 'neg-t'}">${pp(c.lift)}</td>
      <td class="n muted">${c.generalLift == null ? '—' : pp(c.generalLift)}</td>
      <td class="n ${c.excess == null ? 'muted' : c.excess >= 0 ? 'pos-t' : 'neg-t'}">${c.excess == null ? '—' : pp(c.excess)}</td>
      <td>${c.excess == null ? '' : track(c.excess, maxEx)}</td>
      <td class="n muted">${c.z.toFixed(1)}</td></tr>`;
    box.innerHTML = `<div class="panel">
      <h2>${esc(short(name, 40))} contra ${esc(short(opp, 40))}</h2>
      <div class="muted" style="margin-bottom:12px">${r.pods} mesas con ese rival · winrate ${r.winRate == null ? '—' : pct(r.winRate)}</div>
      <div class="cols wide">
        <div><h2>Mejor rendimiento</h2><table>${head}<tbody>${r.best.slice(0, 20).map(row).join('') || empty}</tbody></table></div>
        <div><h2>Peor rendimiento</h2><table>${head}<tbody>${r.worst.slice(0, 20).map(row).join('') || empty}</tbody></table></div>
      </div>
      <div class="note"><b>Dif. contra este rival</b>: winrate de las mesas con la carta menos las mesas sin ella, solo en mesas donde está el rival.
      <b>Dif. general</b>: lo mismo en todas las mesas. <b>Exceso</b> = la primera menos la segunda: separa las cartas buenas contra este rival de las que son buenas siempre.
      Se piden al menos 15 mesas con y sin la carta; con filtros de tamaño estrechos habrá pocas cartas. Es correlación, no causalidad.</div></div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { box.innerHTML = `<div class="panel muted">${esc(e.message)}</div>`; }
}

// Validación: cuántas conclusiones se mantienen en datos que el cálculo no ha visto.
async function loadValidation() {
  const box = $('#validation');
  try {
    const v = await api('/api/validation', { days: 0 });
    const label = { alta: '● alta', media: '◐ media', baja: '○ baja' };
    const cls = { alta: 'hi', media: 'mid', baja: 'lo' };
    box.innerHTML = `
      <div style="margin-bottom:10px">Se calculan las cartas con los primeros <b>${v.trainDays} días</b> de datos y se comprueba si su efecto (a favor o en contra del winrate) se repite en los <b>${v.testDays} días siguientes</b>, que el cálculo no ha visto. Si el resultado fuera puro azar, se repetiría el <b>50 %</b> de las veces.</div>
      <table><thead><tr><th>Fiabilidad indicada</th><th class="n">Cartas evaluadas</th><th class="n">Se repite en el periodo siguiente</th><th style="width:140px"></th></tr></thead>
      <tbody>${v.rows.map(r => `<tr><td><span class="rel ${cls[r.level]}">${label[r.level]}</span></td><td class="n">${r.cards}</td>
        <td class="n">${r.rate == null ? '—' : pct(r.rate, 0)}</td>
        <td>${r.rate == null ? '' : `<div title="La marca central es el 50 % (azar)">${track(r.rate - 0.5, 0.5)}</div>`}</td></tr>`).join('')}</tbody></table>
      <div class="note">Resultado sobre ${v.cards} cartas de ${v.commanders} comandantes con muestra suficiente: en conjunto, el efecto se repite el <b>${pct(v.overall, 0)}</b> de las veces. Una carta con fiabilidad «alta» debería repetirse bastante más que una «baja»; si no fuera así, no te fíes de esa etiqueta. Es una comprobación de que el método es estable en el tiempo, no una prueba de que la carta cause el resultado.</div>`;
  } catch (e) { box.textContent = e.message; }
}

async function loadMatrix() {
  const box = $('#matrix');
  try {
    const m = await api('/api/matrix?top=12');
    const ks = m.commanders;
    if (ks.length < 2) { box.textContent = 'Sin datos suficientes con el filtro actual.'; return; }
    const head = ks.map(k => `<th class="n" title="${esc(k)}">${esc(short(k, 14))}</th>`).join('');
    const rows = ks.map(a => {
      const o = m.overall[a], base = o.seats ? o.wins / o.seats : 0;
      const cells = ks.map(b => {
        if (a === b) return '<td class="n muted">·</td>';
        const c = m.cells[a][b];
        if (!c || c.pods < 30) return '<td class="n muted" title="menos de 30 mesas">—</td>';
        const wr = c.wins / c.pods, d = wr - base;
        const alpha = Math.min(55, Math.abs(d) / 0.08 * 55).toFixed(0);
        return `<td class="n" style="background:color-mix(in srgb, var(${d >= 0 ? '--good' : '--bad'}) ${alpha}%, transparent)" title="${esc(a)} contra ${esc(b)}: ${c.pods} mesas, ${pct(wr)} (${pp(d)} frente a su media)">${(wr * 100).toFixed(0)}%</td>`;
      }).join('');
      return `<tr><td>${esc(short(a, 28))}</td>${cells}</tr>`;
    }).join('');
    box.innerHTML = `<div style="overflow-x:auto"><table class="mx"><thead><tr><th>Comandante ↓ · rival →</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  } catch (e) { box.textContent = e.message; }
}

readHash();
bindFilters();
boot().catch(e => { $('#status').textContent = 'Error: ' + e.message; });
