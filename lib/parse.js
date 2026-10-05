'use strict';
// Normaliza una lista de TopDeck.gg (texto "~~Commanders~~ ... ~~Mainboard~~ ..." y/o deckObj)
// a { commanders: [nombre], cards: Map(nombre -> copias) }.

const SECTION_RE = /^~~\s*(.+?)\s*~~$/;
const LINE_RE = /^(\d+)\s*x?\s+(.+?)\s*$/i;

// Quita el sufijo de set "(CMR) 123", "[SLD]", "*F*", etc. y normaliza caras dobles a la frontal.
function cleanName(raw) {
  // Los marcadores de acabado (*F* foil, *E* etched) van al final, detrás del set: se quitan primero.
  let n = String(raw)
    .replace(/\s*\*[A-Za-z]+\*\s*$/, '')
    .replace(/\s+\([A-Za-z0-9]{2,6}\)\s*[\w★-]*\s*$/, '')
    .replace(/\s+\[[^\]]*\]\s*$/, '')
    .trim();
  if (n.includes(' // ')) n = n.split(' // ')[0].trim();
  return n;
}

function parseText(text) {
  const out = { commanders: [], cards: new Map() };
  let section = 'mainboard';
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const s = t.match(SECTION_RE);
    if (s) { section = s[1].toLowerCase(); continue; }
    const m = t.match(LINE_RE) || [null, '1', t];
    const count = parseInt(m[1], 10) || 1;
    const name = cleanName(m[2]);
    if (!name) continue;
    if (section.startsWith('commander')) out.commanders.push(name);
    else if (section.startsWith('main')) out.cards.set(name, (out.cards.get(name) || 0) + count);
    // companion / sideboard / maybeboard se ignoran
  }
  return out;
}

// La documentación solo muestra { Commanders: {}, Mainboard: {} } sin detallar el contenido,
// así que se aceptan varias formas: {nombre: n}, {nombre: {count|quantity|qty}}, o arrays.
function entriesOf(section) {
  if (!section) return [];
  if (Array.isArray(section)) {
    return section.map(e => typeof e === 'string' ? [e, 1] : [e.name, e.count ?? e.quantity ?? e.qty ?? 1]);
  }
  return Object.entries(section).map(([k, v]) => {
    if (typeof v === 'number') return [k, v];
    if (v && typeof v === 'object') return [v.name || k, v.count ?? v.quantity ?? v.qty ?? 1];
    return [k, 1];
  });
}

function parseDeckObj(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const get = k => obj[Object.keys(obj).find(x => x.toLowerCase() === k)];
  const cmd = entriesOf(get('commanders'));
  const main = entriesOf(get('mainboard'));
  if (!cmd.length && !main.length) return null;
  const out = { commanders: cmd.map(([n]) => cleanName(n)), cards: new Map() };
  for (const [n, c] of main) {
    const name = cleanName(n);
    out.cards.set(name, (out.cards.get(name) || 0) + (Number(c) || 1));
  }
  return out;
}

// Prioridad: deckObj (estructurado) -> texto. Devuelve null si no hay lista utilizable.
function parseDeck(player) {
  let d = parseDeckObj(player.deckObj);
  if (!d && typeof player.decklist === 'string' && !/^https?:\/\//i.test(player.decklist.trim())) {
    d = parseText(player.decklist);
  }
  if (!d) return null;
  // Si la lista no trae sección de comandantes, usa el campo `leader` ("A / B").
  if (!d.commanders.length && player.leader) d.commanders = player.leader.split(' / ').map(s => s.trim());
  if (!d.cards.size) return null;
  return d;
}

// Clave canónica del comandante: igual que `leader` de la API (orden alfabético, "A / B").
function commanderKey(player, deck) {
  if (player.leader) return player.leader;
  if (deck && deck.commanders.length) return [...deck.commanders].sort().join(' / ');
  return null;
}

module.exports = { parseText, parseDeckObj, parseDeck, commanderKey, cleanName };
