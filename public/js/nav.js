import { $, F, ui } from './core.js';

// Estado compartible en la dirección (#d=90&min=30&c=Comandante): se lee al abrir y se escribe al navegar.
export function writeHash() {
  const h = new URLSearchParams();
  h.set('d', F.days);
  h.set('dec', F.dec);
  if (F.min) h.set('min', F.min);
  if (F.max) h.set('max', F.max);
  if (ui.view.tab) h.set('t', ui.view.tab);
  if (ui.view.sub && SUBTAB_OWNERS.has(ui.view.tab)) h.set('s', ui.view.sub);
  if (ui.view.t === 'list' && ui.view.card && ui.view.tab === 'cartas') h.set('card', ui.view.card);
  if (ui.view.t === 'list' && ui.view.tab === 'torneos' && ui.view.sub === 'jugadores' && ui.view.player) h.set('p', ui.view.player);
  if (ui.view.t === 'cmd') h.set('c', ui.view.name);
  if (ui.view.t === 'cmp') { h.set('c', ui.view.a); h.set('vs', ui.view.b); }
  try { history.replaceState(null, '', '#' + h); } catch { /* sin historial (vista previa) */ }
}
export function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const d = Number(h.get('d'));
  if ([30, 90, 180, 365].includes(d)) F.days = d;
  if (h.get('dec') === '1') F.dec = 1;
  F.min = h.get('min') || ''; F.max = h.get('max') || '';
  $('#fmin').value = F.min; $('#fmax').value = F.max;
  const tab = h.get('t') || undefined;
  if (h.get('c') && h.get('vs')) ui.view = { t: 'cmp', a: h.get('c'), b: h.get('vs') };
  else if (h.get('c')) ui.view = { t: 'cmd', name: h.get('c'), minWith: 5, tab };
  else ui.view = { t: 'list', tab, sub: h.get('s') || undefined, card: h.get('card') || undefined, player: h.get('p') || undefined };
}
export const store = {
  get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* almacenamiento bloqueado */ } },
};
// ---- Pestañas ----
// Cada pestaña carga sus datos la primera vez que se abre (así no se calculan sinergias o variantes si nadie las mira).
const TABS = {
  list: [['mazos', 'Mazos'], ['meta', 'Meta'], ['torneos', 'Torneos y listas'], ['mesa', 'Preparar mesa'], ['lista', 'Revisar mi lista'], ['cartas', 'Buscar carta'], ['mas', 'Más']],
  cmd: [['cartas', 'Cartas'], ['juega', 'Cómo juega'], ['combos', 'Combos y amenazas'], ['resultados', 'Resultados'], ['torneos', 'Torneos'], ['lista', 'Mi lista']],
};
// Enlaces de versiones anteriores: pestaña antigua -> [pestaña actual, apartado]
const ALIAS = {
  list: { comandantes: ['mazos'], novedades: ['meta', 'novedades'], matriz: ['mas', 'matriz'], fiabilidad: ['mas', 'fiabilidad'] },
  cmd: { variantes: ['juega'], matchups: ['resultados'], evolucion: ['resultados'] },
};
const SUBTAB_OWNERS = new Set(['meta', 'torneos', 'mas']);   // pestañas con apartados internos (el apartado va en la dirección)
export const pickTab = kind => {
  const al = (ALIAS[kind] || {})[ui.view.tab];
  if (al) { ui.view.tab = al[0]; if (al[1] && !ui.view.sub) ui.view.sub = al[1]; }
  return TABS[kind].some(t => t[0] === ui.view.tab) ? ui.view.tab : TABS[kind][0][0];
};
export const tabsHtml = (kind, active) => `<div class="tabs" role="tablist" aria-label="Secciones">${TABS[kind].map(([id, label]) =>
  `<button role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${id === active}" tabindex="${id === active ? 0 : -1}" data-tab="${id}">${label}</button>`).join('')}</div>`;
export const tabPanel = (id, active, inner) => `<section class="tabpanel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}" ${id === active ? '' : 'hidden'}>${inner}</section>`;
export function bindTabs(kind, loaders) {
  const done = new Set(), ids = TABS[kind].map(t => t[0]);
  const select = (id, focus) => {
    ui.view.tab = id; writeHash();
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


// ---- Apartados dentro de una pestaña (Meta: panorama/novedades; Más: guía/matriz/fiabilidad) ----
export function subTabs(host, items) {
  const ids = items.map(i => i.id);
  host.innerHTML = `<div class="subtabs" role="tablist" aria-label="Apartados">${items.map(i => `<button type="button" role="tab" data-sub="${i.id}" aria-selected="false" tabindex="-1">${i.label}</button>`).join('')}</div>` +
    items.map(i => `<div class="subpanel" role="tabpanel" data-subpanel="${i.id}" hidden>${i.html}</div>`).join('');
  const done = new Set();
  const select = (id, focus) => {
    ui.view.sub = id; writeHash();
    host.querySelectorAll('[data-sub]').forEach(b => { const on = b.dataset.sub === id; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; b.classList.toggle('on', on); if (on && focus) b.focus(); });
    host.querySelectorAll('[data-subpanel]').forEach(p => { p.hidden = p.dataset.subpanel !== id; });
    if (!done.has(id)) { done.add(id); const it = items.find(i => i.id === id); if (it && it.load) it.load(); }
  };
  host.querySelectorAll('[data-sub]').forEach(b => {
    b.onclick = () => select(b.dataset.sub);
    b.onkeydown = e => {
      const i = ids.indexOf(b.dataset.sub);
      const to = { ArrowRight: ids[(i + 1) % ids.length], ArrowLeft: ids[(i + ids.length - 1) % ids.length] }[e.key];
      if (to) { e.preventDefault(); select(to, true); }
    };
  });
  select(ids.includes(ui.view.sub) ? ui.view.sub : ids[0]);
}
export const goTab = id => { const b = $('#tab-' + id); if (b) b.click(); };
