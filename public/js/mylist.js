import { openCommander } from './commander.js';
import { $, F, api, cmdLabel, cn, copyText, ensureCommanders, esc, pct, pp, short, ui } from './core.js';
import { store } from './nav.js';

// Panel «Mi lista»: la lista pegada se compara con lo que juega el meta con este comandante.
export function bindMyList(name) {
  const saved = store.get('list:' + name);
  if (saved) { $('#ml-text').value = saved; $('#ml-text').placeholder = ''; }
  $('#ml-copy').onclick = () => copyText($('#ml-text').value, $('#ml-copy'));
  $('#ml-go').onclick = async () => {
    const out = $('#ml-out'), list = $('#ml-text').value;
    store.set('list:' + name, list); // se recuerda en este navegador para no pegarla cada vez
    if (!list.trim()) { out.innerHTML = '<span class="muted">Pega primero una lista.</span>'; return; }
    out.innerHTML = '<span class="muted">Analizando…</span>';
    try {
      const u = new URL('/api/mylist', location.origin);
      if (F.min) u.searchParams.set('minPlayers', F.min);
      if (F.max) u.searchParams.set('maxPlayers', F.max);
      if (F.days) u.searchParams.set('days', F.days);
      if (F.dec) u.searchParams.set('dec', 1);
      const res = await fetch(u, { method: 'POST', body: JSON.stringify({ commander: name, list }) });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || res.status);
      // Columnas: % de las listas más parecidas a la tuya que la llevan, y % de todos los mazos del comandante
      const row = c => `<tr><td>${cn(c.card)}${c.core ? ' <span class="tag">core</span>' : ''}</td><td class="n">${pct(c.peer, 0)}</td><td class="n muted">${pct(c.inclusion, 0)}</td></tr>`;
      const tbl = (rows, empty) => rows.length
        ? `<table><thead><tr><th>Carta</th><th class="n" title="% de las listas más parecidas a la tuya que la llevan">En listas parecidas</th><th class="n" title="% de todos los mazos de este comandante">En todos</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table>`
        : `<div class="muted">${empty}</div>`;
      const P = r.profile, tot = Math.max(1, P.standard + P.common + P.tech + P.rare);
      const seg = (n, cls, label) => n ? `<i class="${cls}" style="width:${n / tot * 100}%" title="${label}: ${n}"></i>` : '';
      const chips = (list, note) => list.length ? `<div class="chips">${list.map(c => `<span class="chip" data-card="${esc(c.card)}">${esc(short(c.card, 28))} <small>${pct(c.inVariant, 0)}</small></span>`).join('')}</div>` : `<div class="muted">${note}</div>`;
      const v = r.variant;
      const variantBox = v ? `
        <div class="variant" style="margin-bottom:6px">
          <h3>Variante ${v.index + 1} de ${v.total}: ${esc(short(v.signature.slice(0, 2).map(c => c.card).join(' + ') || 'sin rasgos claros', 60))}</h3>
          <div>Llevas <b>${v.typical.have} de las ${v.typical.total}</b> cartas típicas (las juega la mitad o más) de esta variante.</div>
          <div class="muted" style="margin-top:4px">${v.decks} mazos (${pct(v.share, 0)} del total) · winrate ${pct(v.winRate)} (probablemente entre ${pct(v.ci[0])} y ${pct(v.ci[1])}) · ${pp(v.winRate - v.baseline)} frente a la media del meta</div>
          <div class="cols" style="margin-top:10px">
            <div><b>Cartas típicas que no llevas</b>${chips(v.missing, 'Llevas todas las cartas típicas de esta variante.')}</div>
            <div><b>Cartas tuyas que casi nadie de esta variante juega</b>${chips(v.extra, 'Ninguna: todas tus cartas aparecen en esta variante.')}</div>
          </div>
        </div>` : '<div class="muted">No hay mazos suficientes (se piden al menos 40) para separar variantes con el periodo y los filtros actuales.</div>';
      const nbRows = (r.neighbors || []).map(n => `
        <tr><td class="n">${pct(n.similarity, 0)}</td><td class="n">${n.shared}</td>
          <td>${esc(short(n.tournament, 46))} <span class="muted">· ${n.size} jug. · ${n.date}</span></td>
          <td class="n" title="victorias-derrotas-empates">${n.record}</td>
          <td><details><summary>Ver diferencias</summary>
            <div class="muted" style="margin-top:6px">Ellos llevan y tú no</div><div class="chips">${n.onlyThem.map(c => `<span class="chip" data-card="${esc(c)}">${esc(short(c, 26))}</span>`).join('') || '—'}</div>
            <div class="muted" style="margin-top:6px">Tú llevas y ellos no</div><div class="chips">${n.onlyYou.map(c => `<span class="chip" data-card="${esc(c)}">${esc(short(c, 26))}</span>`).join('') || '—'}</div>
          </details></td></tr>`).join('');
      const allRows = r.all.map(row).join('');
      out.innerHTML = `
        <div class="muted" style="margin-bottom:12px">${r.cards} cartas reconocidas (sin tierras básicas) sobre ${r.decks} mazos del meta.
          ${r.unknown.length ? `<br>No aparecen en ningún mazo de este comandante (¿nombre mal escrito o carta nueva?): ${esc(r.unknown.slice(0, 12).join(', '))}${r.unknown.length > 12 ? '…' : ''}` : ''}</div>

        <h2>Cuánto se parece tu lista al meta</h2>
        <div class="profile" role="img" aria-label="Estándar ${P.standard}, comunes ${P.common}, tech ${P.tech}, raras ${P.rare}">${seg(P.standard, 's1', 'Estándar')}${seg(P.common, 's2', 'Comunes')}${seg(P.tech, 's3', 'Tech')}${seg(P.rare, 's4', 'Raras')}</div>
        <div class="legend"><span><i class="s1"></i>Estándar ${P.standard} <small>(las juega el 40 % o más)</small></span><span><i class="s2"></i>Comunes ${P.common} <small>(10–40 %)</small></span><span><i class="s3"></i>Tech ${P.tech} <small>(2–10 %)</small></span><span><i class="s4"></i>Raras ${P.rare} <small>(menos del 2 %)</small></span></div>
        <div class="note" style="margin-bottom:18px">Más cartas estándar = una lista más parecida a la media; más tech o raras = una lista más personal. Ninguna de las dos cosas es mejor por sí sola: es solo una forma de ver cuánto se parece tu lista a lo que se juega.</div>

        <h2>Variante más parecida</h2>
        ${variantBox}

        <h2 style="margin-top:20px">Listas reales más parecidas a la tuya</h2>
        ${nbRows ? `<table><thead><tr><th class="n">Parecido</th><th class="n">Cartas en común</th><th>Torneo</th><th class="n" title="victorias-derrotas-empates">Récord</th><th></th></tr></thead><tbody>${nbRows}</tbody></table>
        <div class="note">Cada fila es un mazo real (sin nombre de jugador) y lo que sacó en ese torneo. Son pocas partidas por mazo, así que sirve para ver cómo rindieron listas casi iguales a la tuya, <b>no para predecir tu resultado</b>: lo hemos comprobado y las listas parecidas no predicen mejor que la media del comandante. Las listas idénticas cuentan una sola vez.</div>` : '<div class="muted">No hay listas suficientes para comparar.</div>'}

        <h2 style="margin-top:22px">Qué te falta o te sobra frente a listas como la tuya</h2>
        <div class="muted" style="margin-bottom:10px">Se compara con las <b>${r.peers.n} listas más parecidas</b> a la tuya (parecido medio ${pct(r.peers.similarity, 0)}), no con todo el meta, para que las sugerencias encajen con tu plan de juego.</div>
        <div class="cols wide">
          <div><div class="row"><h2>Las llevan casi todas y tú no</h2>${r.missing.length ? '<button class="ghost" data-copy="missing">Copiar lista</button>' : ''}</div>${tbl(r.missing, 'Llevas todo lo que juega la mayoría de listas parecidas.')}</div>
          <div><div class="row"><h2>Alternativas habituales que no llevas</h2>${r.options.length ? '<button class="ghost" data-copy="options">Copiar lista</button>' : ''}</div>${tbl(r.options, 'Ninguna alternativa se repite lo bastante en listas parecidas.')}</div>
        </div>
        <h2 style="margin-top:16px">Cartas tuyas poco habituales en listas como la tuya</h2>${tbl(r.unusual, 'Todas tus cartas las juega alguna lista parecida.')}
        <div class="note">Una carta poco habitual puede ser una decisión tuya (una carta de tu meta local, un plan propio). Aquí solo se señala qué se aparta de lo común: <b>no hay evidencia de que sea peor</b>. Estas sugerencias reflejan lo que juegan las listas parecidas, no una promesa de que mejoren tu resultado: lo comprobamos con cambios reales de lista de los mismos jugadores y el winrate asociado a cada carta no predice mejoras.</div>

        <details style="margin-top:20px"><summary><b>Todas tus cartas (${r.all.length}) y cuánto se usan</b></summary>
          <table style="margin-top:8px"><thead><tr><th>Carta</th><th class="n" title="% de las listas más parecidas a la tuya que la llevan">En listas parecidas</th><th class="n" title="% de todos los mazos de este comandante">En todos</th></tr></thead><tbody>${allRows}</tbody></table>
        </details>`;
      out.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => copyText(r[b.dataset.copy].map(c => '1 ' + c.card).join('\n'), b));
    } catch (e) { out.innerHTML = `<span class="muted">${esc(e.message)}</span>`; }
  };
}

