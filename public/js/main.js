import { openCommander } from './commander.js';
import { $, F, api, cmdLabel, ensureCommanders, esc, ui } from './core.js';
import { openCompare } from './extras.js';
import { renderList } from './list.js';

async function loadStatus() {
  const st = await api('/api/status');
  const ex = st.excluded && st.excluded.tournaments
    ? ` title="${st.excluded.tournaments} torneos no cEDH excluidos (casuales, precon, presupuesto…): ${st.excluded.decks} mazos"` : '';
  $('#status').innerHTML = st.updatedAt
    ? `<span${ex}>${st.tournaments} torneos · ${st.decks} mazos${ex ? ' ⓘ' : ''}</span> · actualizado ${new Date(st.updatedAt).toLocaleString('es-ES', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}`
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
  if (ui.view.t === 'cmd') {
    try { return await openCommander(ui.view.name, ui.view.minWith); }
    catch { ui.view = { t: 'list' }; } // el comandante no tiene datos con este filtro
  }
  if (ui.view.t === 'cmp') {
    try { return await openCompare(ui.view.a, ui.view.b); }
    catch { ui.view = { t: 'list' }; }
  }
  ui.commanders = await api('/api/commanders?min=1'); // todos los comandantes con algún mazo: buscadores y desplegables los usan todos
  renderList();
}

export async function boot() {
  const st = await loadStatus();
  if (!st.decks) { setTimeout(boot, 5000); return; }
  await show();
}

export function bindFilters() {
  const apply = () => { F.min = $('#fmin').value; F.max = $('#fmax').value; updateFilterSummary(); show().catch(e => { $('#status').textContent = 'Error: ' + e.message; }); };
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


// ---- Abrir un comandante o buscar una carta desde cualquier tabla (elementos con data-open-cmd / data-open-card) ----
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-open-cmd],[data-open-card]');
  if (!el) return;
  if (el.dataset.openCmd) { ui.view = { t: 'cmd', name: el.dataset.openCmd, minWith: 5 }; openCommander(el.dataset.openCmd); return; }
  await ensureCommanders();
  ui.view = { t: 'list', tab: 'cartas', card: el.dataset.openCard };
  renderList();
});
// Etiqueta corta de un comandante: con pareja, solo los nombres de pila («Rograkh + Thrasios»); si no, el nombre recortado

// ---- Buscador único de la cabecera: comandantes y cartas ----
export function bindGlobalSearch() {
  const q = $('#gq'), box = $('#gs');
  let timer = null, items = [];
  const close = () => { box.hidden = true; box.innerHTML = ''; items = []; q.setAttribute('aria-expanded', 'false'); };
  const pick = it => {
    close(); q.value = '';
    if (it.type === 'cmd') { ui.view = { t: 'cmd', name: it.name, minWith: 5 }; openCommander(it.name); }
    else ensureCommanders().then(() => { ui.view = { t: 'list', tab: 'cartas', card: it.name }; renderList(); });
  };
  const render = () => {
    const part = (type, title) => { const rows = items.map((it, i) => ({ it, i })).filter(x => x.it.type === type); return rows.length ? `<div class="gh">${title}</div>` + rows.map(({ it, i }) => `<button type="button" role="option" data-i="${i}"><span>${esc(it.label)}</span><span class="ex">${esc(it.extra)}</span></button>`).join('') : ''; };
    box.innerHTML = part('cmd', 'Comandantes') + part('card', 'Cartas') || '<div class="gh">Sin resultados</div>';
    box.hidden = false; q.setAttribute('aria-expanded', 'true');
  };
  q.oninput = () => {
    clearTimeout(timer);
    const v = q.value.trim();
    if (v.length < 2) return close();
    timer = setTimeout(async () => {
      await ensureCommanders();
      const lc = v.toLowerCase();
      const cm = ui.commanders.filter(c => c.commander.toLowerCase().includes(lc)).slice(0, 5).map(c => ({ type: 'cmd', name: c.commander, label: cmdLabel(c.commander), extra: `${c.decks} mazos` }));
      let cards = [];
      try { cards = (await api('/api/cards?q=' + encodeURIComponent(v))).slice(0, 6).map(x => ({ type: 'card', name: x.card, label: x.card, extra: `${x.decks.toLocaleString('es-ES')} mazos` })); } catch { /* el buscador de cartas puede estar preparándose */ }
      if (q.value.trim() !== v) return;                    // se siguió escribiendo: este resultado ya no vale
      items = [...cm, ...cards]; render();
    }, 160);
  };
  q.onkeydown = e => {
    if (e.key === 'Enter' && items[0]) { e.preventDefault(); pick(items[0]); }
    else if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { const b = box.querySelector('button'); if (b) { e.preventDefault(); b.focus(); } }
  };
  box.onkeydown = e => {
    const bs = [...box.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < bs.length - 1) { e.preventDefault(); bs[i + 1].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? bs[i - 1] : q).focus(); }
    else if (e.key === 'Escape') { close(); q.focus(); }
  };
  box.onclick = e => { const b = e.target.closest('[data-i]'); if (b) pick(items[Number(b.dataset.i)]); };
  document.addEventListener('click', e => { if (!e.target.closest('.gsearch')) close(); });
}

// ---- Filtros plegables: el resumen siempre dice qué hay elegido ----
export function updateFilterSummary() {
  const per = { 30: '1 mes', 90: '3 meses', 180: '6 meses' }[F.days] || `${F.days} días`;
  const pl = (F.min || F.max) ? `${F.min || 0}–${F.max || '∞'} jugadores` : 'todos los tamaños';
  $('#fsum').textContent = `Filtros · ${per} · empates ${F.dec ? 'fuera del cálculo' : 'cuentan como no ganadas'} · ${pl}`;
}
