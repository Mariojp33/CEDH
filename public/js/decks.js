import { openCommander } from './commander.js';
import { $, F, api, cmdLabel, cn, copyText, esc, pct, short, ui } from './core.js';
import { openPlayer } from './players.js';

// ---- Torneos y listas top ----
export const dateEs = t => new Date(t * 1000).toLocaleDateString('es-ES');
const rec = d => `${d.wins}-${d.draws}-${d.losses}`;
// Porcentaje de victorias en ese torneo; sigue el ajuste de empates elegido (fuera del cálculo o como no ganados)
export const wrOf = d => { const g = F.dec ? d.wins + d.losses : d.wins + d.draws + d.losses; return g ? d.wins / g : null; };
const recCell = d => { const w = wrOf(d); return `<td class="n" data-v="${w ?? -1}" title="Victorias-empates-derrotas${F.dec ? '; el porcentaje no cuenta los empates' : ''}">${rec(d)}${w == null ? '' : ` <span class="muted">· ${pct(w, 0)}</span>`}</td>`; };
const posLabel = (rank, cut) => !rank ? '<span class="muted" title="Sin posición guardada (datos anteriores a este dato)">—</span>' : rank === 1 ? '<span class="tag">campeón</span>' : rank <= 4 ? `<b>${rank}.º</b>` : `${rank}.º`;
const noRanksNote = '<div class="note">Todavía no hay posiciones guardadas para este periodo. Aparecerán cuando se renueve el seed (se descargan con cada torneo nuevo).</div>';
export const cmdLink = c => `<a href="#" class="cmdlink" data-cmd="${esc(c)}">${esc(cmdLabel(c))}</a>`;
export function bindCmdLinks(root) {
  root.querySelectorAll('.cmdlink').forEach(a => { a.onclick = e => { e.preventDefault(); ui.view.tab = undefined; openCommander(a.dataset.cmd); }; });
}
// Enlace a la lista original (Moxfield, Archidekt…): se muestra el nombre del sitio; solo http(s)
const hostOf = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.hostname.replace(/^www\./, '') : ''; } catch { return ''; } };
const srcLink = u => { const h = hostOf(u); return h ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="Abrir la lista original en ${esc(h)}">${esc(h.split('.')[0])} ↗</a>` : '<span class="muted" title="TopDeck no guarda el enlace de esta lista">—</span>'; };
export function deckRows(list, { withTournament = false, withCommander = true } = {}) {
  return list.map(d => `<tr>
    ${withTournament ? `<td class="muted">${dateEs(d.date)}</td><td>${esc(short(String(d.name || ''), 52))}</td><td class="n" title="Jugadores del torneo">${d.size}</td>` : ''}
    <td class="n" data-v="${d.rank}">${posLabel(d.rank, d.cut)}</td><td>${d.player ? `<a href="#" class="plink" data-player="${esc(d.player)}" title="Ver las estadísticas de este jugador">${esc(d.player)}</a>` : '—'}</td>${withCommander ? `<td>${cmdLink(d.commander)}</td>` : ''}
    ${recCell(d)}<td>${srcLink(d.url)}</td><td>${d.rank ? `<button type="button" class="ghost" data-deck="${esc(d.tid)}" data-rank="${d.rank}">Ver lista</button>` : ''}</td></tr>`).join('');
}
export function bindDeckButtons(root, target) {
  root.querySelectorAll('.plink').forEach(a => { a.onclick = e => { e.preventDefault(); openPlayer(a.dataset.player); }; });
  root.querySelectorAll('[data-deck]').forEach(b => { b.onclick = () => showDeck(b.dataset.deck, Number(b.dataset.rank), target); });
}
// ---- Vista visual de una lista (tipo Moxfield) ----
// TopDeck solo guarda el nombre de las cartas. El tipo, el coste y la imagen se piden a Scryfall desde el navegador
// (una petición por cada 75 cartas, con caché en memoria). Si Scryfall no responde, la lista se muestra igual, sin agrupar.
const scryCards = new Map();                       // nombre (y cara frontal) en minúsculas -> carta de Scryfall
const frontOf = n => String(n).split(' // ')[0].toLowerCase();
async function loadScryCards(names) {
  const todo = [...new Set(names)].filter(n => !scryCards.has(n.toLowerCase()) && !scryCards.has(frontOf(n)));
  for (let i = 0; i < todo.length; i += 75) {
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identifiers: todo.slice(i, i + 75).map(name => ({ name })) }),
    });
    if (!res.ok) throw new Error('Scryfall ' + res.status);
    for (const c of (await res.json()).data || []) { scryCards.set(c.name.toLowerCase(), c); scryCards.set(frontOf(c.name), c); }
  }
}
const scryOf = n => scryCards.get(n.toLowerCase()) || scryCards.get(frontOf(n));
const scryImg = (c, size = 'small') => c && ((c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) || {})[size]);
// Grupo de una carta según su tipo (como Moxfield: una criatura artefacto va con las criaturas)
const TYPE_GROUPS = [['Criaturas', /Creature/], ['Planeswalkers', /Planeswalker/], ['Batallas', /Battle/], ['Instantáneos', /Instant/], ['Conjuros', /Sorcery/],
  ['Artefactos', /Artifact/], ['Encantamientos', /Enchantment/], ['Tierras', /Land/]];
function groupOf(name) {
  const c = scryOf(name);
  if (!c) return 'Otras';
  const t = String(c.type_line || (c.card_faces && c.card_faces[0].type_line) || '');
  const hit = TYPE_GROUPS.find(([, re]) => re.test(t.split(' // ')[0]));
  return hit ? hit[0] : 'Otras';
}
const cmcOf = name => { const c = scryOf(name); return c ? Math.floor(c.cmc ?? (c.card_faces && c.card_faces[0].cmc) ?? 0) : null; };
function deckVisual(d, host) {
  const rare = new Set(d.unusual);
  const withData = d.cards.some(c => scryOf(c.card));
  const fig = (c, big) => {
    const sc = scryOf(c.card), img = scryImg(sc, 'normal');
    const flag = d.enough && rare.has(c.card) ? ' rara' : '';
    return `<figure class="dcard${flag}${big ? ' cmdr' : ''}" data-card="${esc(c.card)}" title="${esc(c.card)}${d.enough ? ` · en el ${pct(c.share, 0)} de los mazos del comandante` : ''}">
      ${img ? `<img src="${esc(img)}" alt="${esc(c.card)}" loading="lazy">` : `<div class="noimg">${esc(c.card)}</div>`}
      ${c.copies > 1 ? `<span class="cp">×${c.copies}</span>` : ''}${flag ? '<span class="rr" title="Menos del 10 % de los mazos de este comandante la llevan">rara</span>' : ''}</figure>`;
  };
  const names = d.commander.split(' / ');
  const cmdFigs = names.map(n => fig({ card: n, copies: 1, share: 1 }, true)).join('');
  const groups = new Map();
  for (const c of d.cards) { const g = withData ? groupOf(c.card) : 'Cartas'; (groups.get(g) || groups.set(g, []).get(g)).push(c); }
  const order = [...TYPE_GROUPS.map(x => x[0]), 'Otras', 'Cartas'].filter(g => groups.has(g));
  const sortC = (a, b) => (cmcOf(a.card) ?? 0) - (cmcOf(b.card) ?? 0) || a.card.localeCompare(b.card);
  // Curva de maná (sin tierras): nº de cartas por coste, de 0 a 7 o más
  let curve = '';
  if (withData) {
    const bins = Array(8).fill(0);
    for (const c of d.cards) { if (groupOf(c.card) === 'Tierras') continue; const v = cmcOf(c.card); if (v != null) bins[Math.min(7, v)] += c.copies; }
    const mx = Math.max(1, ...bins);
    curve = `<div class="curve" aria-label="Curva de maná (sin tierras)">${bins.map((n, i) => `<div class="cb" title="${n} cartas de coste ${i === 7 ? '7 o más' : i}"><small>${n || ''}</small><i style="height:${Math.round(n / mx * 56)}px"></i><small class="d">${i === 7 ? '7+' : i}</small></div>`).join('')}</div>`;
  }
  host.innerHTML = `<div class="dgroup"><h3>Comandante${names.length > 1 ? 's' : ''}</h3><div class="dgrid">${cmdFigs}</div></div>` + curve +
    order.map(g => `<div class="dgroup"><h3>${g} <span class="muted">(${groups.get(g).reduce((s, c) => s + c.copies, 0)})</span></h3><div class="dgrid">${[...groups.get(g)].sort(sortC).map(c => fig(c)).join('')}</div></div>`).join('') +
    (withData ? '' : '<div class="note dk-offline">No se pudo consultar Scryfall para agrupar por tipo ni sacar las imágenes; se muestran los nombres. La vista «Tabla» tiene la lista completa.</div>');
}
async function showDeck(tid, rank, target) {
  target.innerHTML = '<div class="panel muted">Cargando la lista…</div>';
  target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  let d;
  try { d = await api(`/api/deck?tid=${encodeURIComponent(tid)}&rank=${rank}`); }
  catch (e) { target.innerHTML = `<div class="panel muted">No se pudo cargar la lista: ${esc(e.message)}</div>`; return; }
  const chips = list => list.map(x => cn(x.card || x)).join(', ');
  target.innerHTML = `<div class="panel">
    <h2>${esc(cmdLabel(d.commander))} <span class="muted" style="font-weight:400">· ${esc(d.player || 'jugador desconocido')}</span></h2>
    <div class="muted">${esc(d.name)} · ${dateEs(d.date)} · ${d.size} jugadores · puesto ${d.rank}.º · récord ${rec(d)}${wrOf(d) == null ? '' : ` (${pct(wrOf(d), 0)} de victorias)`}</div>
    <div class="tablepick" style="margin:10px 0">
      <button class="primary" id="dk-copy" title="Copia la lista para importarla en Moxfield, Archidekt o Commander Spellbook">Copiar lista</button>
      ${hostOf(d.url) ? `<a class="btn" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Lista original (${esc(hostOf(d.url).split('.')[0])}) ↗</a>` : ''}
      <button class="ghost" id="dk-cmd">Ver el comandante</button>
    </div>
    ${d.enough ? `
      <h3>Qué tiene de distinta</h3>
      <div>${d.unusual.length ? `<b>Cartas poco habituales</b> (menos del 10 % de los ${d.peers} mazos de este comandante): ${chips(d.unusual)}.` : 'No lleva ninguna carta poco habitual.'}</div>
      <div style="margin-top:6px">${d.missing.length ? `<b>No lleva, y la mayoría sí</b> (más de la mitad de los mazos): ${chips(d.missing)}.` : 'Lleva todo lo que juega la mayoría.'}</div>` :
      `<div class="muted">Hay pocos mazos de este comandante en el periodo (${d.peers}) para compararla con lo habitual.</div>`}
    <div class="seg" id="dk-views" role="group" aria-label="Forma de ver la lista" style="margin-top:14px"><button type="button" data-v="img" aria-pressed="true">Imágenes</button><button type="button" data-v="tab" aria-pressed="false">Tabla</button></div>
    <div id="dk-img" style="margin-top:10px"><span class="muted">Cargando imágenes…</span></div>
    <table id="dk-tab" hidden style="margin-top:12px"><thead><tr><th>Carta</th><th class="n">Copias</th><th class="n">En mazos del comandante</th></tr></thead><tbody>
      ${d.cards.map(c => `<tr><td>${cn(c.card)}</td><td class="n">${c.copies}</td><td><div class="share">${d.enough ? pct(c.share, 0) : '—'}<span style="width:${Math.round(c.share * 60)}px"></span></div></td></tr>`).join('')}
    </tbody></table>
    <div class="note">${d.total} cartas contando el comandante. «En mazos del comandante» es el porcentaje de los mazos de ese comandante en el periodo y filtros elegidos que llevan la carta.</div>
  </div>`;
  const cp = target.querySelector('#dk-copy');
  cp.onclick = () => copyText(d.text, cp);
  target.querySelector('#dk-cmd').onclick = () => { ui.view.tab = undefined; openCommander(d.commander); };
  const imgHost = target.querySelector('#dk-img'), tab = target.querySelector('#dk-tab');
  target.querySelectorAll('#dk-views button').forEach(b => { b.onclick = () => {
    target.querySelectorAll('#dk-views button').forEach(x => { x.setAttribute('aria-pressed', x === b); x.classList.toggle('on', x === b); });
    imgHost.hidden = b.dataset.v !== 'img'; tab.hidden = b.dataset.v !== 'tab';
  }; });
  target.querySelector('#dk-views [data-v=img]').classList.add('on');
  try { await loadScryCards([...d.cards.map(c => c.card), ...d.commander.split(' / ')]); } catch { /* sin Scryfall: se enseña sin agrupar */ }
  deckVisual(d, imgHost);
}
// Un torneo: por defecto el top cut; se puede ver a todos, ordenar por resultados y filtrar por comandante o jugador.
