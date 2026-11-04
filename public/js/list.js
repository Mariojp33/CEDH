import { bindCardSearch } from './cards.js';
import { openCommander } from './commander.js';
import { $, F, MIN_TABLE, cn, drawNote, esc, pct, pp, sig, tone, track, ui } from './core.js';
import { loadMatrix, loadValidation } from './extras.js';
import { guideHtml } from './guide.js';
import { loadHighlights, loadMeta, loadNovelties } from './meta.js';
import { bindReviewList } from './mylist.js';
import { bindTabs, goTab, pickTab, subTabs, tabPanel, tabsHtml, writeHash } from './nav.js';
import { bindPlayers, bindRegulars, bindTeams, playersHtml, regularsHtml, teamsHtml } from './players.js';
import { sortTable } from './sorttable.js';
import { bindTableTool } from './table.js';
import { bindTopDecks, bindTournaments, topDecksHtml, torneosHtml } from './tournaments.js';

// Habituales y Equipos viven dentro de Jugadores como secciones plegables que cargan al abrirse (3 apartados en vez de 5)
const playersSections = () => playersHtml() +
  `<details class="sect" id="reg-d"><summary>Jugadores habituales</summary>${regularsHtml()}</details>` +
  `<details class="sect" id="team-d"><summary>Equipos</summary>${teamsHtml()}</details>`;
function bindPeople() {
  bindPlayers();
  const lazy = (id, bind) => { const d = $(id); let done = false; const go = () => { if (d.open && !done) { done = true; bind(); } }; d.addEventListener('toggle', go); go(); };
  lazy('#reg-d', bindRegulars); lazy('#team-d', bindTeams);
  const want = ui.view.open; if (want) { const d = $(want === 'equipos' ? '#team-d' : '#reg-d'); if (d) { d.open = true; d.scrollIntoView(); } ui.view.open = undefined; }
}
const loadTorneos = () => {
  // Los enlaces antiguos a «Habituales» y «Equipos» abren Jugadores con esa sección desplegada
  if (ui.view.sub === 'habituales' || ui.view.sub === 'equipos') { ui.view.open = ui.view.sub; ui.view.sub = 'jugadores'; }
  subTabs($('#tor-host'), [
    { id: 'torneos', label: 'Torneos', html: torneosHtml(), load: bindTournaments },
    { id: 'listas', label: 'Buscar listas top', html: topDecksHtml(), load: bindTopDecks },
    { id: 'jugadores', label: 'Jugadores', html: playersSections(), load: bindPeople },
  ]);
};


