import { openCommander } from './commander.js';
import { $, F, api, cmdLabel, cn, copyText, esc, pct, pp, short, sig, track, ui } from './core.js';
import { goTab, writeHash } from './nav.js';

export async function loadMini(name) {
  const box = $('#mini6');
  if (!box) return;
  try {
    const t = await api(`/api/trend?name=${encodeURIComponent(name)}`, { days: 0 });
    if (ui.view.name !== name) return;                          // se cambió de comandante mientras cargaba
    const S = t.series;
    if (S.length < 2) { box.innerHTML = '<h2>Últimos 6 meses</h2><div class="muted">Aún no hay datos de varios periodos para dibujar la evolución.</div>'; return; }
    const W = 340, H = 118, L = 34, R = 10, T = 12, B = 22, n = S.length;
    const X = i => L + i / (n - 1) * (W - L - R);
    const lab = b => new Date(b.end * 1000).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    const frame = (lo, hi, fmt) => [lo, (lo + hi) / 2, hi].map(v => { const y = T + (1 - (v - lo) / (hi - lo)) * (H - T - B); return `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${L - 4}" y="${y + 4}" text-anchor="end">${fmt(v)}</text>`; }).join('') +
      [0, n - 1].map(i => `<text x="${X(i)}" y="${H - 6}" text-anchor="${i ? 'end' : 'start'}">${lab(S[i])}</text>`).join('');
    // Presencia
    const shares = S.map(b => b.metaShare), sMax = Math.max(...shares) * 1.15 || 0.01;
    const Ys = v => T + (1 - v / sMax) * (H - T - B);
    const pLine = shares.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Ys(v).toFixed(1)).join(' ');
    const pArea = pLine + ` L${X(n - 1)} ${H - B} L${X(0)} ${H - B} Z`;
    const dS = shares[n - 1] - shares[0];
    // Winrate
    const wr = S.filter(b => b.winRate != null);
    let wrChart = '<div class="muted">Con menos de 10 mazos por periodo el winrate no se dibuja.</div>', wrSum = '';
    if (wr.length >= 2) {
      const metas = S.map(b => b.meta).filter(v => v != null);
      const lo = Math.max(0, Math.min(...metas, ...wr.map(b => b.ci[0])) - .02), hi = Math.min(1, Math.max(...metas, ...wr.map(b => b.ci[1])) + .02);
      const Yw = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
      const pts = S.map((b, i) => b.winRate == null ? null : [X(i), Yw(b.winRate)]).filter(Boolean);
      const ci = S.map((b, i) => b.ci && [X(i), Yw(b.ci[1]), Yw(b.ci[0])]).filter(Boolean);
      const band = 'M' + ci.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L') + ' L' + [...ci].reverse().map(q => q[0].toFixed(1) + ' ' + q[2].toFixed(1)).join(' L') + ' Z';
      const metaLine = S.map((b, i) => b.meta == null ? null : [X(i), Yw(b.meta)]).filter(Boolean).map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
      const last = wr[wr.length - 1];
      wrChart = `<svg class="mini" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución del winrate en los últimos 6 meses">${frame(lo, hi, v => (v * 100).toFixed(0) + '%')}
        <path d="${band}" fill="var(--accent)" fill-opacity=".18"/><path d="${metaLine}" fill="none" stroke="var(--ink)" stroke-opacity=".55" stroke-dasharray="4 3"/>
        <path d="${pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.2"/>
        ${S.map((b, i) => b.winRate == null ? '' : `<circle cx="${X(i)}" cy="${Yw(b.winRate)}" r="3.2" fill="var(--accent)"><title>Hasta ${lab(b)}: winrate ${pct(b.winRate)} (${b.decks} mazos, ${b.games} partidas)</title></circle>`).join('')}</svg>`;
      wrSum = `Último periodo: <b>${pct(last.winRate)}</b> <span class="muted">(IC 95 %: ${pct(last.ci[0], 0)}–${pct(last.ci[1], 0)}; media del meta ${last.meta == null ? '—' : pct(last.meta, 0)})</span>`;
    }
    // Top cut: % de sus mazos con puesto que pasan el corte, frente a lo que daría el azar
    const ct = S.filter(b => b.cutRate != null);
    let cutChart = '<div class="muted">Todavía no hay puestos guardados en suficientes mazos de este comandante (hacen falta al menos 10 por periodo; se completan al renovar el seed).</div>', cutSum = '';
    if (ct.length >= 2) {
      const lo = 0, hi = Math.min(1, Math.max(...ct.map(b => b.cutCi[1]), ...S.map(b => b.cutExpected || 0)) + .03);
      const Yc = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
      const pts = S.map((b, i) => b.cutRate == null ? null : [X(i), Yc(b.cutRate)]).filter(Boolean);
      const ci = S.map((b, i) => b.cutCi && b.cutRate != null && [X(i), Yc(b.cutCi[1]), Yc(b.cutCi[0])]).filter(Boolean);
      const band = 'M' + ci.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L') + ' L' + [...ci].reverse().map(q => q[0].toFixed(1) + ' ' + q[2].toFixed(1)).join(' L') + ' Z';
      const exp = S.map((b, i) => b.cutExpected == null ? null : [X(i), Yc(b.cutExpected)]).filter(Boolean).map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
      const last = ct[ct.length - 1];
      cutChart = `<svg class="mini" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución del porcentaje de mazos que pasan el top cut">${frame(lo, hi, v => (v * 100).toFixed(0) + '%')}
        <path d="${band}" fill="var(--accent)" fill-opacity=".18"/><path d="${exp}" fill="none" stroke="var(--ink)" stroke-opacity=".55" stroke-dasharray="4 3"/>
        <path d="${pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.2"/>
        ${S.map((b, i) => b.cutRate == null ? '' : `<circle cx="${X(i)}" cy="${Yc(b.cutRate)}" r="3.2" fill="var(--accent)"><title>Hasta ${lab(b)}: ${pct(b.cutRate)} pasó el top cut (${Math.round(b.cutRate * b.ranked)} de ${b.ranked} mazos con puesto; el azar daría ${pct(b.cutExpected)})</title></circle>`).join('')}</svg>`;
      cutSum = `Último periodo: <b>${pct(last.cutRate)}</b> <span class="muted">(IC 95 %: ${pct(last.cutCi[0], 0)}–${pct(last.cutCi[1], 0)}; el azar daría ${last.cutExpected == null ? '—' : pct(last.cutExpected, 0)})</span>`;
    }
    box.innerHTML = `<div class="mini-head"><h2 style="margin:0">Últimos 6 meses <span class="muted" style="font-weight:400;font-size:13px">· no depende del periodo elegido</span></h2><button type="button" class="ghost" id="mini-more">Ver el detalle en Resultados</button></div>
      <div class="mini-grid">
        <div><div class="mini-t">Presencia en el meta <span class="muted">(% de todos los mazos)</span></div>
          <svg class="mini" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución de la presencia en el meta en los últimos 6 meses">${frame(0, sMax, v => (v * 100).toFixed(v < 0.1 ? 1 : 0) + '%')}
            <path d="${pArea}" fill="var(--accent)" fill-opacity=".16"/><path d="${pLine}" fill="none" stroke="var(--accent)" stroke-width="2.2"/>
            ${S.map((b, i) => `<circle cx="${X(i)}" cy="${Ys(b.metaShare)}" r="3.2" fill="var(--accent)"><title>Hasta ${lab(b)}: ${pct(b.metaShare)} del meta (${b.decks} mazos)</title></circle>`).join('')}</svg>
          <div>${pct(shares[0])} → <b>${pct(shares[n - 1])}</b> <b class="${Math.abs(dS) < 0.002 ? 'muted' : dS > 0 ? 'pos-t' : 'neg-t'}">${pp(dS)}</b></div></div>
        <div><div class="mini-t">Winrate <span class="muted">(línea discontinua = media del meta; zona = IC 95 %)</span></div>${wrChart}<div>${wrSum}</div></div>
        <div><div class="mini-t">Pasar el top cut <span class="muted">(% de sus mazos; discontinua = lo que daría el azar)</span></div>${cutChart}<div>${cutSum}</div></div>
      </div>
      <div class="note" style="margin-top:8px"><b>Siempre usa los últimos 6 meses</b>, elijas el periodo que elijas arriba.${F.min || F.max ? ' Sí respeta el filtro de jugadores por torneo.' : ''} Cada punto es un periodo de ${t.bucketDays} días, etiquetado con su fecha final. El primero y el último pueden tener pocos mazos y moverse mucho: no leas un cambio pequeño como tendencia.</div>`;
    $('#mini-more').onclick = () => goTab('resultados');
  } catch (e) { box.innerHTML = `<h2>Últimos 6 meses</h2><div class="muted">No se pudo cargar la evolución: ${esc(e.message)}</div>`; }
}
// Evolución de una carta dentro de un comandante: winrate con y sin ella, y % de mazos que la llevan, en los últimos 6 meses.
export async function loadCardEvo(name, card) {
  const box = $('#ce-out');
  box.innerHTML = '<div class="panel muted" style="margin-top:12px">Calculando…</div>';
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  try {
    const t = await api(`/api/card-trend?name=${encodeURIComponent(name)}&card=${encodeURIComponent(card)}`, { days: 0 });
    if (ui.view.name !== name) return;
    const S = t.series, n = S.length;
    if (n < 2) { box.innerHTML = '<div class="panel muted" style="margin-top:12px">Aún no hay datos de varios periodos.</div>'; return; }
    const W = 340, H = 118, L = 34, R = 10, T = 12, B = 22;
    const X = i => L + i / (n - 1) * (W - L - R);
    const lab = b => new Date(b.end * 1000).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    const frame = (lo, hi, fmt) => [lo, (lo + hi) / 2, hi].map(v => { const y = T + (1 - (v - lo) / (hi - lo)) * (H - T - B); return `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${L - 4}" y="${y + 4}" text-anchor="end">${fmt(v)}</text>`; }).join('') +
      [0, n - 1].map(i => `<text x="${X(i)}" y="${H - 6}" text-anchor="${i ? 'end' : 'start'}">${lab(S[i])}</text>`).join('');
    const path = pts => pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
    // Winrate con y sin la carta
    const vals = S.flatMap(b => [b.winRateWith, b.winRateWithout, ...(b.ciWith || []), ...(b.ciWithout || [])]).filter(v => v != null);
    const hasW = S.filter(b => b.winRateWith != null).length >= 2;
    let wrSvg = '<div class="muted">Con menos de ' + t.minDecks + ' mazos con la carta en un periodo no se dibuja su winrate.</div>';
    if (hasW) {
      const lo = Math.max(0, Math.min(...vals) - .02), hi = Math.min(1, Math.max(...vals) + .02);
      const Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
      const ci = S.map((b, i) => b.ciWith && [X(i), Y(b.ciWith[1]), Y(b.ciWith[0])]).filter(Boolean);
      const band = 'M' + ci.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L') + ' L' + [...ci].reverse().map(q => q[0].toFixed(1) + ' ' + q[2].toFixed(1)).join(' L') + ' Z';
      const withP = S.map((b, i) => b.winRateWith == null ? null : [X(i), Y(b.winRateWith)]).filter(Boolean);
      const withoutP = S.map((b, i) => b.winRateWithout == null ? null : [X(i), Y(b.winRateWithout)]).filter(Boolean);
      wrSvg = `<svg class="mini" viewBox="0 0 ${W} ${H}" role="img" aria-label="Winrate con y sin ${esc(card)} por periodos">${frame(lo, hi, v => (v * 100).toFixed(0) + '%')}
        <path d="${band}" fill="var(--accent)" fill-opacity=".18"/>
        ${withoutP.length > 1 ? `<path d="${path(withoutP)}" fill="none" stroke="var(--ink)" stroke-opacity=".6" stroke-dasharray="4 3" stroke-width="1.6"/>` : ''}
        <path d="${path(withP)}" fill="none" stroke="var(--accent)" stroke-width="2.2"/>
        ${S.map((b, i) => b.winRateWith == null ? '' : `<circle cx="${X(i)}" cy="${Y(b.winRateWith)}" r="3.2" fill="var(--accent)"><title>Hasta ${lab(b)}: con ella ${pct(b.winRateWith)} (${b.withDecks} mazos)${b.winRateWithout == null ? '' : `; sin ella ${pct(b.winRateWithout)} (${b.withoutDecks} mazos)`}</title></circle>`).join('')}</svg>`;
    }
    // % de mazos que la llevan
    const incMax = Math.min(1, Math.max(...S.map(b => b.inclusion)) * 1.15 || 0.05);
    const Yi = v => T + (1 - v / incMax) * (H - T - B);
    const incPts = S.map((b, i) => [X(i), Yi(b.inclusion)]);
    const tot = t.total;
    const diff = tot.winRateWith != null && tot.winRateWithout != null ? tot.winRateWith - tot.winRateWithout : null;
    const sepOk = tot.ciWith && tot.ciWithout && (tot.ciWith[0] > tot.ciWithout[1] || tot.ciWith[1] < tot.ciWithout[0]);
    box.innerHTML = `<div class="panel" style="margin-top:12px">
      <div class="mini-head"><h2 style="margin:0">${cn(card)} <span class="muted" style="font-weight:400;font-size:13px">· evolución en ${esc(cmdLabel(name))}, últimos 6 meses</span></h2><button type="button" class="ghost" id="ce-close">Cerrar</button></div>
      <div class="mini-grid">
        <div><div class="mini-t">Winrate <span class="muted">(línea = con la carta, zona = IC 95 %; discontinua = sin ella)</span></div>${wrSvg}
          <div>${tot.winRateWith == null ? '' : `Con ella: <b>${pct(tot.winRateWith)}</b> <span class="muted">(${pct(tot.ciWith[0], 0)}–${pct(tot.ciWith[1], 0)}, ${tot.withDecks} mazos)</span>`}</div>
          <div>${tot.winRateWithout == null ? '' : `Sin ella: <b>${pct(tot.winRateWithout)}</b> <span class="muted">(${pct(tot.ciWithout[0], 0)}–${pct(tot.ciWithout[1], 0)}, ${tot.withoutDecks} mazos)</span>`}</div></div>
        <div><div class="mini-t">Mazos que la llevan <span class="muted">(% de los mazos del comandante)</span></div>
          <svg class="mini" viewBox="0 0 ${W} ${H}" role="img" aria-label="Porcentaje de mazos que llevan ${esc(card)} por periodos">${frame(0, incMax, v => (v * 100).toFixed(0) + '%')}
            <path d="${path(incPts)} L${X(n - 1)} ${H - B} L${X(0)} ${H - B} Z" fill="var(--accent)" fill-opacity=".16"/><path d="${path(incPts)}" fill="none" stroke="var(--accent)" stroke-width="2.2"/>
            ${S.map((b, i) => `<circle cx="${X(i)}" cy="${Yi(b.inclusion)}" r="3.2" fill="var(--accent)"><title>Hasta ${lab(b)}: ${pct(b.inclusion)} (${b.withDecks} de ${b.decks} mazos)</title></circle>`).join('')}</svg>
          <div>${pct(S[0].inclusion, 0)} → <b>${pct(S[n - 1].inclusion, 0)}</b></div></div>
      </div>
      <div class="note" style="margin-top:8px">${diff == null ? '' : `En los 6 meses, la diferencia entre llevarla y no llevarla es de <b class="${sepOk ? (diff > 0 ? 'pos-t' : 'neg-t') : 'muted'}">${pp(diff)}</b>${sepOk ? '' : ' y no se distingue de la casualidad (los intervalos se solapan)'}. `}<b>Es una correlación, no un efecto de la carta</b>: refleja sobre todo quién la juega y con qué plan, y si su winrate sube o baja en el tiempo no prueba que la carta mejore o empeore el mazo. Cada punto es un periodo de ${t.bucketDays} días; no depende del periodo elegido arriba.</div></div>`;
    $('#ce-close').onclick = () => { box.innerHTML = ''; };
  } catch (e) { box.innerHTML = `<div class="panel muted" style="margin-top:12px">No se pudo cargar: ${esc(e.message)}</div>`; }
}
export async function loadTrend(name) {
  const box = $('#trend');
  try {
    const t = await api(`/api/trend?name=${encodeURIComponent(name)}`, { days: 0 });
    const S = t.series;
    if (S.length < 2) { box.textContent = 'Hace falta más de un periodo de datos.'; return; }
    const W = 720, H = 330, L = 44, R = 12, n = S.length;
    const X = i => L + i / (n - 1) * (W - L - R);
    const wr = S.filter(b => b.winRate != null);
    const metas = S.map(b => b.meta).filter(v => v != null);
    const lo = Math.min(...metas, ...wr.map(b => b.ci[0])) - .02, hi = Math.max(...metas, ...wr.map(b => b.ci[1])) + .02;
    const Y = v => 14 + (1 - (v - lo) / (hi - lo)) * 170;
    const share = Math.max(0.01, ...S.map(b => b.metaShare)), bar = v => v / share * 44;
    const lab = b => new Date(b.end * 1000).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    const pts = S.map((b, i) => b.winRate == null ? null : [X(i), Y(b.winRate)]).filter(Boolean);
    const line = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
    const withCi = S.map((b, i) => b.ci && [X(i), Y(b.ci[1]), Y(b.ci[0])]).filter(Boolean);
    const band = withCi.length > 1
      ? 'M' + withCi.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L') + ' L' + [...withCi].reverse().map(q => q[0].toFixed(1) + ' ' + q[2].toFixed(1)).join(' L') + ' Z' : '';
    const yt = []; for (let v = Math.ceil(lo * 20) / 20; v <= hi; v += .05) yt.push(v);
    const row = (c, sign) => `<tr><td>${cn(c.card)}</td><td class="n muted">${pct(c.prior, 0)}</td><td class="n">${pct(c.recent, 0)}</td><td class="n ${sign}">${pp(c.diff)}</td></tr>`;
    const tb = (rows, sign) => rows.length
      ? `<table><thead><tr><th>Carta</th><th class="n">Antes</th><th class="n">Último periodo</th><th class="n">Cambio</th></tr></thead><tbody>${rows.map(c => row(c, sign)).join('')}</tbody></table>`
      : '<div class="muted">Sin cambios claros.</div>';
    box.innerHTML = `
      <svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución del winrate y de la presencia en el meta">
        ${yt.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" /><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${(v * 100).toFixed(0)} %</text>`).join('')}
 
        ${metas.length > 1 ? `<path d="${S.map((b, i) => b.meta == null ? '' : (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(b.meta).toFixed(1)).join(' ').replace(/^L/, 'M')}" fill="none" stroke="var(--ink)" stroke-opacity=".55" stroke-width="2" stroke-dasharray="5 4"><title>Media del meta en cada periodo</title></path>` : ''}
        ${band ? `<path d="${band}" fill="var(--accent)" fill-opacity=".18"/>` : ''}
        <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
        ${S.map((b, i) => b.winRate == null ? '' : `<circle cx="${X(i)}" cy="${Y(b.winRate)}" r="4" fill="var(--accent)"><title>Hasta ${lab(b)}: winrate ${pct(b.winRate)} (${b.decks} mazos, ${b.games} partidas)</title></circle>`).join('')}
        <text x="${W - R}" y="10" text-anchor="end">Winrate (línea discontinua = media del meta en cada periodo; zona = IC 95 %)</text>
        ${S.map((b, i) => `<rect x="${X(i) - 12}" y="${284 - bar(b.metaShare)}" width="24" height="${bar(b.metaShare)}" rx="3" fill="var(--accent)" fill-opacity=".5"><title>Presencia en el meta: ${pct(b.metaShare)} (${b.decks} mazos)</title></rect>
          <text x="${X(i)}" y="${280 - bar(b.metaShare)}" text-anchor="middle">${pct(b.metaShare, 1)}</text>
          <text x="${X(i)}" y="304" text-anchor="middle">${lab(b)}</text>`).join('')}
        <text x="${L}" y="212">Presencia en el meta (% de todos los mazos) ↓</text>
        <text x="${(L + W - R) / 2}" y="322" text-anchor="middle">cada punto es un periodo de ${t.bucketDays} días, etiquetado con su fecha final</text>
      </svg>
      ${t.rising.length || t.falling.length ? `<div class="cols" style="margin-top:12px">
        <div><h2>Cartas en ascenso</h2>${tb(t.rising, 'pos-t')}</div>
        <div><h2>Cartas en descenso</h2>${tb(t.falling, 'neg-t')}</div></div>` : ''}
      <div class="note">Los periodos recientes tienen menos partidas, por eso su zona sombreada es más ancha: no leas una subida pequeña como tendencia. Las cartas en ascenso comparan el último periodo (${t.recentDecks} mazos) con todo lo anterior (${t.priorDecks}). Esta vista ignora el selector de periodo y usa todo el histórico.</div>`;
  } catch (e) { box.textContent = e.message; }
}

// Variantes: mazos agrupados automáticamente por las cartas que los diferencian.
// Núcleo y huecos de decisión de una variante (solo uso, no resultados)
function coreHtml(d) {
  if (!d) return '';
  const chip = c => `<span class="chip" data-card="${esc(c.card)}">${esc(short(c.card, 26))} <small>${pct(c.p, 0)}</small></span>`;
  return `<details class="coredet"><summary><b>Núcleo y huecos de decisión</b> <span class="muted">· ${d.core.length} cartas fijas, ≈${d.openSlots} plazas abiertas</span></summary>
    <div class="note" style="margin-top:6px">De las ≈${Math.round(d.avgCards)} cartas de cada mazo (sin tierras básicas), <b>${d.core.length}</b> las lleva casi todo el mundo (80 % o más). Quedan <b>≈${d.openSlots} plazas abiertas</b> que se reparten entre <b>${d.flexCount}</b> cartas candidatas (20-80 %) y ${d.techCount} de uso minoritario.</div>
    <h4>Huecos de decisión <small class="muted">(las que más se reparten, primero)</small></h4>
    <div class="chips">${d.flex.slice(0, 40).map(chip).join('')}</div>
    <h4>Núcleo <button class="ghost" data-copy-core="${esc(d.core.map(c => c.card).join('\n'))}" title="Copia las cartas del núcleo como lista">Copiar núcleo</button></h4>
    <div class="chips">${d.core.map(chip).join('')}</div>
    ${d.tech.length ? `<h4>Tech minoritario <small class="muted">(5-20 %)</small></h4><div class="chips">${d.tech.slice(0, 20).map(chip).join('')}</div>` : ''}
  </details>`;
}

export async function loadVariants(name, k) {
  const box = $('#variants');
  box.textContent = 'Calculando…';
  try {
    const v = await api(`/api/variants?name=${encodeURIComponent(name)}&k=${k}&detail=1`);
    if (v.tooFew || !v.variants.length) { box.textContent = 'Hacen falta al menos 40 mazos con este comandante (en el periodo y filtro actuales) para separar variantes.'; return; }
    box.innerHTML = `<div class="variants">${v.variants.map((x, i) => `
      <div class="variant">
        <h3>Variante ${i + 1}: ${esc(short(x.signature.slice(0, 2).map(c => c.card).join(' + ') || 'sin rasgos claros', 44))}</h3>
        <div class="muted">${x.decks} mazos (${pct(x.share, 0)} del total) · empates ${pct(x.drawRate)}</div>
        <div class="wr" style="margin-top:8px"><b>${pct(x.winRate)}</b>${track(x.winRate - v.baseline, .10, !sig(x.ci, v.baseline))}</div>
        <div class="muted" style="font-size:12px">IC 95 %: ${pct(x.ci[0])}–${pct(x.ci[1])} · ${pp(x.winRate - v.winRate)} frente a la media del comandante</div>
        ${coreHtml(x.detail)}
        <div class="chips">${x.signature.map(c => `<span class="chip" data-card="${esc(c.card)}" title="Juegan la carta ${pct(c.inVariant, 0)} de esta variante frente a ${pct(c.inRest, 0)} del resto">${esc(short(c.card, 26))} <small>${pct(c.inVariant, 0)} vs ${pct(c.inRest, 0)}</small></span>`).join('')}</div>
      </div>`).join('')}</div>
      <div class="note">Los mazos se agrupan solos según qué cartas comparten (${v.features} cartas que no juega todo el mundo). Las etiquetas muestran las cartas más características de cada grupo, con el % de mazos del grupo que la juegan frente al resto. Cambia el número de grupos para afinar. Un grupo con menos winrate no es necesariamente peor construido: también puede reunir a jugadores con menos experiencia.</div>`;
    box.querySelectorAll('[data-copy-core]').forEach(b => { b.onclick = e => { e.preventDefault(); copyText(b.dataset.copyCore.split('\n').map(c => '1 ' + c).join('\n'), b); }; });
  } catch (e) { box.textContent = e.message; }
}

// Paquetes: cartas que se juegan juntas y cartas que casi nunca coinciden, dentro de este comandante.
// Es solo uso (qué llevan los jugadores), sin mirar resultados: el winrate de pares no se sostenía.
export async function loadPackages(name) {
  const box = $('#syn');
  try {
    const r = await api(`/api/packages?name=${encodeURIComponent(name)}`);
    if (r.tooFew) { box.textContent = 'Hacen falta al menos 100 mazos con este comandante (en el periodo y filtro actuales) para detectar paquetes.'; return; }
    const together = x => `<tr><td>${cn(x.a, short(x.a, 26))} <span class="muted">→</span> ${cn(x.b, short(x.b, 26))}</td>
      <td class="n">${pct(x.withA, 0)}</td><td class="n muted">${pct(x.withoutA, 0)}</td><td class="n">${x.decks}</td></tr>`;
    const alt = x => `<tr><td>${cn(x.a, short(x.a, 26))} <span class="muted">↔</span> ${cn(x.b, short(x.b, 26))}</td>
      <td class="n">${x.decks}</td><td class="n muted">${Math.round(x.pA * x.pB * r.decks)}</td><td class="n">${pct(x.pA, 0)} / ${pct(x.pB, 0)}</td></tr>`;
    box.innerHTML = `<div class="cols wide">
      <div><h2>Suelen ir juntas</h2>${r.together.length
        ? `<table><thead><tr><th>Si llevas… → suele llevar</th><th class="n" title="% de los mazos con la primera carta que llevan también la segunda">Con la 1ª</th><th class="n" title="% de los mazos sin la primera carta que llevan la segunda">Sin la 1ª</th><th class="n">Mazos</th></tr></thead><tbody>${r.together.map(together).join('')}</tbody></table>`
        : '<div class="muted">Ningún paquete claro con el periodo y filtro actuales.</div>'}</div>
      <div><h2>Casi nunca van juntas</h2>${r.alternatives.length
        ? `<table><thead><tr><th>Pareja</th><th class="n">Mazos con ambas</th><th class="n" title="Mazos con ambas que habría si fueran independientes">Esperable</th><th class="n" title="% de mazos que llevan cada una">Uso</th></tr></thead><tbody>${r.alternatives.map(alt).join('')}</tbody></table>`
        : '<div class="muted">Ninguna pareja se excluye con claridad.</div>'}</div></div>
      <div class="note">Se mira solo qué cartas llevan los mazos de este comandante (${r.decks}), sin resultados. <b>Suelen ir juntas</b>: combos y paquetes de un plan (si llevas la primera, es mucho más probable que lleves la segunda). <b>Casi nunca van juntas</b>: son alternativas entre sí o pertenecen a planes distintos (mira las variantes). Es una descripción de lo que se juega, no una prueba de que funcionen mejor.</div>`;
  } catch (e) { box.textContent = e.message; }
}

// Comparar dos comandantes lado a lado.
export async function openCompare(a, b) {
  ui.view = { t: 'cmp', a, b }; writeHash();
  $('#app').innerHTML = '<div class="muted">Calculando…</div>';
  const [ra, rb, mu] = await Promise.all([
    api(`/api/commander?name=${encodeURIComponent(a)}`), api(`/api/commander?name=${encodeURIComponent(b)}`),
    api(`/api/matchups?name=${encodeURIComponent(a)}`).catch(() => ({ rows: [] }))]);
  const h2h = mu.rows.find(x => x.opponent === b);
  const col = r => {
    const cards = (l, sign) => l.filter(c => c.q < 0.25).slice(0, 8)
      .map(c => `<tr><td>${cn(c.card)}</td><td class="n">${pct(c.inclusion, 0)}</td><td class="n ${sign}">${pp(c.adj)}</td></tr>`).join('') || '<tr><td class="muted">Sin datos fiables</td></tr>';
    return `<div class="panel">
      <h2>${cn(r.commander)}</h2>
      <div class="wr"><b>${pct(r.winRate)}</b>${track(r.winRate - r.baseline, .10, !sig(r.ci, r.baseline))}</div>
      <div class="muted" style="margin:6px 0 10px">IC 95 %: ${pct(r.ci[0])}–${pct(r.ci[1])} · ${pp(r.winRate - r.baseline)} frente a la media del meta</div>
      <table><tbody><tr><td>Mazos</td><td class="n">${r.decks}</td></tr><tr><td>Torneos</td><td class="n">${r.tournaments}</td></tr>
        <tr><td>Partidas</td><td class="n">${r.games}</td></tr><tr><td>Empates</td><td class="n">${pct(r.drawRate)}</td></tr></tbody></table>
      <h2 style="margin-top:14px">Cartas que más ayudan</h2>
      <table><thead><tr><th>Carta</th><th class="n">En mazos</th><th class="n">Ajustada</th></tr></thead><tbody>${cards(r.best, 'pos-t')}</tbody></table>
      <h2 style="margin-top:14px">Cartas que más lastran</h2>
      <table><thead><tr><th>Carta</th><th class="n">En mazos</th><th class="n">Ajustada</th></tr></thead><tbody>${cards(r.worst, 'neg-t')}</tbody></table>
    </div>`;
  };
  $('#app').innerHTML = `
    <button class="back" id="back">← Volver a ${esc(short(a, 40))}</button>
    <h2 style="font-size:20px">Comparación</h2>
    <div class="panel">
      <h2>Cara a cara</h2>
      ${h2h ? `<div><b>${esc(short(a, 40))}</b> gana el <b>${pct(h2h.winRate)}</b> de las veces cuando <b>${esc(short(b, 40))}</b> está en su mesa (${h2h.pods} mesas), frente al ${pct(h2h.winRateWithout)} sin él: <span class="${h2h.lift >= 0 ? 'pos-t' : 'neg-t'}">${pp(h2h.lift)}</span>.</div>
      <div class="note">Mide solo mesas donde coinciden los dos. Recuerda el sesgo de composición de mesa (ver «Rendimiento contra el meta»).</div>`
        : '<div class="muted">No hay mesas suficientes donde coincidan ambos con el periodo y filtro actuales.</div>'}
    </div>
    <div class="cols">${col(ra)}${col(rb)}</div>`;
  $('#back').onclick = () => { ui.view = { t: 'cmd', name: a, minWith: 5 }; openCommander(a); };
  window.scrollTo(0, 0);
}

export async function loadMatchups(name) {
  const box = $('#mu');
  try {
    const r = await api(`/api/matchups?name=${encodeURIComponent(name)}`);
    if (!r.rows.length) { box.innerHTML = '<span class="muted">Muestra insuficiente con el filtro actual (se piden al menos 15 mesas con y sin cada rival).</span>'; return; }
    const maxMu = Math.max(0.02, ...r.rows.map(x => Math.abs(x.lift)));
    box.innerHTML = `
      <div class="muted" style="margin-bottom:8px">Haz clic en un rival para ver qué cartas rinden mejor contra él.</div>
      <table><thead><tr><th>Rival en la mesa</th><th class="n">Mesas</th><th class="n">Winrate con él</th><th class="n">Sin él</th><th class="n">Diferencia</th><th style="width:110px"></th><th class="n" title="z: cuántas veces mayor es la diferencia que lo que cabría por azar. Cerca de 0 = no se distingue del azar; por encima de 2 o por debajo de −2 es llamativo (solo entonces se colorea). Positivo = mejor con ese rival; negativo = peor.">z</th></tr></thead>
      <tbody>${r.rows.map(x => `
        <tr class="click" data-o="${esc(x.opponent)}"><td>${cn(x.opponent)}</td><td class="n">${x.pods}</td>
        <td class="n">${pct(x.winRate)}</td><td class="n muted">${pct(x.winRateWithout)}</td>
        <td class="n ${x.lift >= 0 ? 'pos-t' : 'neg-t'}">${pp(x.lift)}</td><td>${track(x.lift, maxMu)}</td><td class="n muted">${x.z.toFixed(1)}</td></tr>`).join('')}</tbody></table>
      <div class="note">Cada fila compara el winrate de este comandante en mesas donde está ese rival con las mesas donde no está. Hay un sesgo inevitable: también cambia <b>quién más</b> se sienta en la mesa, así que una diferencia pequeña puede deberse a eso y no al rival. Las mesas de un mismo torneo no son independientes: tomar z como orientativo.</div>`;
    box.querySelector('tbody').onclick = e => { const tr = e.target.closest('tr'); if (tr) loadCardsVs(name, tr.dataset.o); };
  } catch (e) { box.innerHTML = `<span class="muted">${esc(e.message)}</span>`; }
}

async function loadCardsVs(name, opp) {
  const box = $('#cv');
  box.innerHTML = '<div class="panel muted">Calculando…</div>';
  try {
    const r = await api(`/api/cards-vs?name=${encodeURIComponent(name)}&vs=${encodeURIComponent(opp)}`);
    const head = '<thead><tr><th>Carta</th><th class="n">Winrate con ella</th><th class="n">Dif. contra este rival</th><th class="n">Dif. general</th><th class="n">Exceso</th><th style="width:80px"></th><th class="n" title="z: cuántas veces mayor es la diferencia que lo que cabría por azar. Cerca de 0 = no se distingue del azar; por encima de 2 o por debajo de −2 es llamativo (solo entonces se colorea). Positivo = mejor con ese rival; negativo = peor.">z</th></tr></thead>';
    const empty = '<tr><td class="muted">Sin datos suficientes</td></tr>';
    const maxEx = Math.max(0.02, ...[...r.best, ...r.worst].map(c => Math.abs(c.excess || 0)));
    const row = c => `<tr><td>${cn(c.card)}</td><td class="n">${pct(c.winRateWith)}</td>
      <td class="n ${c.lift >= 0 ? 'pos-t' : 'neg-t'}">${pp(c.lift)}</td>
      <td class="n muted">${c.generalLift == null ? '—' : pp(c.generalLift)}</td>
      <td class="n ${c.excess == null ? 'muted' : c.excess >= 0 ? 'pos-t' : 'neg-t'}">${c.excess == null ? '—' : pp(c.excess)}</td>
      <td>${c.excess == null ? '' : track(c.excess, maxEx)}</td>
      <td class="n muted">${c.z.toFixed(1)}</td></tr>`;
    box.innerHTML = `<div class="panel">
      <h2>${esc(short(name, 40))} contra ${esc(short(opp, 40))}</h2>
      <div class="muted" style="margin-bottom:12px">${r.pods} mesas con ese rival · winrate ${r.winRate == null ? '—' : pct(r.winRate)}</div>
      <div class="cols wide">
        <div><h2>Mejor rendimiento</h2><table>${head}<tbody>${r.best.slice(0, 20).map(row).join('') || empty}</tbody></table></div>
        <div><h2>Peor rendimiento</h2><table>${head}<tbody>${r.worst.slice(0, 20).map(row).join('') || empty}</tbody></table></div>
      </div>
      <div class="note"><b>Dif. contra este rival</b>: winrate de las mesas con la carta menos las mesas sin ella, solo en mesas donde está el rival.
      <b>Dif. general</b>: lo mismo en todas las mesas. <b>Exceso</b> = la primera menos la segunda: separa las cartas buenas contra este rival de las que son buenas siempre.
      Se piden al menos 15 mesas con y sin la carta; con filtros de tamaño estrechos habrá pocas cartas. Es correlación, no causalidad.</div></div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { box.innerHTML = `<div class="panel muted">${esc(e.message)}</div>`; }
}

