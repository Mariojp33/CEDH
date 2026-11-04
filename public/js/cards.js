import { cardImage } from './cardpop.js';
import { openCommander } from './commander.js';
import { $, F, api, cardBtn, cn, esc, pct, pp, short, ui } from './core.js';
import { writeHash } from './nav.js';

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
export function bindCardSearch() {
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
  if (ui.view.card) { q.value = ui.view.card; searchCard(ui.view.card); }
}

async function searchCard(name) {
  const out = $('#cs-out');
  ui.view.card = name; writeHash();
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
        <div class="cardfig" id="cs-img"></div>
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
    $('#cs-img').appendChild(cardImage(r.card));
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
      const open = e => { const tr = e.target.closest('tr[data-c]'); if (tr) { ui.view = { t: 'cmd', name: tr.dataset.c, minWith: 5 }; openCommander(tr.dataset.c); } };
      out.querySelector('.cols .panel tbody').onclick = open;
      out.querySelector('.cols .panel tbody').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } };
    }
  } catch (e) { out.innerHTML = `<div class="panel muted">${esc(e.message)}</div>`; }
}
