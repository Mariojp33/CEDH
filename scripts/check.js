'use strict';
// Comprobación rápida contra la API real (1 petición, últimos DAYS días, por defecto 3).
//   TOPDECK_API_KEY=... node scripts/check.js
//   node scripts/check.js --mock      (prueba el propio script con datos sintéticos)
// Imprime solo estructura y recuentos: ni la clave ni nombres de jugadores. Se puede pegar tal cual.
const { request } = require('../lib/topdeck');
const { parseDeck } = require('../lib/parse');
const { buildRecords } = require('../lib/stats');
const { mockTournaments } = require('../lib/mock');

const pct = (a, b) => b ? `${a}/${b} (${(100 * a / b).toFixed(0)}%)` : '0/0';
const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const shape = v => v === null ? 'null' : Array.isArray(v) ? `array[${v.length}]` : typeof v === 'object' ? `object{${Object.keys(v).slice(0, 4).join(',')}${Object.keys(v).length > 4 ? ',…' : ''}}` : typeof v;

(async () => {
  const mock = process.argv.includes('--mock');
  const days = Number(process.env.DAYS) || 3;
  let ts;
  if (mock) ts = mockTournaments({ count: 5 });
  else {
    if (!process.env.TOPDECK_API_KEY) { console.error('Falta TOPDECK_API_KEY'); process.exit(1); }
    ts = await request('/tournaments', {
      apiKey: process.env.TOPDECK_API_KEY,
      body: {
        game: 'Magic: The Gathering', format: 'EDH', last: days, participantMin: 16,
        columns: ['name', 'id', 'decklist', 'wins', 'draws', 'losses'], rounds: true,
      },
    });
  }
  console.log(`Torneos devueltos: ${ts.length} (últimos ${days} días${mock ? ', DATOS DEMO' : ''})`);
  if (!ts.length) { console.log('Nada que analizar: prueba con DAYS=14'); return; }

  const standings = ts.flatMap(t => t.standings || []);
  const withDeck = standings.filter(p => parseDeck(p));
  console.log('\n== Clasificaciones ==');
  console.log('jugadores:', standings.length);
  console.log('campos del primer jugador:', Object.keys(standings[0] || {}).join(', '));
  console.log('con lista utilizable:', pct(withDeck.length, standings.length));
  console.log('con leader:', pct(standings.filter(p => p.leader).length, standings.length));
  console.log('con id:', pct(standings.filter(p => p.id != null).length, standings.length));
  console.log('decklist es URL:', pct(standings.filter(p => /^https?:/i.test(String(p.decklist || ''))).length, standings.length));
  const withObj = standings.find(p => p.deckObj);
  if (withObj) {
    const o = withObj.deckObj;
    console.log('deckObj:', shape(o));
    for (const k of Object.keys(o).slice(0, 3)) {
      const first = Array.isArray(o[k]) ? o[k][0] : Object.entries(o[k] || {})[0];
      console.log(`  deckObj.${k} -> ${shape(o[k])}; primer elemento: ${JSON.stringify(first)?.slice(0, 120)}`);
    }
  } else console.log('deckObj: ausente (se usa el texto de decklist)');

  const tables = ts.flatMap(t => (t.rounds || []).flatMap(r => (r.tables || []).map(tb => ({ ...tb, _tid: t.TID }))));
  console.log('\n== Rondas ==');
  console.log('torneos con rondas:', pct(ts.filter(t => (t.rounds || []).length).length, ts.length));
  console.log('mesas:', tables.length);
  console.log('estado:', JSON.stringify(count(tables, t => t.status)));
  console.log('jugadores por mesa:', JSON.stringify(count(tables, t => (t.players || []).length)));
  console.log('winner_id:', JSON.stringify(count(tables, t => t.winner_id == null ? 'null' : t.winner_id === 'Draw' ? 'Draw' : 'id')));
  const ids = new Set(ts.flatMap(t => (t.standings || []).map(p => `${t.TID}:${p.id}`)));
  const seated = tables.flatMap(tb => (tb.players || []).map(p => `${tb._tid}:${p.id}`));
  console.log('jugadores de mesa encontrados en la clasificación:', pct(seated.filter(x => ids.has(x)).length, seated.length));

  const recs = buildRecords(ts);
  const seats = recs.reduce((s, r) => s + r.seats.length, 0);
  console.log('\n== Resultado del procesado ==');
  console.log('mazos válidos:', recs.length, '| asientos (mesas jugadas):', seats);
  console.log('mazos con al menos un asiento:', pct(recs.filter(r => r.seats.length).length, recs.length));
  const cmd = count(recs, r => r.key);
  console.log('comandantes distintos:', Object.keys(cmd).length);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
