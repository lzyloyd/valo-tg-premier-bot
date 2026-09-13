import { getBrowser, closeBrowser } from '../src/browser.js';
import { gotoTrackerProfile, fetchMatchDetail } from '../src/trackerClient.js';

// Dumps the raw round-summary segments for a match, so we can see what
// fields tracker.gg actually gives us (e.g. which side each team played).
const matchId = process.argv[2];
if (!matchId) {
  console.error('usage: node scripts/debug-round.mjs <matchId>');
  process.exit(1);
}

const browser = await getBrowser();
const page = await browser.newPage();
try {
  await gotoTrackerProfile(page);
  const raw = await fetchMatchDetail(page, matchId);
  const rounds = raw.segments.filter((s) => s.type === 'round-summary');
  console.log(JSON.stringify(rounds.slice(0, 3), null, 2));
} finally {
  await page.close();
  await closeBrowser();
}
