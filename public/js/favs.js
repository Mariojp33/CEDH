// Comandantes favoritos: se guardan solo en este navegador (sin cuentas) y se marcan con una estrella.
const KEY = 'cedh.favs';
let favSet = new Set();
try { favSet = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { favSet = new Set(); }
export const isFav = name => favSet.has(name);
export const favCount = () => favSet.size;
export function toggleFav(name) {
  favSet.has(name) ? favSet.delete(name) : favSet.add(name);
  try { localStorage.setItem(KEY, JSON.stringify([...favSet])); } catch { /* almacenamiento bloqueado: dura hasta cerrar la página */ }
  return favSet.has(name);
}
