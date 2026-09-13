import { getBrowser, closeBrowser } from '../src/browser.js';
import { fetchRecentMatches } from '../src/trackerClient.js';
import { loadSeenMatchIds } from '../src/state.js';

// Read-only dry run of the poller's own new-match check — shows exactly what
// the next scheduled poll would post, without sending anything or touching
// the seen-matches state. Safe to run any time, as often as you like.
const browser = await getBrowser();
const page = await browser.newPage();
try {
  const seen = await loadSeenMatchIds();
  const recentMatches = await fetchRecentMatches(page);
  const newMatches = recentMatches.filter((m) => !seen.has(m.id));

  console.log(`${recentMatches.length} matches on profile, ${seen.size} already marked seen.`);
  if (newMatches.length === 0) {
    console.log('Nothing new — next scheduled poll would post 0 matches.');
  } else {
    console.log(`Next scheduled poll would post ${newMatches.length} match(es):`);
    console.log(newMatches.map((m) => `  ${m.id}  ${m.mapName}  ${m.timestamp}`).join('\n'));
  }
} finally {
  await page.close();
  await closeBrowser();
}
