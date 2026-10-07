'use strict';
// Cartas a tener en cuenta contra un mazo (o al jugarlo): listas por función de cartas muy habituales en cEDH y cuánto
// las juega cada comandante frente al meta. Las listas son de criterio (no salen de los datos) y están pensadas para
// editarse a mano: basta con añadir o quitar nombres (los mismos que usa TopDeck, en inglés).
// Complementan a los combos de Commander Spellbook: allí solo entran las líneas de combo conocidas; aquí, los remates de
// una sola carta, la interacción que cabe esperar y las cartas que ralentizan el juego.
// (Mana Crypt, Jeweled Lotus y Dockside Extortionist están prohibidas en Commander desde 2024: no figuran.)

const CATEGORIES = [
  { id: 'finishers', label: 'Remates y motores conocidos', hint: 'Cartas con las que se gana la partida o se monta un combo: son las que hay que tener controladas.', cards: [
    "Thassa's Oracle", 'Laboratory Maniac', 'Jace, Wielder of Mysteries', 'Brain Freeze', 'Tendrils of Agony', 'Aetherflux Reservoir',
    'Walking Ballista', 'Craterhoof Behemoth', 'Approach of the Second Sun', 'Expropriate', "Bolas's Citadel", 'Underworld Breach',
    'Ad Nauseam', 'Hullbreaker Horror', 'Tidespout Tyrant', 'Kiki-Jiki, Mirror Breaker', 'Dramatic Reversal', 'Isochron Scepter',
    'Food Chain', 'Aluren', 'Demonic Consultation', 'Tainted Pact', 'Finale of Devastation',
    'Protean Hulk', "Gaea's Cradle", 'Cyclonic Rift',] },
  { id: 'interaction', label: 'Interacción y protección', hint: 'Contrahechizos, respuestas gratuitas y protección del combo: lo que puede parar tu jugada.', cards: [
    'Force of Will', 'Force of Negation', 'Fierce Guardianship', 'Deflecting Swat', 'Pact of Negation', 'Mental Misstep', 'Misdirection', 'Daze',
    'Snuff Out', 'Commandeer', 'Mindbreak Trap', 'Flusterstorm', 'Mana Drain', 'Swan Song', 'Spell Pierce', 'Counterspell', 'Silence',
    'Veil of Summer', "Orim's Chant", 'An Offer You Can\'t Refuse', 'Dispel', 'Snapback', 'Chain of Vapor', 'Cyclonic Rift'] },
  { id: 'tutors', label: 'Tutores', hint: 'Buscan la carta que falta: aumentan la consistencia y la velocidad con que se monta la victoria.', cards: [
    'Demonic Tutor', 'Vampiric Tutor', 'Mystical Tutor', 'Enlightened Tutor', 'Worldly Tutor', 'Imperial Seal', 'Gamble', 'Sylvan Tutor',
    'Diabolic Intent', 'Wishclaw Talisman', 'Intuition', 'Survival of the Fittest', "Green Sun's Zenith", 'Chord of Calling', 'Finale of Devastation',
    'Beseech the Mirror', 'Merchant Scroll', 'Transmute Artifact', 'Grim Tutor', "Eladamri's Call", 'Muddle the Mixture', 'Entomb', 'Gitaxian Probe'] },
  { id: 'mana', label: 'Maná rápido', hint: 'Aceleran el mazo: cuantas más lleva, antes puede ganar.', cards: [
    'Mana Vault', 'Sol Ring', 'Chrome Mox', 'Mox Diamond', 'Mox Opal', 'Mox Amber', 'Lotus Petal',
    "Lion's Eye Diamond", 'Grim Monolith', 'Basalt Monolith', 'Ancient Tomb', 'Dark Ritual', 'Cabal Ritual', "Jeska's Will", 'Simian Spirit Guide',
    'Elvish Spirit Guide', 'Gemstone Caverns', 'Mana Confluence'] },
  { id: 'hate', label: 'Impuestos y cartas de odio', hint: 'Ralentizan o castigan a los rivales: tendrás que jugar alrededor de ellas.', cards: [
    'Rhystic Study', 'Mystic Remora', 'Smothering Tithe', 'Esper Sentinel', 'Opposition Agent', 'Notion Thief', 'Drannith Magistrate', 'Grand Abolisher',
    'Collector Ouphe', 'Null Rod', 'Rule of Law', 'Deafening Silence', 'Hushbringer', 'Aven Mindcensor', 'Spirit of the Labyrinth', 'Narset, Parter of Veils',
    'Stony Silence', 'Torpor Orb', 'Bloodchief Ascension'] },
];

