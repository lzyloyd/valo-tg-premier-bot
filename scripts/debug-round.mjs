import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getBrowser, closeBrowser } from '../src/browser.js';
import { gotoTrackerProfile, fetchMatchDetail } from '../src/trackerClient.js';
import { config } from '../src/config.js';

// Dumps the full raw match payload to disk so it can be grepped for fields
// tracker.gg's API doesn't document (e.g. which side each team played),
// instead of scrolling through truncated terminal output.
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
  const outPath = path.join(config.dataDir, 'debug-raw-match.json');
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(raw, null, 2));
  console.log(`wrote ${outPath}`);
} finally {
  await page.close();
  await closeBrowser();
}
