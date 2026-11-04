import { $, F, api, cmdLabel, ensureCommanders, esc, short, ui } from './core.js';
import { bindCmdLinks, bindDeckButtons, dateEs, deckRows, wrOf } from './decks.js';

function showTournament(t, det, dk) {
  det.innerHTML = `<div class="panel"><h2>${esc(t.name)}</h2><div class="muted">${dateEs(t.date)} · ${t.size} jugadores${t.elo ? ` · Elo medio ${t.elo}` : ''} · ${t.hasRanks ? `pasaron al top cut ${t.cut}` : 'sin puestos guardados: se ordena por récord'}</div>
    <div class="tablepick" style="margin-top:10px">
      <label>Ver <select id="tt-scope">${t.hasRanks ? `<option value="cut">Top cut (${t.decks.filter(d => d.inCut).length})</option>` : ''}<option value="all">Todos los jugadores con lista (${t.decks.length})</option></select></label>
      <label>Orden <select id="tt-sort">${t.hasRanks ? '<option value="rank">Puesto final</option>' : ''}<option value="wr">Mejor porcentaje de victorias</option><option value="wins">Más victorias</option></select></label>
      <label>Buscar <input type="search" id="tt-q" placeholder="comandante o jugador" autocomplete="off"></label>
    </div>
    <div id="tt-out" style="margin-top:10px"></div>
    <div class="note">El récord incluye las rondas de top cut. El puesto final es el orden que da TopDeck; un récord mejor en las rondas suizas no siempre implica mejor puesto, porque el top cut decide los primeros puestos. «Enlace» abre la lista original cuando TopDeck la guardó con su dirección (a veces falta).</div></div>`;
  const draw = () => {
    const needle = det.querySelector('#tt-q').value.toLowerCase().trim(), scope = det.querySelector('#tt-scope').value, sort = det.querySelector('#tt-sort').value;
    let list = t.decks.filter(d => (scope === 'all' || d.inCut) && (!needle || d.commander.toLowerCase().includes(needle) || String(d.player || '').toLowerCase().includes(needle)));
    const by = { rank: t.hasRanks ? (a, b) => a.rank - b.rank : (a, b) => b.wins - a.wins || a.losses - b.losses,  wr: (a, b) => (wrOf(b) ?? -1) - (wrOf(a) ?? -1) || b.wins - a.wins || a.rank - b.rank, wins: (a, b) => b.wins - a.wins || a.rank - b.rank };
    list = [...list].sort(by[sort]);
    det.querySelector('#tt-out').innerHTML = list.length ? `<table><thead><tr><th class="n">Puesto</th><th>Jugador</th><th>Comandante</th><th class="n" title="Victorias-empates-derrotas en ese torneo (incluye el top cut) y porcentaje de victorias">Récord</th><th>Enlace</th><th></th></tr></thead><tbody>${deckRows(list)}</tbody></table>`
      : '<span class="muted">Ningún jugador coincide con la búsqueda.</span>';
    bindDeckButtons(det, dk); bindCmdLinks(det);
  };
  det.querySelector('#tt-scope').onchange = det.querySelector('#tt-sort').onchange = draw;
  det.querySelector('#tt-q').oninput = draw;
  draw(); det.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
export async function bindTournaments() {
  const q = $('#tr-q'), sort = $('#tr-sort'), out = $('#tr-out'), more = $('#tr-more'), det = $('#tr-det'), dk = $('#tr-deck');
  const PAGE = 40, per = { 30: 'el último mes', 90: 'los últimos 3 meses', 180: 'los últimos 6 meses', 365: 'los últimos 12 meses' }[F.days] || `los últimos ${F.days} días`;
  let timer, seq = 0, shown = 0;
  const rowsOf = list => list.map(t => `<tr>
      <td class="muted" data-v="${t.date}">${dateEs(t.date)}</td><td>${esc(short(String(t.name || ''), 52))}${t.elo ? ` <span class="muted" title="Elo medio de los jugadores">· Elo ${t.elo}</span>` : ''}</td><td class="n">${t.size}</td>
      <td class="podio">${t.hasRanks ? t.top.map(d => `<div><span class="muted">${d.rank}.º</span> ${esc(cmdLabel(d.commander))}</div>`).join('') : '<span class="muted" title="Se guardará al renovar el seed">sin puestos guardados</span>'}</td>
      <td><button type="button" class="ghost" data-tid="${esc(t.tid)}">${t.hasRanks ? `Ver top ${t.cut}` : 'Ver jugadores'}</button></td></tr>`).join('');
  const bindRows = () => out.querySelectorAll('[data-tid]:not([data-b])').forEach(b => { b.dataset.b = 1; b.onclick = async () => {
    det.innerHTML = '<div class="panel muted">Cargando…</div>'; dk.innerHTML = '';
    try { showTournament(await api('/api/tournament?tid=' + encodeURIComponent(b.dataset.tid)), det, dk); }
    catch (e) { det.innerHTML = `<div class="panel muted">${esc(e.message)}</div>`; }
  }; });
  const load = async append => {
    const my = ++seq;
    if (!append) { shown = 0; out.innerHTML = '<span class="muted">Cargando…</span>'; }
    let r;
    try { r = await api(`/api/tournaments?limit=${PAGE}&offset=${shown}&sort=${sort.value}&q=${encodeURIComponent(q.value.trim())}`); } catch (e) { out.innerHTML = `<span class="muted">No se pudo cargar: ${esc(e.message)}</span>`; return; }
    if (my !== seq) return;
    if (!r.total) {
      out.innerHTML = `<span class="muted">Ningún torneo coincide con la búsqueda en ${per}${F.days < 180 ? ': prueba con un periodo más largo en los filtros (6 meses)' : ''}${F.min || F.max ? ' o quita el filtro de jugadores por torneo' : ''}.</span>`;
      more.hidden = true; return;
    }
    if (append) out.querySelector('tbody').insertAdjacentHTML('beforeend', rowsOf(r.tournaments));
    else out.innerHTML = `<table class="tourn"><thead><tr><th>Fecha</th><th>Torneo</th><th class="n">Jugadores</th><th>Podio</th><th></th></tr></thead><tbody>${rowsOf(r.tournaments)}</tbody></table>
      <div class="note" id="tr-note"></div>`;
    out.querySelector('#tr-note').dataset.r = r.ranked;
    shown += r.tournaments.length;
    bindRows();
    out.querySelector('#tr-note').textContent = `${shown} de ${r.total} ${r.total === 1 ? 'torneo' : 'torneos'} en ${per}. «Podio» son los cuatro primeros puestos.${Number(out.querySelector('#tr-note').dataset.r) ? '' : ' Todavía no hay puestos guardados: aparecerán al renovar el seed.'}${F.days < 180 ? ' Para ver torneos más antiguos, amplía el periodo en los filtros.' : ''}`;
    more.hidden = shown >= r.total; more.textContent = `Mostrar más (${r.total - shown} restantes)`;
  };
  more.onclick = () => load(true);
  sort.onchange = () => load(false);
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => load(false), 250); };
  load(false);
}
export async function bindTopDecks() {
  const f = { cmd: $('#td-cmd'), card: $('#td-card'), pl: $('#td-pl'), scope: $('#td-scope') }, out = $('#td-out'), dk = $('#td-deck'), box = $('#td-sug');
  await ensureCommanders();
  $('#td-cmds').innerHTML = ui.commanders.map(c => `<option value="${esc(c.commander)}">`).join('');
  let seq = 0;
  const go = async () => {
    const my = ++seq;
    out.innerHTML = '<span class="muted">Buscando…</span>'; dk.innerHTML = '';
    const qs = new URLSearchParams({ scope: f.scope.value, limit: 60 });
    if (f.cmd.value.trim()) qs.set('commander', f.cmd.value.trim());
    if (f.card.value.trim()) qs.set('card', f.card.value.trim());
    if (f.pl.value.trim()) qs.set('player', f.pl.value.trim());
    let r;
    try { r = await api('/api/decks?' + qs); } catch (e) { out.innerHTML = `<span class="muted">No se pudo buscar: ${esc(e.message)}</span>`; return; }
    if (my !== seq) return;
    if (!r.total) { out.innerHTML = '<span class="muted">Ninguna lista coincide. Si buscas una carta, escribe su nombre completo (elige una sugerencia); si faltan posiciones, aparecerán al renovar el seed.</span>'; return; }
    out.innerHTML = `<table><thead><tr><th>Fecha</th><th>Torneo</th><th class="n">Jugadores</th><th class="n">Puesto</th><th>Jugador</th><th>Comandante</th><th class="n" title="Victorias-empates-derrotas en ese torneo (incluye el top cut) y porcentaje de victorias">Récord</th><th>Enlace</th><th></th></tr></thead><tbody>${deckRows(r.decks, { withTournament: true })}</tbody></table>
      <div class="note">${r.total > r.decks.length ? `${r.total} listas; se muestran las ${r.decks.length} más recientes.` : `${r.total} ${r.total === 1 ? 'lista' : 'listas'}.`}</div>`;
    bindDeckButtons(out, dk); bindCmdLinks(out);
  };
  $('#td-go').onclick = go;
  [f.cmd, f.card, f.pl].forEach(i => { i.onkeydown = e => { if (e.key === 'Enter') { box.innerHTML = ''; go(); } }; });
  f.scope.onchange = go; f.cmd.onchange = go;
  let timer;
  f.card.oninput = () => {
    clearTimeout(timer);
    const v = f.card.value.trim();
    if (v.length < 2) { box.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const r = await api('/api/cards?q=' + encodeURIComponent(v));
        box.innerHTML = r.map(x => `<button type="button" class="sug" data-n="${esc(x.card)}" data-card="${esc(x.card)}"><span class="nm">${esc(x.card)}</span><span class="ct">${x.decks.toLocaleString('es-ES')} mazos</span></button>`).join('');
        box.querySelectorAll('button').forEach(b => { b.onclick = () => { f.card.value = b.dataset.n; box.innerHTML = ''; go(); }; });
      } catch { box.innerHTML = ''; }
    }, 150);
  };
  go();
}
export async function loadCommanderTournaments(name) {
  const q = $('#ct-q'), scope = $('#ct-scope'), sort = $('#ct-sort'), out = $('#ct-out'), more = $('#ct-more'), dk = $('#ct-deck'), sum = $('#ct-sum');
  const PAGE = 30;
  let shown = 0, seq = 0, timer;
  const load = async append => {
    const my = ++seq;
    if (!append) { shown = 0; out.innerHTML = '<span class="muted">Cargando…</span>'; }
    const qs = new URLSearchParams({ name, q: q.value.trim(), scope: scope.value, sort: sort.value, limit: PAGE, offset: shown });
    let r;
    try { r = await api('/api/commander-decks?' + qs); } catch (e) { out.innerHTML = `<span class="muted">No se pudo cargar: ${esc(e.message)}</span>`; return; }
    if (my !== seq) return;
    const s = r.summary;
    sum.innerHTML = `<b>${s.decks}</b> ${s.decks === 1 ? 'mazo' : 'mazos'} en <b>${s.tournaments}</b> ${s.tournaments === 1 ? 'torneo' : 'torneos'}` + (s.ranked ? ` · ${s.cut} pasaron al top cut · ${s.top4} en el top 4 · ${s.wins} ${s.wins === 1 ? 'campeonato' : 'campeonatos'}` : ' · aún sin posiciones guardadas (aparecen al renovar el seed)');
    if (!r.total) { out.innerHTML = '<span class="muted">Ningún mazo coincide con la búsqueda y los filtros.</span>'; more.hidden = true; return; }
    const rows = deckRows(r.decks, { withTournament: true, withCommander: false });
    if (append) out.querySelector('tbody').insertAdjacentHTML('beforeend', rows);
    else out.innerHTML = `<table><thead><tr><th>Fecha</th><th>Torneo</th><th class="n">Jugadores</th><th class="n">Puesto</th><th>Jugador</th><th class="n" title="Victorias-empates-derrotas en ese torneo (incluye el top cut) y porcentaje de victorias">Récord</th><th>Enlace</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    shown += r.decks.length;
    bindDeckButtons(out, dk); bindCmdLinks(out);
    more.hidden = shown >= r.total;
    more.textContent = `Mostrar más (${r.total - shown} restantes)`;
  };
  more.onclick = () => load(true);
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => load(false), 250); };
  scope.onchange = sort.onchange = () => load(false);
  load(false);
}
export const torneosHtml = () => `<div class="panel">
    <h2>Torneos y su podio</h2>
    <div class="muted" style="margin-bottom:8px">Los torneos cEDH del periodo elegido, del más reciente al más antiguo. Busca por nombre del torneo, jugador o comandante y abre su top cut para ver cada lista.</div>
    <div class="tablepick">
      <label class="sr" for="tr-q">Buscar torneos</label>
      <input type="search" id="tr-q" placeholder="Nombre del torneo, jugador o comandante…" autocomplete="off" style="flex:1;min-width:200px">
      <label>Orden <select id="tr-sort"><option value="date">Más recientes</option><option value="size">Más jugadores</option></select></label>
    </div>
    <div id="tr-out" style="margin-top:10px" class="muted">Cargando…</div>
    <div style="margin-top:8px"><button type="button" class="ghost" id="tr-more" hidden>Mostrar más</button></div>
  </div><div id="tr-det"></div><div id="tr-deck"></div>`;
export const topDecksHtml = () => `<div class="panel">
    <h2>Buscar listas que hicieron top</h2>
    <div class="muted" style="margin-bottom:8px">Encuentra listas que ganaron, entraron en el top 4 o pasaron al top cut. Filtra por comandante, por una carta que lleven o por jugador.</div>
    <div class="tablepick">
      <label>Comandante <input type="text" id="td-cmd" list="td-cmds" placeholder="cualquiera" autocomplete="off"></label><datalist id="td-cmds"></datalist>
      <label>Lleva la carta <input type="search" id="td-card" placeholder="Rhystic Study…" autocomplete="off"></label>
      <label>Jugador <input type="search" id="td-pl" placeholder="cualquiera" autocomplete="off"></label>
      <label>Resultado <select id="td-scope"><option value="cut">Pasó al top cut</option><option value="top4">Top 4</option><option value="win">Campeón</option></select></label>
      <button class="primary" id="td-go">Buscar</button>
    </div>
    <div id="td-sug" class="sugs" role="listbox" aria-label="Sugerencias de cartas"></div>
    <div id="td-out" style="margin-top:10px"></div>
  </div><div id="td-deck"></div>`;
