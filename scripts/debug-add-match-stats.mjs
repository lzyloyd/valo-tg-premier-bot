import { fetchMatch } from '../src/henrikClient.js';
import { buildMatchView } from '../src/matchModel.js';
import { appendMatchToStatsSheet } from '../src/sheetsStats.js';

// Exercises the "добавь в таблицу статистики" write path directly against
// STATS_SPREADSHEET_ID — this WRITES to the sheet.
const matchId = process.argv[2];
const mode = process.argv[3] || 'Premier';
if (!matchId) {
  console.error('usage: node scripts/debug-add-match-stats.mjs <matchId> [Premier|Праки]');
  process.exit(1);
}

const match = await buildMatchView(await fetchMatch(matchId), { requireOurTeam: true });
console.log('mapName:', match.mapName, '| ourTeam:', match.ourTeam.map((p) => p.riotId));
console.log(await appendMatchToStatsSheet({ mapName: match.mapName, mode, players: match.ourTeam, matchId, matchDate: match.dateStarted }));
