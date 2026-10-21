import { getBrowser, closeBrowser } from '../src/browser.js';
import { openTracker, fetchMatchDetail } from '../src/trackerClient.js';

const matchId = process.argv[2];
if (!matchId) {
  console.error('usage: node scripts/debug-match.mjs <matchId>');
  process.exit(1);
}

const browser = await getBrowser();
const page = await browser.newPage();
try {
  await openTracker(page);
  const raw = await fetchMatchDetail(page, matchId);
  const players = raw.segments
    .filter((s) => s.type === 'player-summary')
    .map((s) => s.attributes.platformUserIdentifier);
  console.log('players in match:', players);
} finally {
  await page.close();
  await closeBrowser();
}
