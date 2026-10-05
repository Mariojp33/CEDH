'use strict';
// Torneos sintéticos con la misma forma que devuelve POST /v2/tournaments (standings + rounds).
// Incluye efectos plantados (de cartas, de matchups y de cartas condicionadas a un rival)
// para poder comprobar que el motor estadístico los recupera.

function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINNAN = 'Kinnan, Bonder Prodigy';
const NAJEELA = 'Najeela, the Blade-Blossom';
const TT = 'Thrasios, Triton Hero / Tymna the Weaver';
const RG = 'Rograkh, Son of Rohgahh / Thrasios, Triton Hero';
const RAL = 'Ral, Monsoon Mage';

const COMMANDERS = [
  { name: KINNAN, weight: 30 }, { name: TT, weight: 24 }, { name: RG, weight: 14 },
  { name: NAJEELA, weight: 10 }, { name: RAL, weight: 8 },
];

const STAPLES = ['Sol Ring', 'Mana Crypt', 'Mana Vault', 'Chrome Mox', 'Mox Diamond', 'Lotus Petal',
  'Jeweled Lotus', 'Ancient Tomb', 'Force of Will', 'Fierce Guardianship', 'Deflecting Swat',
  'Swan Song', 'Mental Misstep', 'Mystical Tutor', 'Vampiric Tutor', 'Demonic Tutor',
  'Imperial Seal', 'Gamble', 'Flusterstorm', 'Pact of Negation', 'Cyclonic Rift', 'Rhystic Study',
  'Mystic Remora', 'Ad Nauseam', 'Underworld Breach'];
const FILLER = Array.from({ length: 70 }, (_, i) => `Carta de relleno ${i + 1}`);

// Efectos "reales" (sobre log-odds de ganar la mesa) que los tests deben recuperar.
const EFFECTS = {
  [KINNAN]: {
    "Thassa's Oracle": 0.6, 'Demonic Consultation': 0.45, 'Basalt Monolith': 0.5,
    'Carta de relleno 1': -0.5, 'Carta de relleno 2': -0.4,
  },
};
// El comandante A rinde MATCHUPS[A][B] más (log-odds) cuando B está en la mesa.
const MATCHUPS = {
  [NAJEELA]: { [KINNAN]: 0.5 }, [KINNAN]: { [NAJEELA]: -0.5 },
  [TT]: { [RAL]: 0.3 }, [RAL]: { [TT]: -0.3 },
};
// Cartas que solo ayudan a A cuando B está en la mesa (si no, no hacen nada).
const CONDITIONAL = { [KINNAN]: { [NAJEELA]: { 'Cyclonic Rift': 0.8 } } };
const EXTRA_POOL = Object.keys(EFFECTS[KINNAN]).filter(c => !c.startsWith('Carta'));

function pickCommander(rand) {
  let r = rand() * COMMANDERS.reduce((s, c) => s + c.weight, 0);
  for (const c of COMMANDERS) { if ((r -= c.weight) < 0) return c.name; }
  return COMMANDERS[0].name;
}

function makePlayer(i, p, rand) {
  const cmd = pickCommander(rand);
  const cards = new Map();
  for (const s of STAPLES) if (rand() < 0.75) cards.set(s, 1);
  for (const f of FILLER) if (rand() < 0.2) cards.set(f, 1);
  for (const e of EXTRA_POOL) if (rand() < 0.4) cards.set(e, 1);
  const eff = EFFECTS[cmd] || {};
  let base = (rand() - 0.5) * 0.6; // habilidad del piloto
  for (const c of cards.keys()) base += eff[c] || 0;
  const commanders = cmd.split(' / ');
  return {
    id: `p${i}-${p}`, name: `Jugador ${i}-${p}`, cmd, cards, base,
    leader: [...commanders].sort().join(' / '),
    decklist: '~~Commanders~~\n' + commanders.map(c => `1 ${c}`).join('\n') +
      '\n\n~~Mainboard~~\n' + [...cards.keys()].map(c => `1 ${c}`).join('\n'),
    wins: 0, draws: 0, losses: 0,
  };
}

function strengthInPod(pl, pod) {
  let s = pl.base;
  for (const o of pod) {
    if (o === pl) continue;
    s += (MATCHUPS[pl.cmd] || {})[o.cmd] || 0;
    const cond = (CONDITIONAL[pl.cmd] || {})[o.cmd];
    if (cond) for (const [card, v] of Object.entries(cond)) if (pl.cards.has(card)) s += v;
  }
  return s;
}

function makeTournament(i, rand, now) {
  const nPlayers = 20 + Math.floor(rand() * 60);
  const swiss = nPlayers > 48 ? 6 : 5;
  const players = Array.from({ length: nPlayers }, (_, p) => makePlayer(i, p, rand));
  const rounds = [];

  for (let r = 1; r <= swiss; r++) {
    const order = [...players].sort(() => rand() - 0.5);
    const tables = [];
    let t = 1, idx = 0;
    for (; idx + 4 <= order.length; idx += 4, t++) {
      const pod = order.slice(idx, idx + 4);
      let winner = null;
      if (rand() < 0.03) {
        pod.forEach(pl => pl.draws++);
      } else {
        const w = pod.map(pl => Math.exp(strengthInPod(pl, pod)));
        let x = rand() * w.reduce((a, b) => a + b, 0);
        winner = pod[0];
        for (let k = 0; k < pod.length; k++) { if ((x -= w[k]) < 0) { winner = pod[k]; break; } }
        pod.forEach(pl => { if (pl === winner) pl.wins++; else pl.losses++; });
      }
      tables.push({
        table: t, players: pod.map(pl => ({ name: pl.name, id: pl.id })),
        winner: winner ? winner.name : null, winner_id: winner ? winner.id : 'Draw', status: 'Completed',
      });
    }
    // Sobrantes: bye
    const byes = order.slice(idx);
    if (byes.length) tables.push({ table: 'Byes', players: byes.map(pl => ({ name: pl.name, id: pl.id })), status: 'Bye' });
    rounds.push({ round: r, tables });
  }

  return {
    TID: `mock-${i}`, tournamentName: `Torneo cEDH de prueba #${i}`,
    swissNum: swiss, startDate: now - Math.floor(rand() * 180 * 86400),
    game: 'Magic: The Gathering', format: 'EDH', topCut: 0,
    standings: players.map(pl => ({
      name: pl.name, id: pl.id, decklist: pl.decklist, leader: pl.leader,
      wins: pl.wins, draws: pl.draws, losses: pl.losses,
    })),
    rounds,
  };
}

function mockTournaments({ count = 60, seed = 42 } = {}) {
  const rand = rng(seed);
  const now = Math.floor(Date.now() / 1000);
  return Array.from({ length: count }, (_, i) => makeTournament(i, rand, now));
}

module.exports = { mockTournaments, EFFECTS, MATCHUPS, CONDITIONAL, KINNAN, NAJEELA, TT, RG, RAL };
