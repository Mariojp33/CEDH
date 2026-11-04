import { $, F, api, cardBtn, cmdBtn, cmdLabel, dayMonth, esc, pct, pp } from './core.js';

// ---- Alertas: cambios claros del último periodo frente a los dos anteriores ----
function alertsHtml(alerts, partial, decks) {
  const warn = partial ? `<p class="muted">⚠ El último periodo tiene pocos mazos (${decks}) frente a los anteriores: puede estar incompleto y los cambios son menos fiables.</p>` : '';
  if (!alerts.length) return warn + '<div class="alerts quiet">Sin cambios claros en el último periodo: nadie sube ni baja más de lo que explicaría el azar.</div>';
  const row = a => {
    const up = a.direction === 'up', arrow = up ? '▲' : '▼', cls = up ? 'pos-t' : 'neg-t';
    const what = a.kind === 'presence'
      ? `presencia <b>${pct(a.from, 1)} → ${pct(a.to, 1)}</b> <span class="${cls}">${pp(a.change)}</span>`
      : `winrate <b>${pct(a.to, 1)}</b> <span class="${cls}">${pp(a.change)}</span> frente a los dos periodos anteriores`;
    return `<li><span class="${cls}">${arrow}</span> ${cmdBtn(a.commander)} <span class="muted">${what}</span></li>`;
  };
  return `<div class="alerts"><h2>Cambios claros del último periodo</h2>${warn}<ul>${alerts.map(row).join('')}</ul>
    <details class="note"><summary>¿Cómo se decide qué es «claro»?</summary>Se compara el último periodo de 30 días con los dos anteriores. Solo aparece un cambio si es estadísticamente claro (z ≥ 3, exigente porque se miran decenas de comandantes a la vez) y de tamaño apreciable: al menos 1 punto de presencia o 3 puntos de winrate, con 60 partidas o más en cada lado. Es una descripción de qué ha cambiado, no una predicción.</details></div>`;
}

