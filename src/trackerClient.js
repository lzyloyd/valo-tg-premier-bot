import { config } from './config.js';

const MATCH_API_BASE = 'https://api.tracker.gg/api/v2/valorant/standard/matches';
const PROFILE_API_BASE = 'https://api.tracker.gg/api/v2/valorant/standard/profile/riot';
const ROSTER_API_BASE = 'https://api.tracker.gg/api/v1/valorant/premier/roster';
const IMAGE_PROXY_BASE = 'https://imgsvc.trackercdn.com/url';

/**
 * Cloudflare's "Just a moment..." interstitial can still be showing by the
 * time page.goto's own waitUntil condition is satisfied — networkidle2 is
 * happy to fire on the challenge page itself. Confirm the real page actually
 * landed by waiting for the state object every genuine tracker.gg page embeds,
 * instead of trusting navigation-lifecycle timing alone.
 */
export async function gotoTrackerProfile(page) {
  await page.goto(config.trackerProfileUrl, { waitUntil: 'networkidle2', timeout: 60_000 });
  await page.waitForFunction(() => window.__INITIAL_STATE__ !== undefined, { timeout: 30_000 });
}

/**
 * tracker.gg embeds its initial React state as `window.__INITIAL_STATE__` in the
 * server-rendered HTML — reading it avoids needing a separate API call (and its
 * own Cloudflare check) just to list recent matches.
 */
export async function fetchRecentMatches(page) {
  await gotoTrackerProfile(page);

  const matches = await page.evaluate(() => {
    const state = window.__INITIAL_STATE__;
    const bucket = state?.stats?.standardProfileMatches?.['0'];
    if (!bucket?.matches) return [];
    return bucket.matches.map((m) => ({
      id: m.attributes.id,
      timestamp: m.metadata.timestamp,
      mapName: m.metadata.mapName,
      result: m.metadata.result,
    }));
  });

  // Oldest first, so if several matches are new they get posted in the right order.
  return matches.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A burst of back-to-back requests occasionally trips a transient Cloudflare
// block on one of them ("Failed to fetch", or a non-200 status) even on an
// already-cleared page — it's usually gone a second or two later.
async function fetchJson(page, url, attempt = 1) {
  const maxAttempts = 3;
  let result;
  try {
    result = await page.evaluate(async (url) => {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return { ok: false, status: res.status };
      return { ok: true, json: await res.json() };
    }, url);
  } catch (err) {
    if (attempt < maxAttempts) {
      await sleep(attempt * 1000);
      return fetchJson(page, url, attempt + 1);
    }
    throw new Error(`fetch failed for ${url} (page was at ${page.url()}): ${err.message}`);
  }

  if (!result.ok) {
    if (attempt < maxAttempts) {
      await sleep(attempt * 1000);
      return fetchJson(page, url, attempt + 1);
    }
    throw new Error(`tracker.gg API returned ${result.status} for ${url}`);
  }
  return result.json;
}

/**
 * Full 10-player scoreboard for one match. Cloudflare blocks this endpoint for
 * anything that isn't a real browser, so it's called via page.evaluate — it
 * rides on the same session/cookies that already got past the challenge.
 */
export async function fetchMatchDetail(page, matchId) {
  const json = await fetchJson(page, `${MATCH_API_BASE}/${matchId}`);
  return json.data;
}

/**
 * A roster's crest PNG is a template with fixed placeholder colors (red /
 * cream / dark-red channels) — the real team colors only show up once the
 * image is re-mapped through tracker.gg's image proxy with the roster's own
 * primary/secondary/tertiary values, the same way tracker.gg's own frontend
 * renders it.
 */
function coloredLogoUrl(icon, size = 128) {
  if (!icon?.imageUrl) return null;
  const triplet = (c) => (c ?? [0, 0, 0, 1]).join(',');
  const rgbMap = `rgb-map(${triplet(icon.primary)};${triplet(icon.secondary)};${triplet(icon.tertiary)})`;
  return `${IMAGE_PROXY_BASE}/size(${size}),${rgbMap}/${encodeURIComponent(icon.imageUrl)}/image.png`;
}

function toTeamInfo(roster) {
  return {
    name: roster.name.split('#')[0].trim(),
    logoUrl: coloredLogoUrl(roster.icon),
    rank: roster.rank ?? null,
    divisionName: roster.divisionName ?? null,
  };
}

async function fetchRosterInfoForPlayer(page, riotId) {
  const profileJson = await fetchJson(page, `${PROFILE_API_BASE}/${encodeURIComponent(riotId)}?`);
  const rosterId = profileJson.data.metadata.premierRosterId;
  if (!rosterId) return null;
  const rosterJson = await fetchJson(page, `${ROSTER_API_BASE}/${rosterId}/summary`);
  return toTeamInfo(rosterJson.data);
}

/**
 * Premier team identity (name, logo, league rank) isn't part of the match
 * payload at all — it lives under a separate Premier roster API, keyed by a
 * roster id that a player's own standard profile happens to carry
 * (metadata.premierRosterId). Any player on a side works to look their
 * roster up, so this doesn't depend on the match being recent — but a given
 * player might not currently have one (subbed in, left their roster since),
 * so try each of the five in turn instead of betting on just one.
 */
export async function fetchTeamStandings(page, raw, trackedRiotId) {
  const playerSummaries = raw.segments.filter((s) => s.type === 'player-summary');
  const tracked = playerSummaries.find(
    (p) => p.attributes.platformUserIdentifier.toLowerCase() === trackedRiotId.toLowerCase(),
  );
  if (!tracked) return { ourTeam: null, theirTeam: null };

  const opponents = playerSummaries.filter((p) => p.metadata.teamId !== tracked.metadata.teamId);

  const ourTeam = await fetchRosterInfoForPlayer(page, trackedRiotId);

  let theirTeam = null;
  for (const opponent of opponents) {
    theirTeam = await fetchRosterInfoForPlayer(page, opponent.attributes.platformUserIdentifier);
    if (theirTeam) break;
  }

  return { ourTeam, theirTeam };
}
