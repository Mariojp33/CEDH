import { $, F, api, cn, esc, pct, short, tone, ui } from './core.js';
import { bindCmdLinks, bindDeckButtons, cmdLink, deckRows } from './decks.js';
import { goTab, writeHash } from './nav.js';

// ---- Jugadores ----
// Se agrupa por el nombre con el que se inscribe en TopDeck (sin las etiquetas entre corchetes): no hay identificador de persona.
let playerGo = null;                                  // carga el perfil de un jugador (la pestaña lo define al abrirse)
export function openPlayer(name) {
  ui.view.sub = 'jugadores'; ui.view.player = name;
  goTab('torneos');
  const b = document.querySelector('#tor-host [data-sub=jugadores]');
  if (b) b.click();
  const run = () => playerGo ? playerGo(name) : setTimeout(run, 100);
  run();
}
function playerExtras(r) {
  const top = x => x == null ? '—' : `primer ${Math.max(1, Math.round(x * 100))} %`;
  const chg = (a, b, better) => a == null || b == null ? '' : Math.abs(a - b) < 0.02 ? 'igual' : (better(a, b) ? 'mejor' : 'peor');
  let html = '';
  // Forma reciente
  const h = r.history.filter(t => t.pctl != null);
  if (h.length >= 3 || r.form) {
    const f = r.form, bars = h.length >= 3 ? h : null;
    html += `<div class="panel"><h2>Forma reciente</h2>
      ${bars ? `<div class="muted" style="margin-bottom:6px">Posición en cada torneo, del más antiguo al más reciente: cuanto más alta la barra, mejor puesto relativo (cima = campeón).</div>
      <div class="spark">${bars.map(t => `<div class="sb" title="${esc(t.name)} · ${t.rank}.º de ${t.size}"><small>${t.rank}.º</small><i style="height:${Math.max(3, Math.round((1 - t.pctl) * 60))}px"></i><small class="d">${new Date(t.date * 1000).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}</small></div>`).join('')}</div>` : ''}
      ${f ? `<div style="margin-top:10px">Últimos <b>${f.recent.tournaments}</b> torneos: de media en el <b>${top(f.recent.pctl)}</b> de la clasificación y <b>${f.recent.winRate == null ? '—' : pct(f.recent.winRate, 0)}</b> de victorias. Antes (${f.before.tournaments} torneos): ${top(f.before.pctl)} y ${f.before.winRate == null ? '—' : pct(f.before.winRate, 0)}.
        ${f.recent.pctl != null && f.before.pctl != null ? `Su posición reciente es <b>${chg(f.before.pctl, f.recent.pctl, (a, b) => b < a)}</b> que antes.` : ''}</div>
      <div class="note">Con tan pocos torneos, un cambio de esta forma suele ser ruido: un buen o mal fin de semana mueve mucho la media. Tómalo como una pista, no como una tendencia demostrada.</div>` : '<div class="note">Con menos de 6 torneos todavía no se compara la forma reciente con la anterior.</div>'}</div>`;
  }
  // Nivel del torneo
  if (r.tiers) {
    html += `<div class="panel"><h2>Según el nivel del torneo</h2>
      <div class="muted" style="margin-bottom:8px">El nivel es el Elo medio de los inscritos, partido en tres tramos con todos los torneos (límites: ${r.tiers.cuts.map(Math.round).join(' y ')}).</div>
      <table><thead><tr><th>Nivel</th><th class="n">Torneos</th><th class="n">Partidas</th><th class="n">Winrate</th><th class="n">Puesto medio</th></tr></thead><tbody>
      ${r.tiers.rows.map(t => `<tr><td>${t.label}</td><td class="n">${t.tournaments}</td><td class="n muted">${t.games}</td><td class="n">${t.winRate == null ? '—' : pct(t.winRate, 0)}</td><td class="n">${t.pctl == null ? '—' : top(t.pctl)}</td></tr>`).join('')}</tbody></table>
      <div class="note">Solo cuentan los torneos con Elo medio conocido (los descargados recientemente). Un buen resultado en torneos de nivel alto vale más que en uno flojo, pero con pocas partidas por tramo las diferencias pueden ser casualidad.</div></div>`;
  }
  // Contra qué comandantes: todos los rivales con los que ha coincidido; los de pocas mesas salen en gris y sin interpretar
  const m = r.matchups;
  if (m) {
    const few = m.rows.filter(x => !x.enough).length;
    html += `<div class="panel"><h2>Contra qué comandantes</h2>
      ${m.rows.length ? `<div class="muted" style="margin-bottom:8px">Sus mesas en las que estaba cada comandante rival. Su winrate general por mesa es <b>${m.winRate == null ? '—' : pct(m.winRate, 0)}</b> en ${m.pods} mesas.${few ? ` Los de menos de ${m.minPods} mesas (${few}) salen en gris: son casos sueltos, no una tendencia.` : ''}</div>
      <table><thead><tr><th>Rival en la mesa</th><th class="n">Mesas</th><th class="n">Victorias</th><th class="n">Winrate</th><th class="n" title="Intervalo de confianza al 95 %">Intervalo</th></tr></thead><tbody>
      ${m.rows.map(x => `<tr class="${x.enough ? '' : 'few'}"><td>${cmdLink(x.opponent)}</td><td class="n">${x.pods}</td><td class="n muted">${x.wins}</td>
        <td class="n ${x.enough ? tone(x.ci[0] > m.winRate ? 1 : x.ci[1] < m.winRate ? -1 : 0) : 'muted'}">${pct(x.winRate, 0)}</td><td class="n muted">${x.enough ? `${pct(x.ci[0], 0)}–${pct(x.ci[1], 0)}` : 'pocas mesas'}</td></tr>`).join('')}</tbody></table>
      <div class="note">${m.total > m.rows.length ? `Se muestran los ${m.rows.length} rivales con más mesas de ${m.total}. ` : ''}Solo se colorea cuando hay ${m.minPods} mesas o más y el intervalo queda entero por encima o por debajo de su winrate general. Con tan pocas mesas casi nunca ocurre: lo normal es que las diferencias sean casualidad, y en una mesa también juegan otros dos o tres comandantes.</div>`
      : '<div class="muted">No hay mesas con ganador y rivales conocidos de este jugador en este periodo.</div>'}</div>`;
  }
  // Cómo cambia sus listas
  if (r.changes && r.changes.length) {
    const res = b => b.rank ? `${b.rank}.º de ${b.size}` : (b.winRate == null ? '—' : `${pct(b.winRate, 0)} de victorias`);
    const chips = l => l.length ? l.map(c => cn(c)).join(', ') : '<span class="muted">ninguna</span>';
    html += `<div class="panel"><h2>Cómo cambia sus listas</h2>
      <div class="muted" style="margin-bottom:8px">Para los comandantes que ha jugado en varios torneos: qué cartas ha metido y quitado de un torneo al siguiente (sin contar tierras básicas), y cómo le fue en cada uno.</div>
      ${r.changes.map(c => `<h3 style="margin:14px 0 6px">${cmdLink(c.commander)} <span class="muted" style="font-weight:400">· ${c.decks} listas · cambia de media ${c.avgChanged.toFixed(1).replace('.', ',')} cartas entre torneos${c.identical ? ` · ${c.identical} ${c.identical === 1 ? 'vez' : 'veces'} la misma lista` : ''}</span></h3>
        ${c.steps.map(x => `<details class="chg"><summary><span class="muted">${new Date(x.from.date * 1000).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} → ${new Date(x.to.date * 1000).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}</span>
          · <b class="pos-t">+${x.added.length}</b> <b class="neg-t">−${x.removed.length}</b> · ${res(x.from)} → <b>${res(x.to)}</b></summary>
          <div><b>Mete:</b> ${chips(x.added)}</div><div style="margin-top:4px"><b>Quita:</b> ${chips(x.removed)}</div></details>`).join('')}`).join('')}
      <div class="note">Es información, no un consejo: en nuestros datos los cambios de cartas de un mismo jugador no explican bien la diferencia de resultados (el puesto en un torneo depende sobre todo de la suerte de las mesas y de los rivales). Se muestran los 8 últimos cambios de cada comandante.</div></div>`;
  }
  return html;
}
function playerHtml(r) {
  const days = t => new Date(t * 1000).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' });
  const few = r.games < 20;
  const base = r.meta;
  const rel = r.winRate == null ? '' : r.ci[0] > base ? 'pos-t' : r.ci[1] < base ? 'neg-t' : 'muted';
  const lk = r.luck;
  const vs = (a, e) => `<b>${a}</b> <span class="muted">(por azar se esperarían ${e.toFixed(e < 1 ? 2 : 1).replace('.', ',')})</span>`;
  return `<div class="panel">
    <h2>${esc(r.name)}</h2>
    <div class="muted">${r.aliases.length > 1 ? `También aparece como: ${r.aliases.filter(a => a !== r.name).map(esc).join(', ')} · ` : ''}${r.tournaments} ${r.tournaments === 1 ? 'torneo' : 'torneos'} · ${r.decks} ${r.decks === 1 ? 'mazo' : 'mazos'} · de ${days(r.firstDate)} a ${days(r.lastDate)}</div>
    <div class="tiles" style="margin-top:12px">
      <div class="tile"><div class="v ${rel}">${r.winRate == null ? '—' : pct(r.winRate)}</div><div class="l">winrate (probablemente entre ${pct(r.ci[0])} y ${pct(r.ci[1])}) · media del meta ${pct(base)}</div></div>
      <div class="tile"><div class="v">${r.games}</div><div class="l">partidas${F.dec ? ' con ganador' : ''} · ${r.wins} victorias</div></div>
      ${lk ? `<div class="tile"><div class="v">${lk.cut}</div><div class="l">veces en el top cut de ${lk.ranked} torneos con puesto ${vs('', lk.expectedCut).replace('<b></b> ', '')}</div></div>
      <div class="tile"><div class="v">${lk.wins}</div><div class="l">torneos ganados ${vs('', lk.expectedWins).replace('<b></b> ', '')}</div></div>` : ''}
    </div>
    ${few ? `<div class="note">Hay pocas partidas (${r.games}): el winrate de este jugador puede ser pura casualidad; mira el rango probable.</div>` : ''}
    ${lk ? '' : '<div class="note">Aún no hay puestos guardados para este jugador (aparecerán al renovar el seed).</div>'}
  </div>
  ${playerExtras(r)}
  <div class="panel"><h2>Comandantes que ha jugado</h2>
    <table><thead><tr><th>Comandante</th><th class="n">Mazos</th><th class="n">Partidas</th><th class="n">Winrate</th><th class="n">Top cut</th></tr></thead><tbody>
    ${r.commanders.map(c => `<tr><td>${cmdLink(c.commander)}</td><td class="n">${c.decks}</td><td class="n muted">${c.games}</td><td class="n">${c.winRate == null ? '—' : pct(c.winRate, 0)}</td><td class="n">${c.cut}</td></tr>`).join('')}
    </tbody></table></div>
  <div class="panel"><h2>Torneos recientes</h2>
    <table><thead><tr><th>Fecha</th><th>Torneo</th><th class="n">Jugadores</th><th class="n">Puesto</th><th>Jugador</th><th>Comandante</th><th class="n">Récord</th><th>Enlace</th><th></th></tr></thead><tbody>${deckRows(r.recent, { withTournament: true })}</tbody></table>
    <div class="note">El puesto, el top cut y las victorias de torneo dependen de cuántos jugadores había: por eso se comparan con lo que saldría por azar (la suma, torneo a torneo, de cut/jugadores y de 1/jugadores). Un jugador por encima de eso rinde mejor de lo que da la suerte, aunque con pocos torneos sigue pudiendo ser casualidad. Se agrupa por el nombre con el que se inscribe en TopDeck: dos personas con el mismo nombre se juntarían y alguien que usa varios nombres saldría partido.</div>
  </div><div id="pl-deck"></div>`;
}
export async function bindPlayers() {
  const q = $('#pl-q'), box = $('#pl-sug'), out = $('#pl-out');
  let timer, seq = 0;
  const show = async (key, label) => {
    const my = ++seq; box.innerHTML = ''; out.innerHTML = '<div class="panel muted">Cargando…</div>';
    try {
      const r = await api('/api/player?key=' + encodeURIComponent(key));
      if (my !== seq) return;
      out.innerHTML = playerHtml(r);
      const dk = out.querySelector('#pl-deck');
      bindDeckButtons(out, dk); bindCmdLinks(out);
      ui.view.player = r.name; writeHash();
    } catch (e) { out.innerHTML = `<div class="panel muted">${esc(e.message)}</div>`; }
  };
  playerGo = async name => {
    q.value = name;
    try {
      const r = await api('/api/players?q=' + encodeURIComponent(name));
      const hit = r.find(x => x.name === name) || r[0];
      if (hit) show(hit.key, hit.name); else out.innerHTML = '<div class="panel muted">No hay datos de ese jugador con el periodo y filtros actuales.</div>';
    } catch (e) { out.innerHTML = `<div class="panel muted">${esc(e.message)}</div>`; }
  };
  q.oninput = () => {
    clearTimeout(timer);
    const v = q.value.trim();
    if (v.length < 2) { box.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const r = await api('/api/players?q=' + encodeURIComponent(v));
        box.innerHTML = r.length ? r.map(x => `<button type="button" class="sug" data-k="${esc(x.key)}" data-n="${esc(x.name)}"><span class="nm">${esc(x.name)}</span><span class="ct">${x.tournaments} ${x.tournaments === 1 ? 'torneo' : 'torneos'} · ${x.decks} ${x.decks === 1 ? 'mazo' : 'mazos'}${x.cut ? ` · ${x.cut} top cut` : ''}</span></button>`).join('')
          : '<div class="sug muted">Nadie con ese nombre en este periodo y filtros.</div>';
        box.querySelectorAll('button').forEach(b => { b.onclick = () => { q.value = b.dataset.n; show(b.dataset.k, b.dataset.n); }; });
      } catch { box.innerHTML = ''; }
    }, 200);
  };
  q.onkeydown = e => { if (e.key === 'Enter') { const b = box.querySelector('button'); if (b) { e.preventDefault(); b.click(); } } };
  if (ui.view.player) playerGo(ui.view.player);
}
export const playersHtml = () => `<div class="panel">
    <h2>Buscar un jugador</h2>
    <div class="muted" style="margin-bottom:8px">Escribe el nombre con el que juega en TopDeck para ver sus resultados: winrate, torneos en el top cut, comandantes y listas recientes. También puedes pulsar el nombre de un jugador en cualquier tabla de torneos.</div>
    <label class="sr" for="pl-q">Nombre del jugador</label>
    <input type="search" id="pl-q" placeholder="Nombre del jugador…" autocomplete="off">
    <div id="pl-sug" class="sugs" role="listbox" aria-label="Jugadores"></div>
  </div><div id="pl-out"></div>`;
