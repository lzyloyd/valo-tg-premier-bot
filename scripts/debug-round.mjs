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
  const first = rounds[0];
  console.log('attributes:', JSON.stringify(first.attributes, null, 2));
  console.log('metadata:', JSON.stringify(first.metadata, null, 2));
  console.log('stats keys:', Object.keys(first.stats));
  console.log('full stats:', JSON.stringify(first.stats, null, 2));
} finally {
  await page.close();
  await closeBrowser();
}
