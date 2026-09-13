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
  const types = [...new Set(raw.segments.map((s) => s.type))];
  console.log('segment types:', types);

  console.log('top-level raw.attributes:', JSON.stringify(raw.attributes, null, 2));
  console.log('top-level raw.metadata keys:', Object.keys(raw.metadata));

  for (const type of types) {
    if (type === 'round-summary') continue;
    const sample = raw.segments.find((s) => s.type === type);
    console.log(`\n--- sample "${type}" ---`);
    console.log('attributes:', JSON.stringify(sample.attributes, null, 2));
    console.log('metadata:', JSON.stringify(sample.metadata, null, 2));
    console.log('stats keys:', Object.keys(sample.stats ?? {}));
  }
} finally {
  await page.close();
  await closeBrowser();
}