// Tierras no básicas y rocas de maná de color: reflejan los colores del comandante, no su plan, así que no se
// muestran como "lo que define al mazo".
const LANDS = new Set(['Command Tower', 'Reflecting Pool', 'City of Brass', 'Mana Confluence', 'Ancient Tomb', "Gaea's Cradle", 'Cavern of Souls',
  'Urza\'s Saga', 'Otawara, Soaring City', 'Boseiju, Who Endures', 'Takenuma, Abandoned Mire', 'Sink into Stupor', 'Gemstone Caverns', 'Starting Town',
  'Underground Sea', 'Volcanic Island', 'Tropical Island', 'Scrubland', 'Badlands', 'Bayou', 'Tundra', 'Savannah', 'Taiga', 'Plateau',
  'Misty Rainforest', 'Polluted Delta', 'Scalding Tarn', 'Flooded Strand', 'Verdant Catacombs', 'Arid Mesa', 'Marsh Flats', 'Wooded Foothills',
  'Bloodstained Mire', 'Windswept Heath', 'Prismatic Vista', 'Fabled Passage', 'Evolving Wilds', 'Terramorphic Expanse', 'Strip Mine', 'Wasteland',
  'Hallowed Fountain', 'Watery Grave', 'Blood Crypt', 'Stomping Ground', 'Temple Garden', 'Godless Shrine', 'Overgrown Tomb', 'Breeding Pool', 'Sacred Foundry', 'Steam Vents',
  'Yavimaya Coast', 'Sulfur Falls', 'Isolated Chapel', 'Drowned Catacomb', 'Glacial Fortress', 'Rootbound Crag', 'Clifftop Retreat', 'Hinterland Harbor', 'Woodland Cemetery', 'Sunpetal Grove',
  'Rejuvenating Springs', 'Waterlogged Grove', 'Gilded Grove', 'Verdant Catacombs', 'Lotus Field', 'Bountiful Promenade', 'Luxury Suite', 'Sea of Clouds', 'Spire Garden', 'Training Center',
  'Morphic Pool', 'Undergrowth Stadium', 'Rejuvenating Springs', 'Vault of Champions', 'Spectator Seating', 'Hall of the Storm Giants', 'Mystic Sanctuary', 'Shelldock Isle']);
const isLandOrColoredRock = n => LANDS.has(n) || /^Talisman of /.test(n) || /^(Arcane Signet|Fellwar Stone|Mind Stone|Thought Vessel|Wayfarer's Bauble)$/.test(n);

// decks: mazos del comandante en el periodo; shareOf: nombre -> frecuencia de la carta en todo el meta (0 a 1).
function threatProfile(decks, shareOf, { minShare = 0.2, perCategory = 14 } = {}) {
  const N = decks.length;
  if (!N) return { decks: 0, categories: [] };
  const categories = CATEGORIES.map(cat => {
    const uniq = [...new Set(cat.cards)];
    const counts = new Map(uniq.map(c => [c, 0]));
    for (const d of decks) for (const c of uniq) if (d.cards.has(c)) counts.set(c, counts.get(c) + 1);
    const rows = uniq.map(card => ({ card, inclusion: counts.get(card) / N, meta: shareOf(card) }));
    return {
      id: cat.id, label: cat.label, hint: cat.hint,
      avg: rows.reduce((s, r) => s + r.inclusion, 0),                 // cartas de la categoría por mazo, de media
      metaAvg: rows.reduce((s, r) => s + r.meta, 0),
      cards: rows.filter(r => r.inclusion >= minShare).sort((a, b) => b.inclusion - a.inclusion).slice(0, perCategory),
    };
  });
  return { decks: N, categories };
}

// Cartas que definen el mazo: las que lleva mucho más que el meta (no las que juega todo el mundo)
function definingCards(popular, shareOf, { top = 16, minInclusion = 0.5, minGap = 0.2, isBasic = () => false } = {}) {
  return popular.filter(c => !isBasic(c.card) && !isLandOrColoredRock(c.card) && c.inclusion >= minInclusion && c.inclusion - shareOf(c.card) >= minGap)
    .map(c => ({ card: c.card, inclusion: c.inclusion, meta: shareOf(c.card) }))
    .sort((a, b) => (b.inclusion - b.meta) - (a.inclusion - a.meta)).slice(0, top);
}

module.exports = { CATEGORIES, threatProfile, definingCards, isLandOrColoredRock };
