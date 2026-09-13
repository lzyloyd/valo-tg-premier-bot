import { getBrowser, closeBrowser } from '../src/browser.js';
import { gotoTrackerProfile } from '../src/trackerClient.js';
import { config } from '../src/config.js';

// Prints the full Premier roster summary JSON for a Riot ID (defaults to the
// tracked player) — looking for a region field (e.g. "DACH") we haven't
// captured yet in trackerClient.js's toTeamInfo().
const PROFILE_API_BASE = 'https://api.tracker.gg/api/v2/valorant/standard/profile/riot';
const ROSTER_API_BASE = 'https://api.tracker.gg/api/v1/valorant/premier/roster';

const riotId = process.argv[2] || config.trackedRiotId;

const browser = await getBrowser();
const page = await browser.newPage();
try {
  await gotoTrackerProfile(page);
  const profileJson = await page.evaluate(
    async (url) => (await fetch(url, { headers: { Accept: 'application/json' } })).json(),
    `${PROFILE_API_BASE}/${encodeURIComponent(riotId)}?`,
  );
  const rosterId = profileJson.data.metadata.premierRosterId;
  console.log('rosterId:', rosterId);
  if (!rosterId) process.exit(0);
  const rosterJson = await page.evaluate(
    async (url) => (await fetch(url, { headers: { Accept: 'application/json' } })).json(),
    `${ROSTER_API_BASE}/${rosterId}/summary`,
  );
  console.log(JSON.stringify(rosterJson.data, null, 2));
} finally {
  await page.close();
  await closeBrowser();
}
