import { isFav, toggleFav } from './favs.js';
import { shareUrl } from './shell.js';
import { loadCombos, loadThreatCards } from './combos.js';
import { $, F, api, cn, copyText, drawNote, ensureCommanders, esc, pct, pp, rel, short, sig, tone, ui } from './core.js';
import { loadCardEvo, loadMatchups, loadMini, loadPackages, loadTrend, loadVariants, openCompare } from './extras.js';
import { renderList } from './list.js';
import { bindMyList } from './mylist.js';
import { bindTabs, pickTab, tabPanel, tabsHtml, writeHash } from './nav.js';
import { sortTable } from './sorttable.js';
import { loadCommanderTournaments } from './tournaments.js';

export async function openCommander(name, minWith = 5) {
  ui.view = { ...ui.view, t: 'cmd', name, minWith }; writeHash();
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
      <td class="n ${c.adj >= 0 ? 'pos-t' : 'neg-t'}">${pp(c.adj)}</td>
      <td style="width:90px"><div class="bar"><i class="${c.adj >= 0 ? 'pos' : 'neg'}" style="width:${Math.abs(c.adj) / maxLift * 50}%"></i></div></td>
      <td>${rel(c.q)}</td></tr>`).join('');
  const head = '<thead><tr><th>Carta</th><th class="n">En mazos</th><th class="n" title="Cuánto sube o baja el winrate de los mazos que la llevan (corregido: se acerca a 0 cuando hay pocos mazos)">Efecto</th><th></th><th title="¿Puede ser casualidad? Se miran cientos de cartas y alguna sale buena por azar">¿Fiable?</th></tr></thead>';

  // Una frase con la conclusión: cómo rinde y cuánto se juega
  const share = (ui.commanders.find(c => c.commander === r.commander) || {}).metaShare;
  const how = lo > r.baseline ? '<b class="pos-t">Rinde por encima de la media</b>' : hi < r.baseline ? '<b class="neg-t">Rinde por debajo de la media</b>' : '<b>Rinde como la media</b> (con estos datos no se distingue)';
  const verdict = how + ': gana el ' + pct(r.winRate) + ' de sus partidas frente al ' + pct(r.baseline) + ' del meta' + (share ? ' y aparece en el ' + pct(share) + ' de los mazos' : '') + '.';

  const active = pickTab('cmd');
  $('#app').innerHTML = `
    <button class="back" id="back">← Mazos</button>
    <div class="head">
      <h2 style="font-size:20px">${cn(r.commander)}</h2>
      <div class="ctl" style="margin:0">
        <label>Comparar con: <select id="cmp"><option value="">— elige comandante —</option></select></label>
        <button class="ghost" id="fav" aria-pressed="${isFav(r.commander)}" title="Guarda este comandante en tus favoritos (solo en este navegador)">${isFav(r.commander) ? '★ Favorito' : '☆ Favorito'}</button>
        <button class="ghost" id="share" title="Copia la dirección con el periodo, los filtros y este comandante">Copiar enlace</button>
      </div>
    </div>
    <div class="verdict">${verdict}</div>
    <div class="tiles" style="margin-top:12px">
      <div class="tile"><div class="v">${r.decks}</div><div class="l">mazos en ${r.tournaments} torneos</div></div>
      <div class="tile"><div class="v">${pct(r.winRate)}</div><div class="l">winrate (probablemente entre ${pct(lo)} y ${pct(hi)})</div></div>
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
          ? `<span class="lb b" style="left:${(Number(gx(lo)) + Number(gx(hi))) / 2}%">probablemente entre ${pct(lo)} y ${pct(hi)}</span>`
          : `<span class="lb b" style="left:${gx(lo)}%">${pct(lo)}</span><span class="lb b" style="left:${gx(hi)}%">${pct(hi)}</span>`}
      </div>
      <div class="note" style="margin:0">${lo > r.baseline ? '<b class="pos-t">Por encima de la media</b>: hay margen suficiente (zona sombreada) para decir que gana más que la media del meta.'
        : hi < r.baseline ? '<b class="neg-t">Por debajo de la media</b>: hay margen suficiente para decir que gana menos que la media del meta.'
        : '<b>No se distingue de la media</b>: el rango probable (zona sombreada) incluye la media del meta; hacen falta más partidas para decidir.'}
        La línea tenue marca el 25 % del azar puro. ${drawNote()}</div>
    </div>
    <div class="panel" id="mini6"><div class="muted">Cargando la evolución…</div></div>
    ${tabsHtml('cmd', active)}
    ${tabPanel('cartas', active, `
      <div class="panel">
        <h2>Cartas más jugadas con este comandante</h2>
        <label class="sr" for="cq">Filtrar carta</label>
        <input type="search" id="cq" placeholder="Filtrar carta…">
        <div id="ce-out"></div>
        <div class="subtabs" id="ctiers" role="group" aria-label="Filtrar por frecuencia de uso" style="margin-top:10px"></div>
        <div class="muted" id="hidden-all"></div>
        <table style="margin-top:8px"><thead><tr><th>Carta</th><th>Uso</th><th class="n" title="Mazos de este comandante que la llevan">Mazos</th><th class="n" title="% de los mazos de este comandante que la llevan (playrate)">Inclusión</th><th class="n" title="Winrate de los mazos que la llevan. En gris salvo que su intervalo de confianza quede entero por encima o por debajo de la media del meta">Winrate con ella</th><th class="n" title="Frente a los mazos que no la llevan. Solo se colorea si es llamativa (|z| ≥ 2)">Diferencia</th><th></th></tr></thead><tbody id="crows"></tbody></table>
      </div>
      <details class="panel assoc">
        <summary><b>Cartas asociadas a más y a menos winrate</b> <span class="muted">· orientativo: correlación, no causalidad</span></summary>
        <div class="ctl" style="margin-top:10px">
          <label>Mínimo de mazos con la carta (y sin ella):
            <select id="min">${[3, 5, 10, 20].map(n => `<option ${n === minWith ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        </div>
        <div class="cols wide">
          <div><h2>Más winrate</h2><table>${head}<tbody>${liftRows(r.best) || '<tr><td class="muted">Sin datos suficientes</td></tr>'}</tbody></table></div>
          <div><h2>Menos winrate</h2><table>${head}<tbody>${liftRows(r.worst) || '<tr><td class="muted">Sin datos suficientes</td></tr>'}</tbody></table></div>
        </div>
        <div class="note">
          <b>Cómo leerlo.</b> «Efecto» compara el winrate de los mazos que juegan la carta con los que no, para este comandante (se acerca a 0 cuantos menos mazos hay; las tablas se ordenan por él).
          «¿Fiable?» avisa de si puede ser casualidad, porque al mirar cientos de cartas alguna sale buena por azar.
          Es <b>correlación, no causalidad</b>: una carta puede aparecer más en los mazos de jugadores mejores o en mazos con otro plan de juego, y con cambios reales de lista de los mismos jugadores no se confirmó que añadirla mejore el resultado.
        </div>
      </details>`)}
    ${tabPanel('juega', active, `
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
    ${tabPanel('resultados', active, `
      <div class="panel">
        <h2>Rendimiento contra el meta</h2>
        <div id="mu" class="muted">Calculando…</div>
      </div>
      <div id="cv"></div>
      <div class="panel">
        <h2>Evolución en el tiempo</h2>
        <div id="trend" class="muted">Calculando…</div>
      </div>`)}
    ${tabPanel('torneos', active, `
      <div class="panel">
        <h2>Torneos con este comandante</h2>
        <div id="ct-sum" class="muted" style="margin-bottom:8px">Cargando…</div>
        <div class="tablepick">
          <label>Buscar <input type="search" id="ct-q" placeholder="torneo o jugador" autocomplete="off"></label>
          <label>Resultado <select id="ct-scope"><option value="all">Todos</option><option value="cut">Pasó al top cut</option><option value="top4">Top 4</option><option value="win">Campeón</option></select></label>
          <label>Orden <select id="ct-sort"><option value="date">Más recientes</option><option value="rank">Mejor puesto</option><option value="record">Mejor récord</option></select></label>
        </div>
        <div id="ct-out" style="margin-top:10px"></div>
        <div style="margin-top:8px"><button type="button" class="ghost" id="ct-more" hidden>Mostrar más</button></div>
      </div>
      <div id="ct-deck"></div>`)}
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
  $('#back').onclick = () => { ui.view = { t: 'list', tab: 'mazos' }; renderList(); };
  bindMyList(name);
  if (ui.view.autorun) { ui.view.autorun = false; $('#ml-go').click(); }   // viene de «Revisar mi lista»: se analiza al llegar
  $('#fav').onclick = () => { const on = toggleFav(r.commander); $('#fav').setAttribute('aria-pressed', String(on)); $('#fav').textContent = on ? '★ Favorito' : '☆ Favorito'; };
  $('#share').onclick = () => copyText(shareUrl(), $('#share'));
  ensureCommanders().then(() => {
    $('#cmp').insertAdjacentHTML('beforeend', ui.commanders.filter(c => c.commander !== name).map(c => `<option>${esc(c.commander)}</option>`).join(''));
  });
  $('#cmp').onchange = e => e.target.value && openCompare(name, e.target.value);
  $('#vk').onchange = e => loadVariants(name, Number(e.target.value));
  $('#min').onchange = e => openCommander(name, Number(e.target.value));
  // Tramos de uso: permiten ver de un vistazo qué es núcleo y qué es opcional sin romper el orden por columnas.
  const TIERS = [['core', 'Núcleo', 0.8, 'las lleva el 80 % o más'], ['usual', 'Habituales', 0.4, '40–80 %'], ['opt', 'Opcionales', 0.1, '10–40 %'], ['tech', 'Tech', 0, 'menos del 10 %']];
  const tierOf = c => TIERS.find(t => c.inclusion >= t[2]);
  const shown = r.popular.filter(c => c.inclusion < 0.995);   // las del 100 % (el propio comandante) no informan
  let tierSel = '';
  const drawTiers = () => {
    const n = id => shown.filter(c => tierOf(c)[0] === id).length;
    $('#ctiers').innerHTML = [['', 'Todas', shown.length, ''], ...TIERS.map(t => [t[0], t[1], n(t[0]), t[3]])]
      .map(([id, label, k, hint]) => `<button type="button" data-tier="${id}" class="${tierSel === id ? 'on' : ''}" aria-pressed="${tierSel === id}"${hint ? ` title="${hint}"` : ''}>${label} <small>${k}</small></button>`).join('');
  };
  const drawCards = () => {
    const q = $('#cq').value.toLowerCase();
    const hidden = r.popular.length - shown.length;
    $('#hidden-all').textContent = hidden ? `Se ocultan ${hidden} carta${hidden > 1 ? 's' : ''} que llevan el 100 % de los mazos (el propio comandante o su compañero).` : '';
    const rows = shown.filter(c => (!tierSel || tierOf(c)[0] === tierSel) && c.card.toLowerCase().includes(q));
    $('#crows').innerHTML = rows.slice(0, 150).map(c => {
      const few = c.decks < minWith;                       // con tan pocos mazos el winrate no dice nada
      const wTone = few ? 'muted' : tone(sig(c.ci, r.baseline));
      const dTone = c.lift == null || c.z == null || Math.abs(c.z) < 2 ? 'muted' : c.lift >= 0 ? 'pos-t' : 'neg-t';
      return `<tr><td>${cn(c.card)}</td>
      <td><span class="tag t-${tierOf(c)[0]}">${tierOf(c)[1].replace(/s$/, '')}</span></td>
      <td class="n muted">${c.decks}</td>
      <td class="n"><div class="share">${pct(c.inclusion, 0)}<span style="width:${Math.round(c.inclusion * 60)}px"></span></div></td>
      <td class="n ${wTone}" ${few ? '' : `title="Probablemente entre ${pct(c.ci[0], 0)} y ${pct(c.ci[1], 0)} · ${c.games} partidas"`}>${few ? '<span title="Muy pocos mazos para dar un winrate">—</span>' : pct(c.winRateWith)}</td>
      <td class="n ${dTone}">${c.lift == null ? '—' : pp(c.lift)}</td>
      <td><button type="button" class="ghost" data-evo="${esc(c.card)}" title="Cómo ha evolucionado el winrate con esta carta en los últimos 6 meses">Evolución</button></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="muted">Ninguna carta coincide.</td></tr>';
    sortTable($('#crows').closest('table'));
  };
  $('#ctiers').onclick = e => { const b = e.target.closest('[data-tier]'); if (!b) return; tierSel = b.dataset.tier; drawTiers(); drawCards(); };
  drawTiers();
  $('#cq').oninput = drawCards; drawCards();
  $('#crows').onclick = e => { const b = e.target.closest('[data-evo]'); if (b) loadCardEvo(name, b.dataset.evo); };
  window.scrollTo(0, 0);
  loadMini(name);
  bindTabs('cmd', {
    resultados: () => { loadMatchups(name); loadTrend(name); },
    torneos: () => loadCommanderTournaments(name),
    juega: () => { loadVariants(name, 3); loadPackages(name); },
    combos: () => { loadThreatCards(name); loadCombos(name); },
  });
}