// ---- Jugadores habituales y equipos ----
export async function bindRegulars() {
  const min = $('#rg-min'), sort = $('#rg-sort'), q = $('#rg-q'), out = $('#rg-out');
  let timer, seq = 0;
  const load = async () => {
    const my = ++seq; out.innerHTML = '<span class="muted">Calculando…</span>';
    let r;
    try { r = await api(`/api/regulars?min=${min.value}&sort=${sort.value}&q=${encodeURIComponent(q.value.trim())}`); } catch (e) { out.innerHTML = `<span class="muted">No se pudo cargar: ${esc(e.message)}</span>`; return; }
    if (my !== seq) return;
    if (!r.tested) { out.innerHTML = `<span class="muted">Nadie ha jugado ${r.minTournaments} torneos con puesto guardado en este periodo y con estos filtros. Los puestos solo existen para los torneos descargados desde que se guardan (se completan al renovar el seed); prueba con menos torneos o con 6 meses.</span>`; return; }
    out.innerHTML = `<div class="muted" style="margin-bottom:8px">${r.tested} ${r.tested === 1 ? 'jugador' : 'jugadores'} con al menos ${r.minTournaments} torneos con puesto. Tras corregir por comparaciones múltiples, <b>${r.better}</b> ${r.better === 1 ? 'pasa' : 'pasan'} el top cut más veces de lo que daría el azar de forma clara.</div>
      ${r.rows.length ? `<table><thead><tr><th>Jugador</th><th class="n">Torneos</th><th class="n" title="Veces en el top cut / las que cabría esperar por azar">Top cut (azar)</th><th class="n" title="Torneos ganados / los esperables por azar">Títulos (azar)</th><th class="n">Winrate</th><th title="q: proporción esperada de falsos positivos tras corregir por mirar a muchos jugadores a la vez">Señal</th></tr></thead><tbody>
      ${r.rows.map(x => `<tr><td><a href="#" class="plink" data-player="${esc(x.name)}">${esc(x.name)}</a></td><td class="n">${x.tournaments}</td>
        <td class="n"><b>${x.cut}</b> <span class="muted">(${x.expectedCut.toFixed(1).replace('.', ',')})</span></td><td class="n"><b>${x.titles}</b> <span class="muted">(${x.expectedTitles.toFixed(1).replace('.', ',')})</span></td>
        <td class="n" title="Probablemente entre ${pct(x.ci[0], 0)} y ${pct(x.ci[1], 0)}">${x.winRate == null ? '—' : pct(x.winRate, 0)} <span class="muted">· ${x.games}</span></td>
        <td>${x.better ? '<span class="rel hi" title="q &lt; 5 %: es poco probable que sea casualidad">● por encima del azar</span>' : '<span class="muted" title="Compatible con la suerte">compatible con el azar</span>'}</td></tr>`).join('')}</tbody></table>
      <div class="note">${r.total > r.rows.length ? `Se muestran ${r.rows.length} de ${r.total}. ` : ''}</div>` : '<span class="muted">Ningún jugador coincide con la búsqueda.</span>'}`;
    out.querySelectorAll('.plink').forEach(a => { a.onclick = e => { e.preventDefault(); openPlayer(a.dataset.player); }; });
  };
  min.onchange = sort.onchange = load;
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  load();
}
export async function bindTeams() {
  const q = $('#tm-q'), out = $('#tm-out');
  let timer, seq = 0;
  const load = async () => {
    const my = ++seq; out.innerHTML = '<span class="muted">Calculando…</span>';
    let r;
    try { r = await api('/api/teams?q=' + encodeURIComponent(q.value.trim())); } catch (e) { out.innerHTML = `<span class="muted">No se pudo cargar: ${esc(e.message)}</span>`; return; }
    if (my !== seq) return;
    if (!r.total) { out.innerHTML = `<span class="muted">No hay ninguna etiqueta con al menos ${r.minPlayers} jugadores y ${r.minDecks} mazos en este periodo y con estos filtros.</span>`; return; }
    out.innerHTML = `<table><thead><tr><th>Etiqueta</th><th class="n">Jugadores</th><th class="n">Mazos</th><th class="n">Torneos</th><th class="n">Winrate</th><th class="n" title="Veces que un jugador del equipo pasó el top cut / las esperables por azar">Top cut (azar)</th><th class="n" title="Torneos ganados por alguien del equipo / los esperables por azar">Títulos (azar)</th><th>Jugadores con más mazos</th></tr></thead><tbody>
      ${r.rows.map(x => `<tr><td><b>${esc(x.tag)}</b></td><td class="n">${x.players}</td><td class="n">${x.decks}</td><td class="n muted">${x.tournaments}</td>
        <td class="n" title="Probablemente entre ${pct(x.ci[0], 0)} y ${pct(x.ci[1], 0)}">${x.winRate == null ? '—' : pct(x.winRate, 0)} <span class="muted">· ${x.games}</span></td>
        <td class="n">${x.ranked ? `<b>${x.cut}</b> <span class="muted">(${x.expectedCut.toFixed(1).replace('.', ',')})</span>` : '<span class="muted">—</span>'}</td>
        <td class="n">${x.ranked ? `<b>${x.titles}</b> <span class="muted">(${x.expectedTitles.toFixed(1).replace('.', ',')})</span>` : '<span class="muted">—</span>'}</td>
        <td>${x.top.map(p => `<a href="#" class="plink" data-player="${esc(p.name)}">${esc(p.name.replace(/\s*\[[^\]]*\]/, ''))}</a> <span class="muted">${p.decks}</span>`).join(', ')}</td></tr>`).join('')}</tbody></table>
      <div class="note">Es aproximado: se agrupa por la etiqueta entre corchetes que algunos jugadores añaden a su nombre en TopDeck (por ejemplo «[Pinnacle]»). No todos la usan, algunos la escriben distinta y no siempre es un equipo (puede ser una comunidad o una tienda). Solo salen etiquetas con ${r.minPlayers} jugadores y ${r.minDecks} mazos o más. Cuando varios jugadores de un equipo juegan el mismo torneo, el equipo tiene más opciones de pasar el corte por azar: la columna «azar» lo cuenta por jugador y torneo.</div>`;
    out.querySelectorAll('.plink').forEach(a => { a.onclick = e => { e.preventDefault(); openPlayer(a.dataset.player); }; });
  };
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  load();
}
export const regularsHtml = () => `<div class="panel">
    <h2>Jugadores habituales</h2>
    <div class="muted" style="margin-bottom:8px">Quienes juegan torneos con frecuencia, con cuántas veces han pasado el top cut y ganado un torneo <b>frente a lo que saldría solo por azar</b>. No es un ranking de nivel: con pocos torneos, estar por encima del azar suele ser suerte, por eso se marca como «por encima del azar» solo a quien lo es de forma clara tras corregir por mirar a muchos jugadores a la vez. Se agrupa por el nombre con el que juegan en TopDeck.</div>
    <div class="tablepick">
      <label>Mínimo de torneos <select id="rg-min"><option value="3">3</option><option value="5" selected>5</option><option value="8">8</option><option value="12">12</option></select></label>
      <label>Orden <select id="rg-sort"><option value="tournaments">Más torneos</option><option value="luck">Más por encima del azar</option><option value="winrate">Mejor winrate</option></select></label>
      <label>Buscar <input type="search" id="rg-q" placeholder="nombre" autocomplete="off"></label>
    </div>
    <div id="rg-out" style="margin-top:10px" class="muted">Calculando…</div>
  </div>`;
export const teamsHtml = () => `<div class="panel">
    <h2>Equipos y comunidades</h2>
    <div class="muted" style="margin-bottom:8px">Estadísticas agrupadas por la etiqueta entre corchetes que algunos jugadores llevan en su nombre.</div>
    <label class="sr" for="tm-q">Buscar una etiqueta</label>
    <input type="search" id="tm-q" placeholder="Buscar una etiqueta…" autocomplete="off">
    <div id="tm-out" style="margin-top:10px" class="muted">Calculando…</div>
  </div>`;
