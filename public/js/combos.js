import { $, F, api, cardBtn, esc, pct, short } from './core.js';

// ---- Cartas a tener en cuenta (remates, interacción, tutores, maná rápido y odio) ----
export async function loadThreatCards(name) {
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
export async function loadCombos(name) {
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
