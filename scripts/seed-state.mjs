import { getBrowser, closeBrowser } from '../src/browser.js';
import { fetchRecentMatches } from '../src/trackerClient.js';
import { saveSeenMatchIds } from '../src/state.js';

// Marks every match currently on the tracked profile's recent-matches list as
// already-posted, so the next scheduled poll only reacts to genuinely new
// matches instead of dumping the whole backlog into the chat at once.
const browser = await getBrowser();
const page = await browser.newPage();
try {
  const matches = await fetchRecentMatches(page);
  console.log(matches.map((m) => `${m.id}  ${m.mapName}  ${m.timestamp}`).join('\n'));
  await saveSeenMatchIds(new Set(matches.map((m) => m.id)));
  console.log(`Seeded ${matches.length} match ids as already-seen.`);
} finally {
  await page.close();
  await closeBrowser();
}
