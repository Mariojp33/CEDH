// Miniatura del comandante (arte de Scryfall) y sus colores de maná junto a cada nombre de comandante.
// Una petición por comandante, solo cuando entra en pantalla y a ritmo moderado; el resultado se recuerda en el navegador.
const KEY = 'cedh.scry1', MAX = 700;
let store = {};
try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { store = {}; }
let dirty = false;
const save = () => { if (!dirty) return; dirty = false; try { const ks = Object.keys(store); if (ks.length > MAX) for (const k of ks.slice(0, ks.length - MAX)) delete store[k]; localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* lleno */ } };

const waiting = new Map(), queue = [];
let running = false;
async function lookup(name) {
  if (name in store) return store[name];
  try {
    const r = await fetch("https://api.scryfall.com/cards/named?exact=" + encodeURIComponent(name));
    if (!r.ok) { if (r.status === 404) { store[name] = null; dirty = true; } return null; }
    const j = await r.json(), face = (j.image_uris ? j : (j.card_faces || [])[0]) || {};
    store[name] = { art: face.image_uris && face.image_uris.art_crop || null, ci: j.color_identity || [] };
    dirty = true;
    return store[name];
  } catch { return null; }
}
async function pump() {
  if (running) return; running = true;
  while (queue.length) {
    const name = queue.shift(), fresh = !(name in store);
    const info = await lookup(name);
    for (const fn of waiting.get(name) || []) fn(info);
    waiting.delete(name);
    if (fresh) await new Promise(r => setTimeout(r, 120));   // Scryfall pide un máximo de ~10 peticiones por segundo
  }
  running = false; save();
}
function want(name, fn) {
  if (name in store) return fn(store[name]);
  if (!waiting.has(name)) { waiting.set(name, []); queue.push(name); }
  waiting.get(name).push(fn); pump();
}

const COLORS = ['W', 'U', 'B', 'R', 'G'];
function pips(ci) {
  const dots = (ci.length ? COLORS.filter(c => ci.includes(c)) : ['C']).map(c => '<i class="p' + c + '"></i>').join('');
  return '<span class="pips" title="Identidad de color: ' + (ci.length ? ci.join('') : 'incolora') + '">' + dots + '</span>';
}

function decorate(el) {
  if (el.dataset.dec) return;
  el.dataset.dec = '1';
  const names = (el.dataset.openCmd || el.dataset.card || '').split(' / ').filter(Boolean).slice(0, 2);
  if (!names.length) return;
  const av = document.createElement('span'); av.className = 'av';
  el.before(av);
  const infos = [];
  names.forEach((n, i) => want(n, info => {
    infos[i] = info;
    if (infos[0] && infos[0].art) av.style.backgroundImage = "url(" + infos[0].art + ")";
    if (infos.filter(Boolean).length === names.length) {
      const ci = [...new Set(infos.flatMap(x => x ? x.ci : []))];
      el.insertAdjacentHTML('afterend', pips(ci));
    }
  }));
}

const SELECTOR = '#app [data-open-cmd], #app #rows .cn, #app .head h2 .cn';
const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); decorate(e.target); } }), { rootMargin: '200px' }) : null;
export function watchCommanders(root) {
  const run = () => root.querySelectorAll(SELECTOR.replace('#app ', '')).forEach(el => { if (!el.dataset.dec && !el.dataset.obs) { el.dataset.obs = '1'; io ? io.observe(el) : decorate(el); } });
  new MutationObserver(run).observe(root, { childList: true, subtree: true });
  run();
}
