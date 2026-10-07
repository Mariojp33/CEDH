'use strict';
// Combos y amenazas de un comandante, con la API pública de Commander Spellbook (https://commanderspellbook.com).
//
// Idea: se le pasan TODAS las cartas que el comandante juega con cierta frecuencia (>= 10 % de sus mazos) y Spellbook
// devuelve los combos que caben dentro. Después se cruzan con nuestros mazos para saber cuáles se juegan de verdad y
// se agrupan en "líneas" (por su pieza clave) en vez de listar decenas de combos casi iguales.
// Normas de su API: pocas peticiones, sin clave y con un User-Agent que identifique el servicio.

const DEFAULT_API = 'https://backend.commanderspellbook.com';
const USER_AGENT = 'cedh-stats/1.0 (+https://github.com/Mariojp33/CEDH)';

class ComboApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Las cartas de doble cara llegan como "Frente // Dorso"; TopDeck usa el nombre de la cara frontal.
const front = n => String(n || '').split(' // ')[0].trim();

// Efectos que cuentan como ganar la partida (o dejar a los rivales sin biblioteca/vida)
const TERMINAL = /win the game|exile each opponent|mill each opponent|each opponent (loses|mills|exiles)|opponents? (loses?|mills?)|infinite (damage|life loss|drain)/i;

// ---- Petición a Spellbook -------------------------------------------------------------------------------------

// Lista de cartas a consultar: las que llevan al menos `minShare` de los mazos del comandante, sin tierras básicas
function unionRequest(decks, commanderNames, basics, { minShare = 0.10, maxCards = 400 } = {}) {
  const cnt = new Map();
  for (const d of decks) for (const c of d.cards) cnt.set(c, (cnt.get(c) || 0) + 1);
  const isCmd = new Set(commanderNames.map(n => n.toLowerCase()));
  const cards = [...cnt].filter(([c, n]) => n / decks.length >= minShare && !basics.has(c.toLowerCase()) && !isCmd.has(c.toLowerCase()))
    .sort((a, b) => b[1] - a[1]).slice(0, maxCards).map(([c]) => c);
  return { main: cards.map(card => ({ card, quantity: 1 })), commanders: commanderNames.map(card => ({ card, quantity: 1 })) };
}

async function fetchCombos({ main, commanders, api = DEFAULT_API, timeoutMs = 30000 }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${api}/find-my-combos`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({ main, commanders }),
    });
  } catch (e) {
    throw new ComboApiError(e.name === 'AbortError' ? 'Commander Spellbook tarda demasiado en responder' : 'No se puede conectar con Commander Spellbook', 502);
  } finally { clearTimeout(timer); }
  if (res.status === 429) throw new ComboApiError('Commander Spellbook está limitando las peticiones; prueba de nuevo en un minuto', 503);
  if (!res.ok) throw new ComboApiError(`Commander Spellbook respondió con un error (${res.status})`, 502);
  const j = await res.json().catch(() => null);
  const results = j && (Array.isArray(j.results) ? j.results[0] : j.results);
  if (!results || !Array.isArray(results.included)) throw new ComboApiError('Respuesta inesperada de Commander Spellbook', 502);
  return results;
}

// Se guarda solo lo necesario de cada combo (la respuesta completa pesa varios MB por las imágenes)
function compact(results) {
  return results.included.map(v => ({
    id: v.id,
    url: `https://commanderspellbook.com/combo/${encodeURIComponent(v.id)}`,
    cards: (v.uses || []).map(u => front(u.card && u.card.name)).filter(Boolean),
    effects: (v.produces || []).filter(p => p.feature && p.feature.name).map(p => ({ name: p.feature.name, status: p.feature.status || '' })),
    steps: v.description || '',
    prerequisites: [v.easyPrerequisites, v.notablePrerequisites].filter(Boolean).join('\n'),
    mana: v.manaNeeded || '',
    popularity: typeof v.popularity === 'number' ? v.popularity : null,
  }));
}

// ---- Análisis con nuestros mazos ------------------------------------------------------------------------------

const KIND_ORDER = { win: 0, engine: 1, helper: 2 };
// win: algún efecto gana la partida; engine: efecto autónomo (S) que suele necesitar un remate; helper: pieza auxiliar
function kindOf(combo) {
  if (combo.effects.some(e => TERMINAL.test(e.name))) return 'win';
  if (combo.effects.some(e => e.status === 'S')) return 'engine';
  return 'helper';
}

