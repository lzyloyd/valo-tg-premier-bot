import { getBrowser, closeBrowser } from '../src/browser.js';
import { gotoTrackerProfile, fetchMatchDetail } from '../src/trackerClient.js';
import { buildMatchView } from '../src/matchModel.js';
import { appendMatchToStatsSheet } from '../src/sheetsStats.js';
import { config } from '../src/config.js';

// Exercises the "добавь в таблицу статистики" write path directly against
// STATS_SPREADSHEET_ID (point this at the test copy while iterating).
const matchId = process.argv[2];
const mode = process.argv[3] || 'Premier';
if (!matchId) {
  console.error('usage: node scripts/debug-add-match-stats.mjs <matchId> [Premier|Праки]');
  process.exit(1);
}

const browser = await getBrowser();
const page = await browser.newPage();
try {
  await gotoTrackerProfile(page);
  const raw = await fetchMatchDetail(page, matchId);
  const match = buildMatchView(raw, {}, {
    trackedRiotId: config.trackedRiotId,
    requireTracked: false,
    ourRosterRiotIds: config.teamRosterRiotIds,
  });
  console.log('mapName:', match.mapName, '| ourTeam:', match.ourTeam.map((p) => p.riotId));
  const result = await appendMatchToStatsSheet({ mapName: match.mapName, mode, players: match.ourTeam });
  console.log(result);
} finally {
  await page.close();
  await closeBrowser();
}
