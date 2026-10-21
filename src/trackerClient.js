import { TEAM_RIOT_IDS, findOurTeamId } from './statsRoster.js';

const TRACKER_HOME_URL = 'https://tracker.gg/valorant';
const MATCH_API_BASE = 'https://api.tracker.gg/api/v2/valorant/standard/matches';
const PROFILE_API_BASE = 'https://api.tracker.gg/api/v2/valorant/standard/profile/riot';
const ROSTER_API_BASE = 'https://api.tracker.gg/api/v1/valorant/premier/roster';
const IMAGE_PROXY_BASE = 'https://imgsvc.trackercdn.com/url';

// A teammate's Premier history includes matches from before they joined (for
// another team) — only matches this recent count as "ours to post", so adding
// someone to the roster never dumps their old matches into the chat.
const RECENT_MATCH_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Lands a page on tracker.gg so later in-page API fetches ride its cleared
 * Cloudflare session. The challenge interstitial can still be showing when
 * networkidle2 fires, so wait for the state object every genuine tracker.gg
 * page embeds instead of trusting navigation timing alone.
 */
export async function openTracker(page) {
  await page.goto(TRACKER_HOME_URL, { waitUntil: 'networkidle2', timeout: 60_000 });
  await page.waitForFunction(() => window.__INITIAL_STATE__ !== undefined, { timeout: 30_000 });
}

/**
 * Recent Premier matches played by anyone on the team, deduplicated across
 * players — no single "tracked" player whose rename or absence would blind
 * the poller. A failing lookup for one player (renamed, private profile) is
 * logged and skipped rather than aborting the whole check.
 */
export async function fetchRecentMatches(page, { now = new Date() } = {}) {
  await openTracker(page);

  const byId = new Map();
  for (const riotId of TEAM_RIOT_IDS) {
    let json;
    try {
      json = await fetchJson(page, `${MATCH_API_BASE}/riot/${encodeURIComponent(riotId)}?type=premier`);
    } catch (err) {
      console.error(`[trackerClient] recent matches lookup failed for ${riotId}:`, err.message);
      continue;
    }
    for (const m of json.data?.matches ?? []) {
      const timestamp = m.metadata.timestamp;
      if (now - new Date(timestamp) > RECENT_MATCH_MAX_AGE_MS) continue;
      byId.set(m.attributes.id, { id: m.attributes.id, timestamp, mapName: m.metadata.mapName, result: m.metadata.result });
    }
  }

  // Oldest first, so if several matches are new they get posted in the right order.
  return [...byId.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
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
    zoneName: roster.zoneName ?? null, // e.g. "DACH" — sub-region within roster.region ("eu")
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
 * so each side's players are tried in turn instead of betting on just one.
 * "Our" side is whichever side any team member played on.
 */
export async function fetchTeamStandings(page, raw) {
  const playerSummaries = raw.segments.filter((s) => s.type === 'player-summary');
  const ourTeamId = findOurTeamId(playerSummaries);
  if (!ourTeamId) return { ourTeam: null, theirTeam: null };

  const ours = playerSummaries.filter((p) => p.metadata.teamId === ourTeamId);
  const opponents = playerSummaries.filter((p) => p.metadata.teamId !== ourTeamId);
  return {
    ourTeam: await firstRosterInfo(page, ours),
    theirTeam: await firstRosterInfo(page, opponents),
  };
}

// fetchRosterInfoForPlayer throws once its own retries are exhausted (a
// transient Cloudflare block on that one request) — that must not abort the
// lookup while there are still other players on that side left to try.
async function firstRosterInfo(page, players) {
  for (const p of players) {
    const riotId = p.attributes.platformUserIdentifier;
    try {
      const info = await fetchRosterInfoForPlayer(page, riotId);
      if (info) return info;
    } catch (err) {
      console.error(`[trackerClient] roster lookup failed for ${riotId}:`, err.message);
    }
  }
  return null;
}
