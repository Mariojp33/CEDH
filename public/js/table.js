import { $, F, api, cardBtn, cmdBtn, cmdLabel, ensureCommanders, esc, pct, pp, short, sureness, ui } from './core.js';
import { store } from './nav.js';

// ---- Preparar mesa ----
export async function bindTableTool() {
  const box = $('#tb-pick');
  await ensureCommanders();
  const opts = (selected) => ui.commanders.map(c => `<option value="${esc(c.commander)}" ${c.commander === selected ? 'selected' : ''}>${esc(cmdLabel(c.commander))} (${c.decks})</option>`).join('');
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
    const rows = r.rows.map(x => `<tr><td>${cmdBtn(x.rival)}</td><td class="n">${x.pods}</td><td class="n" title="Sin él en la mesa: ${x.winRateWithout == null ? '—' : pct(x.winRateWithout)}">${cell(x)}</td>
      <td class="n ${tone2(x)}">${x.enough ? pp(x.lift) : '—'}</td><td class="n">${x.enough ? sureness(x.z) : '<span class="muted">muestra insuficiente</span>'}</td></tr>`).join('');
    // Conclusión en una frase
    const known = r.rows.filter(x => x.enough), noted = known.filter(x => Math.abs(x.z) >= 2);
    const conclusion = !known.length ? 'Hay pocas mesas con estos rivales para sacar una conclusión.'
      : noted.length ? noted.map(x => 'Contra <b>' + esc(cmdLabel(x.rival)) + '</b> rinde <b class="' + (x.lift > 0 ? 'pos-t' : 'neg-t') + '">' + (x.lift > 0 ? 'mejor' : 'peor') + '</b> (' + pp(x.lift) + ')').join(' · ') + '. Con el resto, como de costumbre.'
      : 'Contra estos rivales tu comandante rinde <b>como de costumbre</b>: ninguno cambia su winrate de forma clara.';
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
        <div class="verdict" style="margin:0 0 10px">${conclusion}</div>
        <div class="muted" style="margin-bottom:8px">${r.pods} mesas de este comandante · winrate general ${pct(r.baseline)}</div>
        <table><thead><tr><th>Rival en la mesa</th><th class="n">Mesas con él</th><th class="n">Winrate con él</th><th class="n" title="Frente a su winrate en mesas sin ese rival">Diferencia</th><th class="n" title="¿La diferencia es real o puede ser casualidad? «Se nota» = es llamativa; «ruido» = no se distingue del azar.">¿Fiable?</th></tr></thead><tbody>${rows}</tbody></table>
        ${multi}
        <div class="note">Los matchups en cEDH suelen ser <b>casi planos</b>: «ruido» significa que no se distingue de jugar sin ese rival (solo se colorea lo que «se nota»). Es histórico, no una predicción: las mesas de un mismo torneo no son independientes y cambiar de rival cambia también a quién más te sientas. ${F.dec ? 'Solo mesas con ganador y rivales conocidos.' : 'Los empates cuentan como mesa no ganada.'}</div>
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
    const top = id => th ? (th.categories.find(c => c.id === id) || { cards: [] }).cards.filter(c => c.inclusion >= 0.4 && c.inclusion < 0.995).slice(0, 4) : [];
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
