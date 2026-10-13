'use strict';
// Una sola petición a TopDeck para ver cómo vienen los standings y las rondas (orden, posiciones, top cut).
// Uso: TOPDECK_API_KEY=... node scripts/inspect-api.js
// No imprime la clave ni listas completas: solo la estructura.
const { request } = require('../lib/topdeck');

(async () => {
  const apiKey = process.env.TOPDECK_API_KEY;
  if (!apiKey) { console.error('Falta TOPDECK_API_KEY'); process.exit(1); }
  const now = Math.floor(Date.now() / 1000);
  const batch = await request('/tournaments', { apiKey, body: {
    game: 'Magic: The Gathering', format: 'EDH', start: now - 3 * 86400, end: now, participantMin: 30,
    columns: ['name', 'id', 'decklist', 'wins', 'draws', 'losses'], rounds: true } });
  console.log('torneos recibidos:', batch.length);
  const t = batch.sort((a, b) => (b.standings || []).length - (a.standings || []).length)[0];
  if (!t) return;
  console.log('claves del torneo:', Object.keys(t).join(', '));
  const st = t.standings || [];
  console.log('jugadores:', st.length, '| claves de un jugador:', Object.keys(st[0] || {}).join(', '));
  console.log('primeros 8 standings (nombre, W-D-L):');
  st.slice(0, 8).forEach((p, i) => console.log(' ', i + 1, '·', p.name, `${p.wins}-${p.draws}-${p.losses}`, p.standing != null ? 'standing=' + p.standing : '', p.rank != null ? 'rank=' + p.rank : ''));
  console.log('últimos 3:', st.slice(-3).map(p => `${p.name} ${p.wins}-${p.draws}-${p.losses}`).join(' | '));
  const monotone = st.every((p, i) => i === 0 || (st[i - 1].wins ?? 0) >= (p.wins ?? 0) - 0);
  console.log('¿ordenados por victorias descendentes?', monotone);
  console.log('rondas:', (t.rounds || []).map(r => `${r.round}${r.tables ? '(' + r.tables.length + ' mesas)' : ''}`).join(', '));
  console.log('claves de una ronda:', Object.keys((t.rounds || [])[0] || {}).join(', '));
  const last = (t.rounds || []).slice(-2);
  last.forEach(r => console.log('mesa de', r.round, '→ claves:', Object.keys((r.tables || [])[0] || {}).join(', ')));
  const url = st.filter(p => /^https?:\/\//i.test(String(p.decklist || '').trim())).length;
  console.log('listas que son enlace:', url, 'de', st.length, '| con deckObj:', st.filter(p => p.deckObj).length);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
