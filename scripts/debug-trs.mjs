import { getBrowser, closeBrowser } from '../src/browser.js';
import { gotoTrackerProfile, fetchMatchDetail } from '../src/trackerClient.js';

// Prints the full trnPerformanceScore stat object for every player in a
// match, to check whether tracker.gg's API already tags a rating grade
// (1k/a/b/c/d) rather than us having to guess TRS thresholds ourselves.
const matchId = process.argv[2];
if (!matchId) {
  console.error('usage: node scripts/debug-trs.mjs <matchId>');
  process.exit(1);
}

const browser = await getBrowser();
const page = await browser.newPage();
try {
  await gotoTrackerProfile(page);
  const raw = await fetchMatchDetail(page, matchId);
  const players = raw.segments.filter((s) => s.type === 'player-summary');
  for (const p of players) {
    console.log(
      p.attributes.platformUserIdentifier,
      JSON.stringify(p.stats.trnPerformanceScore),
    );
  }
} finally {
  await page.close();
  await closeBrowser();
}
