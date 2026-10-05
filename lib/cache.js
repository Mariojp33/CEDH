'use strict';
// Formato compacto de la caché en disco (v4) y utilidades para compartir cadenas en memoria.
// Los nombres de carta, comandante, torneo, etc. se repiten miles de veces: se guardan una sola vez en
// un diccionario y los registros apuntan a ellos por índice. Al cargar, cada cadena queda como un único
// objeto compartido por todos los registros (en vez de una copia por mazo).

// Conjunto de cartas de un mazo guardado como lista ordenada de números (4 bytes por carta en vez de
// ~30 de un Set). Ofrece lo mismo que se usa del Set: has(), size e iteración por nombre.
const names = [], idOf = new Map();
const cardId = n => { let i = idOf.get(n); if (i === undefined) { i = names.length; idOf.set(n, i); names.push(n); } return i; };
class CardSet {
  constructor(ids) { this.ids = ids; }
  static from(iterable) { return new CardSet(Int32Array.from(new Set([...iterable].map(cardId))).sort()); }
  get size() { return this.ids.length; }
  has(name) {
    const id = idOf.get(name);
    if (id === undefined) return false;
    let lo = 0, hi = this.ids.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1, v = this.ids[m]; if (v === id) return true; if (v < id) lo = m + 1; else hi = m - 1; }
    return false;
  }
  [Symbol.iterator]() {
    const ids = this.ids; let i = 0;
    return { next: () => i < ids.length ? { value: names[ids[i++]], done: false } : { value: undefined, done: true } };
  }
}

// v3 (formato anterior): registros con cadenas repetidas. Se sigue pudiendo leer.
const V3 = 3, V4 = 4;

function encode(records) {
  const dict = [], ids = new Map();
  const id = s => { let i = ids.get(s); if (i === undefined) { i = dict.length; ids.set(s, i); dict.push(s); } return i; };
  const out = records.map(r => ({
    key: id(r.key), tid: id(r.tid), tournament: id(r.tournament ?? ''),
    date: r.date, size: r.size, player: r.player,
    games: r.games, wins: r.wins, draws: r.draws, losses: r.losses,
    cards: [...r.cards].map(id),
    seats: (r.seats || []).map(s => [s.w, s.n, s.o.map(id)]),
  }));
  return { dict, records: out };
}

// Conjunto único de cadenas compartidas por todos los registros (cargados o descargados después).
const pool = new Map();
const I = s => { if (typeof s !== 'string') return s; const p = pool.get(s); if (p !== undefined) return p; pool.set(s, s); return s; };

function decode(j) {
  const dict = j.dict.map(I), records = j.records;
  const cid = new Array(dict.length); // id del diccionario -> id de carta, calculado solo para las que son cartas
  const card = i => cid[i] ?? (cid[i] = cardId(dict[i]));
  return records.map(r => ({
    key: dict[r.key], tid: dict[r.tid], tournament: dict[r.tournament],
    date: r.date, size: r.size, player: r.player,
    games: r.games, wins: r.wins, draws: r.draws, losses: r.losses,
    cards: new CardSet(Int32Array.from(r.cards, card).sort()),
    seats: r.seats.map(([w, n, o]) => ({ w, n, o: o.map(i => dict[i]) })),
  }));
}

// Lee la caché en cualquiera de las dos versiones. Devuelve null si la versión no se reconoce.
function decodeAny(j) {
  if (j.version === V4) return decode(j);
  if (j.version === V3) return interned(j.records);
  return null;
}

// Hace que las cadenas iguales sean el mismo objeto (para datos recién descargados o de formato v3).
function interned(records) {
  for (const r of records) {
    r.key = I(r.key); r.tid = I(r.tid); r.tournament = I(r.tournament);
    if (!(r.cards instanceof CardSet)) r.cards = CardSet.from(r.cards);
    for (const s of r.seats || []) s.o = s.o.map(I);
  }
  return records;
}

module.exports = { CardSet, encode, decode, decodeAny, interned, VERSION: V4 };
