import { getBrowser, closeBrowser } from '../src/browser.js';
import { gotoTrackerProfile, fetchMatchDetail } from '../src/trackerClient.js';

// Prints raw.metadata and raw.attributes in full — looking for whichever
// field actually names the playlist/mode (Premier, Competitive, Unrated...).
const matchId = process.argv[2];
if (!matchId) {
  console.error('usage: node scripts/debug-playlist.mjs <matchId>');
  process.exit(1);
}

const browser = await getBrowser();
const page = await browser.newPage();
try {
  await gotoTrackerProfile(page);
  const raw = await fetchMatchDetail(page, matchId);
  console.log('attributes:', JSON.stringify(raw.attributes, null, 2));
  console.log('metadata:', JSON.stringify(raw.metadata, null, 2));
} finally {
  await page.close();
  await closeBrowser();
}
