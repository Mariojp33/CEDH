import { $, copyText, ui } from './core.js';

// ---- Tema claro/oscuro (sigue al sistema hasta que se elige a mano) ----
const docEl = document.documentElement;
const systemDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
const isDark = () => docEl.dataset.theme ? docEl.dataset.theme === 'dark' : systemDark();
function paintTheme() {
  const b = $('#theme'); if (!b) return;
  b.textContent = isDark() ? '☀' : '☾';
  b.title = isDark() ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
}
export function bindTheme() {
  paintTheme();
  $('#theme').onclick = () => {
    const next = isDark() ? 'light' : 'dark';
    docEl.dataset.theme = next;
    try { localStorage.setItem('cedh.theme', next); } catch { /* sin almacenamiento */ }
    paintTheme();
  };
}

// ---- Compartir ----
// Un comandante se comparte como /?c=NOMBRE: el servidor pone ahí título e imagen para las vistas previas (Discord, etc.),
// porque lo que va tras «#» nunca llega al servidor. Al abrirlo, la web lo convierte en su dirección habitual.
export function shareUrl() {
  if (ui.view.t === 'cmd') return `${location.origin}/?c=${encodeURIComponent(ui.view.name)}${location.hash}`;
  return location.href;
}
export function bindShare() {
  $('#shareapp').onclick = async () => {
    const url = shareUrl();
    if (navigator.share) { try { return await navigator.share({ title: document.title, url }); } catch { return; /* cancelado */ } }
    copyText(url, $('#shareapp'));
  };
}
export function adoptShareUrl() {
  const c = new URLSearchParams(location.search).get('c');
  if (!c) return;
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.get('c')) h.set('c', c);
  history.replaceState(null, '', location.pathname + '#' + h);
}

// ---- Instalable (PWA): el service worker deja la web y los últimos datos disponibles sin conexión ----
export function registerWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => { /* sin soporte */ });
}