// Validación: cuántas conclusiones se mantienen en datos que el cálculo no ha visto.
export async function loadValidation() {
  const box = $('#validation');
  try {
    const v = await api('/api/validation', { days: 0 });
    const label = { alta: '● alta', media: '◐ media', baja: '○ baja' };
    const cls = { alta: 'hi', media: 'mid', baja: 'lo' };
    box.innerHTML = `
      <div style="margin-bottom:10px">Se calculan las cartas con los primeros <b>${v.trainDays} días</b> de datos y se comprueba si su efecto (a favor o en contra del winrate) se repite en los <b>${v.testDays} días siguientes</b>, que el cálculo no ha visto. Si el resultado fuera puro azar, se repetiría el <b>50 %</b> de las veces.</div>
      <table><thead><tr><th>Fiabilidad indicada</th><th class="n">Cartas evaluadas</th><th class="n">Se repite en el periodo siguiente</th><th style="width:140px"></th></tr></thead>
      <tbody>${v.rows.map(r => `<tr><td><span class="rel ${cls[r.level]}">${label[r.level]}</span></td><td class="n">${r.cards}</td>
        <td class="n">${r.rate == null ? '—' : pct(r.rate, 0)}</td>
        <td>${r.rate == null ? '' : `<div title="La marca central es el 50 % (azar)">${track(r.rate - 0.5, 0.5)}</div>`}</td></tr>`).join('')}</tbody></table>
      <div class="note">Resultado sobre ${v.cards} cartas de ${v.commanders} comandantes con muestra suficiente: en conjunto, el efecto se repite el <b>${pct(v.overall, 0)}</b> de las veces. Una carta con fiabilidad «alta» debería repetirse bastante más que una «baja»; si no fuera así, no te fíes de esa etiqueta. Es una comprobación de que el método es estable en el tiempo, no una prueba de que la carta cause el resultado.</div>`;
  } catch (e) { box.textContent = e.message; }
}