// ---- Meta del momento ----
const TIERS = {
  S: 'Claramente por encima de la media', A: 'Por encima de la media', B: 'En la media o sin datos claros',
  C: 'Por debajo de la media', D: 'Claramente por debajo de la media',
};
const PALETTE = ['#b4532a', '#2f7d4f', '#3b6ea8', '#c28b1e', '#7a4fa3', '#2a8f8f', '#b3372f', '#6b8e23'];
export async function loadMeta() {
  const box = $('#meta');
  try {
    const r = await api('/api/meta');
    if (!r.commanders.length) { box.textContent = 'Sin datos suficientes con el periodo y filtros actuales.'; return; }
    const top = r.commanders.slice(0, 8), n = r.buckets.length, H = 190;
    const col = i => {            // i = 0 más antiguo … n-1 más reciente
      const segs = top.map(c => c.series[i]), other = Math.max(0, 1 - segs.reduce((a, b) => a + b, 0));
      return { segs, other };
    };
    const stack = r.buckets.map((b, i) => {
      const { segs, other } = col(i);
      return `<div class="stackcol"><div class="stackbar" role="img" aria-label="Periodo hasta ${dayMonth(b.end)}">
        <i style="height:${other * H}px;background:var(--line)" title="Otros: ${pct(other)}"></i>
        ${segs.map((v, k) => `<i style="height:${v * H}px;background:${PALETTE[k]}" title="${esc(top[k].commander)}: ${pct(v)}">${v * H >= 15 ? pct(v, 0) : ''}</i>`).reverse().join('')}
        </div><small>${dayMonth(b.end)}</small></div>`;
    }).join('');
    const legend = top.map((c, k) => `<span title="${esc(c.commander)}"><i style="background:${PALETTE[k]}"></i>${esc(cmdLabel(c.commander))} <small>${pct(c.share, 0)}</small></span>`).join('') + `<span><i style="background:var(--line)"></i>Otros</span>`;
    const by = {}; for (const c of r.commanders) (by[c.tier] = by[c.tier] || []).push(c);
    const tiers = Object.keys(TIERS).filter(t => by[t]).map(t => `
      <div class="tier t${t}"><div class="tl"><b>${t}</b><small>${TIERS[t]}</small></div>
        <div class="tc">${by[t].map(c => `<span class="tchip">${cmdBtn(c.commander)} <small>${pct(c.winRate)} · ${c.decks} mazos</small></span>`).join('')}</div></div>`).join('');
    const movers = [...r.commanders].sort((a, b) => b.change - a.change);
    const mv = list => list.map(c => `<tr><td>${cmdBtn(c.commander)}</td><td class="n">${pct(c.series[n - 1], 1)}</td><td class="n ${c.change >= 0 ? 'pos-t' : 'neg-t'}">${pp(c.change)}</td></tr>`).join('');
    const draws = [...r.commanders].sort((a, b) => b.drawRate - a.drawRate);
    const maxDraw = Math.max(0.01, ...r.buckets.map(b => b.drawRate || 0));
    const dr = list => list.map(c => `<tr><td>${cmdBtn(c.commander)}</td><td class="n">${pct(c.drawRate, 0)}</td></tr>`).join('');
    box.className = 'muted-reset';
    const solid = r.commanders.filter(c => c.decks >= r.minDecks);
    const best = [...solid].sort((a, b) => b.winRate - a.winRate)[0], most = r.commanders[0];
    const clear = (kind, dir) => (r.alerts || []).find(a => a.kind === kind && a.direction === dir);
    const upA = clear('presence', 'up'), downA = clear('presence', 'down');
    const byName = n => r.commanders.find(c => c.commander === n);
    const up = upA ? { ...byName(upA.commander), change: upA.change } : { change: 0 }, down = downA ? { ...byName(downA.commander), change: downA.change } : { change: 0 };
    const tile = (label, c, val, cls = '') => c ? `<div class="kpi"><small>${label}</small><b>${cmdBtn(c.commander)}</b><span class="${cls}">${val}</span></div>` : '';
    box.innerHTML = `
      <div class="kpis">
        ${tile('Más jugado', most, `${pct(most.series[n - 1], 1)} del meta`)}
        ${tile('Mejor winrate', best, best && `${pct(best.winRate)} · ${best.decks} mazos`, 'pos-t')}
        ${tile('Más sube', up.change > 0 ? up : null, `${pp(up.change)} de presencia`, 'pos-t')}
        ${tile('Más baja', down.change < 0 ? down : null, `${pp(down.change)} de presencia`, 'neg-t')}
      </div>
      ${alertsHtml(r.alerts || [], r.recentPartial, r.recentDecks)}
      <div class="muted">${r.decksInPeriod} mazos cEDH · winrate medio <b>${pct(r.mean)}</b> ${F.dec ? '(solo partidas con ganador)' : '(empates como no ganadas)'}.</div>

      <h2 style="margin-top:18px">Presencia en el meta, mes a mes</h2>
      <div class="stack">${stack}</div>
      <div class="legend" style="margin-top:8px">${legend}</div>
      <details class="note"><summary>¿Cómo se lee?</summary>Cada barra es un periodo de 30 días (etiquetado con su fecha final) y su altura reparte el 100 % de los mazos de ese periodo entre los ocho comandantes más jugados y el resto.</details>

      <h2 style="margin-top:20px">Niveles por resultados</h2>
      <div class="tiers">${tiers}</div>
      <details class="note"><summary>¿Cómo se calcula el nivel?</summary>El nivel sale del <b>rango probable del winrate</b> frente a la media del meta (${pct(r.mean)}): S y D solo si el rango queda a más de 2 puntos de la media; A y C si queda entero por encima o por debajo; B si no se distingue de la media (poca muestra o rendimiento medio). Solo entran los comandantes con ${r.minDecks} mazos o más. <b>Es una descripción de resultados, no de la fuerza del mazo</b>: el winrate refleja también al jugador y al plan.</details>

      <div class="cols wide" style="margin-top:20px">
        <div><h2>Suben en presencia</h2><table><thead><tr><th>Comandante</th><th class="n">Ahora</th><th class="n" title="Último periodo frente a la media de los dos anteriores">Cambio</th></tr></thead><tbody>${mv(movers.slice(0, 5))}</tbody></table></div>
        <div><h2>Bajan en presencia</h2><table><thead><tr><th>Comandante</th><th class="n">Ahora</th><th class="n" title="Último periodo frente a la media de los dos anteriores">Cambio</th></tr></thead><tbody>${mv(movers.slice(-5).reverse())}</tbody></table></div>
      </div>

      <h2 style="margin-top:20px">Empates</h2>
      <div class="spark">${r.buckets.map(b => `<div class="sb" title="${b.decks} mazos"><small>${b.drawRate == null ? '—' : pct(b.drawRate, 1)}</small>
        <i style="height:${b.drawRate == null ? 0 : Math.max(2, b.drawRate / maxDraw * 60)}px"></i><small class="d">${dayMonth(b.end)}</small></div>`).join('')}</div>
      <div class="note" style="margin-bottom:10px">Porcentaje de partidas que acaban en empate, por periodos de 30 días. La tasa de empates es una característica estable de cada comandante.</div>
      <div class="cols wide">
        <div><h2>Más empates</h2><table><thead><tr><th>Comandante</th><th class="n">Empates</th></tr></thead><tbody>${dr(draws.slice(0, 6))}</tbody></table></div>
        <div><h2>Menos empates</h2><table><thead><tr><th>Comandante</th><th class="n">Empates</th></tr></thead><tbody>${dr(draws.slice(-6).reverse())}</tbody></table></div>
      </div>`;
  } catch (e) { box.textContent = e.message; }
}