// combos: lista compacta; decks: mazos del comandante (en el periodo elegido); commanderNames: sus nombres.
function summarize(combos, decks, commanderNames, { minUsage = 0.02, minDecks = 5, maxLines = 12, metaShare = null } = {}) {
  const N = decks.length;
  if (!N) return { decks: 0, lines: [], keyPieces: [], coverage: 0, totalCombos: combos.length, shown: 0 };
  const isCmd = new Set(commanderNames.map(n => n.toLowerCase()));
  const pieces = c => c.cards.filter(x => !isCmd.has(x.toLowerCase()));

  // Uso de cada combo: mazos que llevan todas sus piezas
  const used = [];
  for (const c of combos) {
    const ps = pieces(c);
    const having = [];
    decks.forEach((d, i) => { if (ps.every(x => d.cards.has(x))) having.push(i); });
    if (having.length >= minDecks && having.length / N >= minUsage) used.push({ ...c, pieces: ps, kind: kindOf(c), having, usage: having.length / N });
  }
  // Uso de cada carta dentro del comandante, para elegir la pieza clave (la menos común: es la que define la línea)
  const cardUse = new Map();
  for (const d of decks) for (const c of d.cards) cardUse.set(c, (cardUse.get(c) || 0) + 1);
  const rarity = x => (cardUse.get(x) || 0) / N;
  for (const u of used) u.key = u.pieces.length ? [...u.pieces].sort((a, b) => rarity(a) - rarity(b) || a.localeCompare(b))[0] : commanderNames[0];

  // Líneas: combos con la misma pieza clave
  const by = new Map();
  for (const u of used) (by.get(u.key) || by.set(u.key, []).get(u.key)).push(u);
  const lines = [...by].map(([key, list]) => {
    const decksWith = new Set(); for (const u of list) for (const i of u.having) decksWith.add(i);
    const kind = list.map(u => u.kind).sort((a, b) => KIND_ORDER[a] - KIND_ORDER[b])[0];
    const eff = new Map();
    for (const u of list) for (const e of u.effects) { const o = eff.get(e.name) || { name: e.name, status: e.status, terminal: TERMINAL.test(e.name), n: 0 }; o.n++; eff.set(e.name, o); }
    const effects = [...eff.values()].sort((a, b) => (b.terminal - a.terminal) || ((b.status === 'S') - (a.status === 'S')) || b.n - a.n).slice(0, 8);
    const enab = new Map();
    for (const u of list) for (const x of u.pieces) if (x !== key) enab.set(x, (enab.get(x) || 0) + 1);
    const enablers = [...enab].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([card]) => ({ card, usage: rarity(card) }));
    const best = [...list].sort((a, b) => b.usage - a.usage || (b.popularity ?? 0) - (a.popularity ?? 0)).slice(0, 4)
      .map(u => ({ id: u.id, url: u.url, cards: u.cards, steps: u.steps, prerequisites: u.prerequisites, mana: u.mana, usage: u.usage, effects: u.effects.map(e => e.name) }));
    return { key, kind, usage: decksWith.size / N, combos: list.length, effects, enablers, best };
  }).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.usage - a.usage);

  // Piezas clave: cuántos mazos dependen de cada carta para hacer algún combo de los jugados
  const perPiece = new Map();
  for (const u of used) for (const x of u.pieces) { let s = perPiece.get(x); if (!s) perPiece.set(x, s = new Set()); for (const i of u.having) s.add(i); }
  // Las cartas que juega casi todo el meta (Sol Ring, Mana Vault…) facilitan casi cualquier línea y no son una amenaza concreta
  const generic = card => metaShare ? metaShare(card) >= 0.8 : false;
  const keyPieces = [...perPiece].filter(([card]) => !generic(card)).map(([card, s]) => ({ card, usage: s.size / N, lines: lines.filter(l => l.key === card || l.best.some(b => b.cards.includes(card))).length }))
    .sort((a, b) => b.usage - a.usage).slice(0, 6);

  const anyCombo = new Set(); for (const u of used) for (const i of u.having) anyCombo.add(i);
  return { decks: N, lines: lines.slice(0, maxLines), keyPieces, coverage: anyCombo.size / N, totalCombos: combos.length, shown: used.length };
}

module.exports = { fetchCombos, compact, unionRequest, summarize, kindOf, front, ComboApiError, DEFAULT_API, TERMINAL };