// ---- Revisar mi lista (entrada propia): detecta el comandante y abre su análisis ----
const cleanCard = n => String(n).replace(/\s*\*[A-Za-z]+\*\s*$/, '').replace(/\s+\([A-Za-z0-9]{2,6}\)\s*[\w★-]*\s*$/, '').split(' // ')[0].trim();
function detectCommanders(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const entry = l => { const m = l.match(/^(\d+)\s*x?\s+(.+)$/i); return cleanCard(m ? m[2] : l); };
  // 1) sección de comandantes de la propia lista
  const named = []; let inCmd = false;
  for (const l of lines) {
    const sec = l.match(/^~~\s*(.+?)\s*~~$/);
    if (sec) { inCmd = /^commander/i.test(sec[1]); continue; }
    if (/^commanders?:?$/i.test(l)) { inCmd = true; continue; }
    if (!l) { if (named.length) inCmd = false; continue; }
    if (inCmd) named.push(entry(l));
  }
  const all = new Set(lines.filter(Boolean).map(entry).map(x => x.toLowerCase()));
  const byName = key => key.split(' / ').map(x => x.toLowerCase());
  if (named.length) {
    const want = [...named].sort().join(' / ').toLowerCase();
    const hit = ui.commanders.find(c => c.commander.toLowerCase() === want);
    if (hit) return [hit.commander];
  }
  // 2) sin sección: comandantes conocidos cuyos nombres aparecen todos en la lista (primero los de pareja)
  const cands = ui.commanders.filter(c => byName(c.commander).every(n => all.has(n)));
  const maxParts = Math.max(0, ...cands.map(c => byName(c.commander).length));
  return cands.filter(c => byName(c.commander).length === maxParts).sort((a, b) => b.decks - a.decks).map(c => c.commander);
}
export async function bindReviewList() {
  await ensureCommanders();
  const sel = $('#rl-cmd'), msg = $('#rl-msg');
  sel.innerHTML = '<option value="">— detectarlo a partir de la lista —</option>' + ui.commanders.map(c => `<option value="${esc(c.commander)}">${esc(cmdLabel(c.commander))} (${c.decks})</option>`).join('');
  const saved = store.get('review'); if (saved) $('#rl-text').value = saved;
  $('#rl-copy').onclick = () => copyText($('#rl-text').value, $('#rl-copy'));
  $('#rl-go').onclick = () => {
    const text = $('#rl-text').value;
    if (!text.trim()) { msg.textContent = 'Pega primero tu lista.'; return; }
    let key = sel.value;
    if (!key) {
      const found = detectCommanders(text);
      if (found.length > 1) { msg.innerHTML = `Podría ser más de un comandante (${found.slice(0, 4).map(esc).join('; ')}): elige el tuyo en el desplegable.`; return; }
      if (!found.length) { msg.textContent = 'No he podido detectar el comandante en tu lista (o tiene muy pocos mazos en estos datos): elígelo en el desplegable.'; return; }
      key = found[0];
    }
    msg.textContent = '';
    store.set('review', text); store.set('list:' + key, text);     // se recuerda; el análisis lo lee de ahí
    ui.view = { t: 'cmd', name: key, minWith: 5, tab: 'lista', autorun: true };
    openCommander(key);
  };
}

// Texto sobre cómo se cuentan los empates, según el modo elegido.
