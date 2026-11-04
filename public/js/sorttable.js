import { $ } from './core.js';

// ---- Ordenar tablas pulsando su cabecera (vale para todas, también las que se generan después) ----
// Valor ordenable de una celda: número si lo es («23.6%», «+5.1 pts»), nivel si es una fiabilidad, texto si no.
// Las celdas vacías o «—» van siempre al final.
function cellKey(td) {
  const rl = td.querySelector('.rel');
  if (rl) return rl.classList.contains('hi') ? 3 : rl.classList.contains('mid') ? 2 : 1;
  const t = td.textContent.replace(/\s+/g, ' ').trim();
  if (!t || t === '—' || t === '·') return null;
  const n = t.replace(/\s*(%|pts)$/, '');
  return /^[+-]?\d+(\.\d+)?$/.test(n) ? parseFloat(n) : t.toLowerCase();
}
export function sortTable(table) {
  const col = table.dataset.sc, tb = table.tBodies[0];
  if (col == null || !tb) return;
  const dir = table.dataset.sd === 'asc' ? 1 : -1;
  const rows = [...tb.rows].filter(r => r.cells.length > Number(col)) // se ignoran filas de aviso («Sin datos…»)
    .map((r, i) => ({ r, i, k: cellKey(r.cells[col]) }));
  rows.sort((a, b) => {
    if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1;
    const c = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : String(a.k).localeCompare(String(b.k), 'es');
    return c ? c * dir : a.i - b.i;
  });
  rows.forEach(x => tb.appendChild(x.r));
}
document.addEventListener('click', e => {
  const th = e.target.closest('thead th');
  const table = th && th.closest('table');
  if (!table || table.classList.contains('mx') || !th.textContent.trim() || !table.tBodies[0]) return;
  const col = th.cellIndex;
  if (table.dataset.sc === String(col)) table.dataset.sd = table.dataset.sd === 'asc' ? 'desc' : 'asc';
  else {
    table.dataset.sc = col;
    const first = [...table.tBodies[0].rows].map(r => r.cells[col] && cellKey(r.cells[col])).find(k => k !== null && k !== undefined);
    table.dataset.sd = typeof first === 'number' ? 'desc' : 'asc'; // números: de mayor a menor; texto: A-Z
  }
  table.querySelectorAll('thead th').forEach(h => delete h.dataset.dir);
  th.dataset.dir = table.dataset.sd;
  sortTable(table);
});
