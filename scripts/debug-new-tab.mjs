import { appendMatchToStatsSheet } from '../src/sheetsStats.js';

// Synthetic test of the "brand new tab" path (duplicateSheet + clearValues)
// without needing a real match on an unused map — just to eyeball the
// resulting tab's formatting (color contrast etc.) after cloning.
const players = [
  { riotId: 'Space#mench', trs: 500, acs: 200, kills: 15, deaths: 12, assists: 5, plusMinus: 3, kdRatio: 1.25, ddelta: 10, adr: 140, hsAccuracy: 30, kast: 70, firstKills: 2, firstDeaths: 1, multiKills: 1 },
  { riotId: 'ANTiYou#9265', trs: 480, acs: 190, kills: 14, deaths: 13, assists: 6, plusMinus: 1, kdRatio: 1.08, ddelta: 5, adr: 135, hsAccuracy: 28, kast: 68, firstKills: 1, firstDeaths: 2, multiKills: 0 },
];

const mode = process.argv[2] || 'Premier';
const mapName = process.argv[3] || 'TestMap';
const result = await appendMatchToStatsSheet({ mapName, mode, players });
console.log(result);