export async function loadMatrix() {
  const box = $('#matrix');
  try {
    const m = await api('/api/matrix?top=12');
    const ks = m.commanders;
    if (ks.length < 2) { box.textContent = 'Sin datos suficientes con el filtro actual.'; return; }
    const head = ks.map(k => `<th class="n" title="${esc(k)}">${esc(short(k, 14))}</th>`).join('');
    const rows = ks.map(a => {
      const o = m.overall[a], base = o.seats ? o.wins / o.seats : 0;
      const cells = ks.map(b => {
        if (a === b) return '<td class="n muted">·</td>';
        const c = m.cells[a][b];
        if (!c || c.pods < 30) return '<td class="n muted" title="menos de 30 mesas">—</td>';
        const wr = c.wins / c.pods, d = wr - base;
        const alpha = Math.min(55, Math.abs(d) / 0.08 * 55).toFixed(0);
        return `<td class="n" style="background:color-mix(in srgb, var(${d >= 0 ? '--good' : '--bad'}) ${alpha}%, transparent)" title="${esc(a)} contra ${esc(b)}: ${c.pods} mesas, ${pct(wr)} (${pp(d)} frente a su media)">${(wr * 100).toFixed(0)}%</td>`;
      }).join('');
      return `<tr><td>${esc(short(a, 28))}</td>${cells}</tr>`;
    }).join('');
    box.innerHTML = `<div style="overflow-x:auto"><table class="mx"><thead><tr><th>Comandante ↓ · rival →</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  } catch (e) { box.textContent = e.message; }
}
