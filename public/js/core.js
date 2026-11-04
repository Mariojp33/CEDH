export const $ = s => document.querySelector(s);
export const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
export const pp = x => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + ' pts';
export const short = (s, n = 30) => s.length > n ? s.slice(0, n - 1) + '…' : s;

// Filtro global por jugadores del torneo: se añade a todas las llamadas a la API.
export const F = { min: '', max: '', days: 90, dec: 0 }; // dec: 0 = los empates cuentan como no ganadas (por defecto); 1 = salen del cálculo del winrate
// Barra centrada en la referencia (la media del meta): verde a la derecha (mejor), roja a la izquierda (peor), escala ±`range`.
// Con `neutral` (diferencia que no se distingue del azar) sale en gris.
export const track = (d, range, neutral = false) => `<div class="track"><i class="${neutral ? 'neu' : d >= 0 ? 'pos' : 'neg'}" style="width:${Math.min(50, Math.abs(d) / range * 50)}%"></i></div>`;
export const ui = { view: { t: 'list' }, commanders: [] }; // estado compartido (se reasigna: no puede ser un `let` exportado)
export const api = async (p, o = {}) => {
  const u = new URL(p, location.origin);
  if (F.min) u.searchParams.set('minPlayers', F.min);
  if (F.max) u.searchParams.set('maxPlayers', F.max);
  const days = o.days ?? F.days;
  if (days) u.searchParams.set('days', days);
  if (F.dec) u.searchParams.set('dec', 1);
  const r = await fetch(u);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
};

export const MIN_TABLE = 5;   // la tabla de «Mazos» oculta por defecto los comandantes con menos mazos que esto

// ¿El intervalo de confianza queda entero por encima (1) o por debajo (-1) de la referencia, o la incluye (0)?
export const sig = (ci, base) => ci[0] > base ? 1 : ci[1] < base ? -1 : 0;
export const tone = sg => sg > 0 ? 'pos-t' : sg < 0 ? 'neg-t' : 'muted';

// Nombre de carta (o de comandante) que enseña su imagen al pasar el ratón.
export const cn = (name, label = name) => `<span class="cn" data-card="${esc(name)}">${esc(label)}</span>`;


export async function ensureCommanders() { if (!ui.commanders.length) ui.commanders = await api('/api/commanders?min=1'); }

// Fiabilidad según q (proporción esperada de falsos positivos tras corregir por comparaciones múltiples).
export const rel = q => q == null ? '' : q < 0.05 ? '<span class="rel hi" title="q &lt; 5 %: es poco probable que sea casualidad">● alta</span>'
  : q < 0.25 ? '<span class="rel mid" title="q &lt; 25 %: indicio razonable">◐ media</span>'
  : '<span class="rel lo" title="Puede ser casualidad">○ baja</span>';

export const cmdLabel = name => name.includes(' / ') ? name.split(' / ').map(p => p.split(',')[0]).join(' + ') : short(name, 34);
export const cmdBtn = (name, label) => `<button type="button" class="linklike" data-open-cmd="${esc(name)}" data-card="${esc(name)}" title="${esc(name)}">${esc(label ?? cmdLabel(name))}</button>`;
export const cardBtn = name => `<button type="button" class="linklike" data-open-card="${esc(name)}" data-card="${esc(name)}">${esc(name)}</button>`;
export const dayMonth = t => new Date(t).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });


export const drawNote = () => F.dec
  ? `Solo se cuentan las partidas con ganador: las empatadas salen del cálculo (su frecuencia está en «Empates»). Así la referencia ronda el 25 %, lo esperable con 4 jugadores.`
  : `Los empates cuentan como partida no ganada, por eso la media del meta queda por debajo del 25 %.`;


export async function copyText(text, btn) {
  const done = () => { if (btn) { const t = btn.textContent; btn.textContent = '¡Copiado!'; setTimeout(() => btn.textContent = t, 1500); } };
  try { await navigator.clipboard.writeText(text); return done(); } catch { /* sin permiso: alternativa */ }
  const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch { /* nada más que hacer */ }
  ta.remove();
}

// Evolución: winrate (con su intervalo) y presencia en el meta por periodos de 30 días.
// Resumen de los últimos 6 meses en la cabecera de la ficha: presencia en el meta y winrate, periodo a periodo.
