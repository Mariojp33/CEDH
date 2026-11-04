// Vista móvil: las tablas anchas se enseñan como tarjetas (cada fila, un bloque con «etiqueta: valor»).
// Solo etiqueta las celdas; el CSS (app.css, ≤640 px) decide si se aplica. Las tablas pequeñas y la matriz se quedan como están.
function prepare(table) {
  if (table.classList.contains('mx') || table.querySelector('#rows') || table.id === 'rows') return;
  const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
  if (heads.length < 4) return;
  table.classList.add('mcards');
  table.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (heads[i] && !td.dataset.label) td.dataset.label = heads[i]; }));
}
export function watchTables(root) {
  const run = () => root.querySelectorAll('table').forEach(prepare);
  new MutationObserver(run).observe(root, { childList: true, subtree: true });
  run();
}
