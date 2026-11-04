import { $, api } from './core.js';

// ---- Imagen de la carta al pasar el ratón (Scryfall) ----
// La imagen la carga el navegador directamente desde Scryfall; el servidor no interviene.
// Los comandantes con pareja («A / B») muestran las dos cartas.
const pop = document.createElement('div');
pop.id = 'cardpop'; pop.hidden = true; document.body.appendChild(pop);
const scry = (n, mode = 'exact') => `https://api.scryfall.com/cards/named?${mode}=${encodeURIComponent(n)}&format=image&version=normal`;
let popTimer = null, popFor = null, mouse = { x: 0, y: 0 };
function placePop() {
  const w = pop.offsetWidth, h = pop.offsetHeight, m = 16;
  let x = mouse.x + m, y = mouse.y + m;
  if (x + w > innerWidth - 8) x = Math.max(8, mouse.x - w - m);          // sin sitio a la derecha: a la izquierda
  if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8);      // sin sitio abajo: se sube
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
}
// Imagen de una carta (Scryfall) con reintento aproximado para caras dobles o divididas; si no existe, un aviso.
export function cardImage(n) {
  const img = new Image();
  img.alt = n; img.loading = 'lazy'; img.src = scry(n);
  img.onerror = () => {
    if (!img.dataset.retry) { img.dataset.retry = 1; img.src = scry(n, 'fuzzy'); return; }
    const d = document.createElement('div'); d.className = 'miss'; d.textContent = 'Imagen no disponible'; img.replaceWith(d);
  };
  return img;
}
function showPop(name) {
  pop.replaceChildren(...name.split(' / ').slice(0, 2).map(n => {
    const img = new Image();
    img.alt = n; img.src = scry(n);
    img.onerror = () => {
      if (!img.dataset.retry) { img.dataset.retry = 1; img.src = scry(n, 'fuzzy'); return; } // caras dobles o divididas
      const d = document.createElement('div'); d.className = 'miss'; d.textContent = 'Imagen no disponible: ' + n;
      img.replaceWith(d); placePop();
    };
    return img;
  }));
  pop.hidden = false; placePop();
}
function hidePop() { clearTimeout(popTimer); popFor = null; pop.hidden = true; pop.replaceChildren(); }
document.addEventListener('mouseover', e => {
  const el = e.target.closest && e.target.closest('[data-card]');
  if (el === popFor) return;
  hidePop();
  if (!el) return;
  popFor = el;
  popTimer = setTimeout(() => showPop(el.dataset.card), 180); // pequeña espera: no se piden imágenes al cruzar la tabla
});
document.addEventListener('mousemove', e => { mouse = { x: e.clientX, y: e.clientY }; if (!pop.hidden) placePop(); });
document.addEventListener('scroll', hidePop, true);