// ---- Novedades del meta ----
export async function loadNovelties() {
  const box = $('#nov');
  try {
    const r = await api('/api/novelties');
    if (r.tooFew) { box.textContent = 'Hacen falta más mazos recientes para detectar novedades con los filtros actuales.'; return; }
    const where = c => c.commanders.map(x => cmdBtn(x.commander)).join(' · ');
    const table = (rows, empty, extra) => rows.length ? `<table><thead><tr><th>Carta</th><th class="n" title="% de mazos que la llevaban en los dos meses anteriores">Antes</th><th class="n">Último mes</th><th class="n">Cambio</th><th>Dónde se juega más</th></tr></thead>
      <tbody>${rows.map(c => `<tr><td>${cardBtn(c.card)}${extra ? extra(c) : ''}</td><td class="n muted">${pct(c.base, 0)}</td><td class="n">${pct(c.recent, 0)}</td>
        <td class="n ${c.change >= 0 ? 'pos-t' : 'neg-t'}">${pp(c.change)}</td><td>${where(c)}</td></tr>`).join('')}</tbody></table>` : `<div class="muted">${empty}</div>`;
    box.className = 'muted-reset';
    box.innerHTML = `
      <div>Se compara el <b>último mes</b> (${r.recentDecks} mazos) con los <b>dos meses anteriores</b> (${r.baseDecks} mazos). Pulsa una carta para ver su ficha.</div>
      <h2 style="margin-top:16px">Cartas nuevas en el meta</h2>
      ${table(r.fresh, 'No hay cartas que hayan aparecido en los datos hace poco con uso apreciable.', c => ` <span class="tag" title="Primera vez en los datos: ${new Date(c.firstSeen).toLocaleDateString('es-ES')}">nueva</span>`)}
      <div class="cols wide" style="margin-top:18px">
        <div><h2>En ascenso</h2>${table(r.rising, 'Ninguna carta sube de forma clara.')}</div>
        <div><h2>En descenso</h2>${table(r.falling, 'Ninguna carta baja de forma clara.')}</div>
      </div>
      <details class="note"><summary>¿Cómo se lee?</summary>Un cambio solo cuenta si es de al menos 2 puntos y estadísticamente claro (z ≥ 3), para que no se cuele el ruido. Solo describe qué se juega, <b>no si la carta funciona mejor o peor</b>. «Nueva» significa que no aparece en los datos hasta hace poco (por ejemplo, una edición recién publicada).</details>`;
  } catch (e) { box.textContent = e.message; }
}

// ---- Destacados de la portada: tres datos de un vistazo (comandante en alza, carta en ascenso, último torneo) ----
export async function loadHighlights(box) {
  if (!box) return;
  try {
    const [m, n, t] = await Promise.all([
      api('/api/meta').catch(() => null), api('/api/novelties').catch(() => null), api('/api/tournaments?limit=1', { days: 0 }).catch(() => null),
    ]);
    const items = [];
    const up = m && (m.alerts || []).find(a => a.kind === 'presence' && a.direction === 'up');
    if (up) items.push(['En alza', cmdBtn(up.commander), `<span class="pos-t">${pp(up.change)}</span> de presencia en el meta`]);
    const card = n && !n.tooFew && n.rising && n.rising[0];
    if (card) items.push(['Carta en ascenso', cardBtn(card.card), `<span class="pos-t">${pp(card.change)}</span> en el último mes · ${pct(card.recent, 0)} de los mazos`]);
    const tor = t && t.tournaments && t.tournaments[0], champ = tor && tor.top && tor.top[0];
    if (tor) items.push(['Último torneo', `<b>${esc(tor.name)}</b>`, `${new Date(tor.date * 1000).toLocaleDateString('es-ES')} · ${tor.size} jugadores${champ ? ` · <span class="nw">campeón ${cmdBtn(champ.commander)}</span>` : ''}`]);
    box.innerHTML = items.map(([k, title, sub]) => `<div class="hlc"><small>${k}</small><div class="hlt">${title}</div><div class="hls">${sub}</div></div>`).join('');
  } catch { box.innerHTML = ''; }
}
