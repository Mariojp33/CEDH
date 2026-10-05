'use strict';
// Cliente mínimo de la API v2 de TopDeck.gg (https://topdeck.gg/docs/tournaments-v2).
// Datos proporcionados por TopDeck.gg — la atribución es obligatoria en cualquier proyecto que use la API.

const BASE = 'https://topdeck.gg/api/v2';
const DAY = 86400;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function request(path, { apiKey, body, method = 'POST', retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + path, {
      method,
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < retries) {
      const j = await res.json().catch(() => ({}));
      const wait = Number(res.headers.get('Retry-After')) || j.retryAfterSeconds || 30;
      await sleep((wait + 1) * 1000);
      continue;
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const err = new Error(`TopDeck ${res.status}: ${j.error || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
}

// Descarga torneos completados en ventanas de `windowDays` para no pedir respuestas gigantes
// (los endpoints masivos tienen límites más bajos que los 100 req/min generales).
async function fetchTournaments({ apiKey, game = 'Magic: The Gathering', format = 'EDH', days = 90,
  participantMin = 16, windowDays = 7, onProgress, onBatch } = {}) {
  if (!apiKey) throw new Error('Falta TOPDECK_API_KEY');
  const now = Math.floor(Date.now() / 1000);
  const out = [];
  const seen = new Set();
  const windows = Math.ceil(days / windowDays);
  for (let i = 0; i < windows; i++) {
    const end = now - i * windowDays * DAY;
    const start = Math.max(now - days * DAY, end - windowDays * DAY);
    const batch = await request('/tournaments', {
      apiKey,
      body: {
        game, format, start, end, participantMin,
        columns: ['name', 'id', 'decklist', 'wins', 'draws', 'losses'],
        // Mesas de cada ronda (jugadores + winner_id) para calcular matchups entre comandantes.
        rounds: true,
      },
    });
    const fresh = batch.filter(t => !seen.has(t.TID) && seen.add(t.TID)); // add() devuelve el Set: truthy
    // Con `onBatch` cada ventana se entrega y se descarta: no se acumulan en memoria las respuestas
    // completas de la API (con todas sus rondas), que son enormes. Sin él se devuelven todas juntas.
    if (onBatch) await onBatch(fresh); else out.push(...fresh);
    if (onProgress) onProgress({ done: i + 1, total: windows, tournaments: seen.size });
  }
  return out;
}

module.exports = { fetchTournaments, request };
