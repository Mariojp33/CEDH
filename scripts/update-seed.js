'use strict';
// Renueva seed/records.json con los días nuevos de TopDeck.   TOPDECK_API_KEY=... node scripts/update-seed.js
const path = require('node:path');
const { updateSeed } = require('../lib/seedupdate');

const apiKey = process.env.TOPDECK_API_KEY;
if (!apiKey) { console.error('Falta la variable TOPDECK_API_KEY'); process.exit(1); }
updateSeed({
  file: path.join(__dirname, '..', 'seed', 'records.json'),
  apiKey,
  maxDays: Number(process.env.DAYS) || 180,
  windowDays: Number(process.env.WINDOW_DAYS) || 3,
  participantMin: Number(process.env.PARTICIPANT_MIN) || 16,
}).catch(e => { console.error('Error:', e.message); process.exit(1); });