export function renderList() {
  ui.view = { t: 'list', tab: ui.view.tab, sub: ui.view.sub, card: ui.view.card, player: ui.view.player }; writeHash();
  const active = pickTab('list');
  $('#app').innerHTML = tabsHtml('list', active) +
    tabPanel('mazos', active, `
    <div class="hl" id="hl" aria-label="Destacados"></div>
    <div class="panel">
      <label class="sr" for="q">Filtrar la lista de comandantes</label>
      <input type="search" id="q" placeholder="Filtrar la lista de comandantes…">
      <label class="muted" style="display:inline-flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" id="showall"> Mostrar también los de menos de ${MIN_TABLE} mazos (<span id="nfew"></span>)</label>
      <table style="margin-top:12px"><thead><tr>
        <th>Comandante</th><th class="n">Mazos</th><th class="n">Presencia en el meta</th><th>Winrate <small class="muted">· media ${pct(F.meta)}</small></th><th class="n">vs media</th><th class="n" title="Partidas empatadas sobre el total">Empates</th>
      </tr></thead><tbody id="rows"></tbody></table>
      <details class="note"><summary>¿Cómo se lee?</summary>La referencia es la <b>media del meta</b> en el periodo elegido (${pct(F.meta)}). ${drawNote()} Verde o rojo solo si el rango probable del winrate queda entero por encima o por debajo de la media; en <b>gris</b> no se distingue de ella (suele ser falta de partidas). Se cuentan las partidas suizas y las eliminatorias.</details>
    </div>`) +
    tabPanel('meta', active, `<div id="meta-host"></div>`) +
    tabPanel('torneos', active, `<div id="tor-host"></div>`) +
    tabPanel('mesa', active, `
    <div class="panel">
      <h2>Preparar una mesa</h2>
      <div class="muted" style="margin-bottom:10px">Elige tu comandante y hasta tres rivales que esperas. Verás cómo le ha ido a tu comandante en las mesas donde estaban y qué cartas distinguen a esos mazos.</div>
      <div class="tablepick" id="tb-pick"><span class="muted">Cargando comandantes…</span></div>
    </div>
    <div id="tb-out"></div>`) +
    tabPanel('lista', active, `
    <div class="panel">
      <h2>Revisar mi lista</h2>
      <div class="muted" style="margin-bottom:10px">Pega tu lista (formato Moxfield o Archidekt: «1 Sol Ring»). Detecto el comandante si tu lista lo indica; si no, elígelo. Te diré qué te falta o te sobra frente a las listas más parecidas a la tuya.</div>
      <label class="sr" for="rl-text">Tu lista de cartas</label>
      <textarea class="list" id="rl-text" placeholder="~~Commanders~~&#10;1 Kinnan, Bonder Prodigy&#10;&#10;~~Mainboard~~&#10;1 Sol Ring&#10;1 Rhystic Study&#10;…"></textarea>
      <div class="tablepick" style="margin-top:10px">
        <label>Comandante <select id="rl-cmd"><option value="">— detectarlo a partir de la lista —</option></select></label>
        <button class="primary" id="rl-go">Revisar mi lista</button>
        <button class="ghost" id="rl-copy" title="Copia la lista para pegarla en Commander Spellbook">Copiar mi lista</button>
      </div>
      <div id="rl-msg" class="muted" style="margin-top:8px"></div>
      <div class="muted" style="margin-top:6px;font-size:13px">¿Combos de tu lista? Pégala en <a href="https://commanderspellbook.com/find-my-combos/" target="_blank" rel="noopener">Commander Spellbook</a>.</div>
    </div>`) +
    tabPanel('cartas', active, `
    <div class="panel">
      <h2>Buscar una carta</h2>
      <div class="muted" style="margin-bottom:8px">Escribe el nombre de una carta y mira en qué comandantes se juega, cuánto, si sube o baja y qué cartas suelen acompañarla. Solo mira lo que se juega en torneos cEDH, no si «funciona» mejor.</div>
      <label class="sr" for="cs-q">Nombre de la carta</label>
      <input type="search" id="cs-q" placeholder="Rhystic Study, Thassa's Oracle…" autocomplete="off">
      <div id="cs-sug" class="sugs" role="listbox" aria-label="Sugerencias de cartas"></div>
    </div>
    <div id="cs-out"></div>`) +
    tabPanel('mas', active, `<div id="mas-host"></div>`);
  const maxShare = Math.max(0.001, ...ui.commanders.map(c => c.metaShare));
  const draw = () => {
    const q = $('#q').value.toLowerCase(), all = $('#showall').checked;
    // Con texto en el filtro se buscan todos; sin él, la tabla enseña solo los de muestra razonable (salvo que se pida lo contrario)
    $('#rows').innerHTML = ui.commanders.filter(c => c.commander.toLowerCase().includes(q) && (all || q || c.decks >= MIN_TABLE)).map(c => `
      <tr class="click${sig(c.ci, F.meta) > 0 ? ' hi-pos' : sig(c.ci, F.meta) < 0 ? ' hi-neg' : ''}" data-c="${esc(c.commander)}" tabindex="0" role="link" aria-label="Abrir ${esc(c.commander)}">
        <td>${cn(c.commander)}${c.decks < MIN_TABLE ? ' <span class="few" title="Muestra pequeña: winrate poco fiable">muestra pequeña</span>' : ''}</td><td class="n">${c.decks}</td>
        <td><div class="share">${pct(c.metaShare)}<span style="width:${Math.min(100, c.metaShare / maxShare * 60)}px"></span></div></td>
        <td><div class="wr"><b>${pct(c.winRate)}</b>${track(c.winRate - F.meta, .10, !sig(c.ci, F.meta))}</div></td>
        <td class="n ${tone(sig(c.ci, F.meta))}">${pp(c.winRate - F.meta)}</td>
        <td class="n muted">${pct(c.drawRate)}</td>
      </tr>`).join('');
    sortTable($('#rows').closest('table'));
  };
  loadHighlights($('#hl'));
  $('#nfew').textContent = ui.commanders.filter(c => c.decks < MIN_TABLE).length;
  $('#showall').onchange = draw;
  $('#q').oninput = draw; draw();
  const open = e => { const tr = e.target.closest('tr'); if (tr) { ui.view.tab = undefined; openCommander(tr.dataset.c); } };
  $('#rows').onclick = open;
  $('#rows').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } };
  document.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => goTab(b.dataset.go); });
  const matrixHtml = `<div class="panel">
      <h2>Matriz de matchups (12 comandantes más jugados)</h2>
      <div id="matrix" class="muted">Calculando…</div>
      <div class="note">Cada celda es el winrate del comandante de la fila en mesas donde está el de la columna. Verde = por encima de su media, rojo = por debajo (color completo a ±8 puntos). «—»: menos de 30 mesas. ${F.dec ? 'Solo cuentan las mesas con ganador y con todos los comandantes conocidos.' : 'Los empates cuentan como mesa no ganada.'}</div>
    </div>`;
  bindTabs('list', {
    meta: () => subTabs($('#meta-host'), [
      { id: 'panorama', label: 'Panorama', html: '<div id="meta" class="panel muted">Calculando…</div>', load: loadMeta },
      { id: 'novedades', label: 'Novedades de cartas', html: '<div id="nov" class="panel muted">Calculando…</div>', load: loadNovelties },
    ]),
    torneos: loadTorneos, mesa: bindTableTool, lista: bindReviewList, cartas: bindCardSearch,
    mas: () => subTabs($('#mas-host'), [
      { id: 'guia', label: 'Cómo leer esto', html: guideHtml() },
      { id: 'matriz', label: 'Matriz de matchups', html: matrixHtml, load: loadMatrix },
      { id: 'fiabilidad', label: 'Fiabilidad del método', html: '<div class="panel"><h2>¿Cuánto se puede fiar de las cartas recomendadas?</h2><div id="validation" class="muted">Calculando…</div></div>', load: loadValidation },
    ]),
  });
}
