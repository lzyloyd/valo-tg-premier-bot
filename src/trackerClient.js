import { config } from './config.js';

const MATCH_API_BASE = 'https://api.tracker.gg/api/v2/valorant/standard/matches';
const PROFILE_API_BASE = 'https://api.tracker.gg/api/v2/valorant/standard/profile/riot';
const ROSTER_API_BASE = 'https://api.tracker.gg/api/v1/valorant/premier/roster';
const IMAGE_PROXY_BASE = 'https://imgsvc.trackercdn.com/url';

/**
 * tracker.gg embeds its initial React state as `window.__INITIAL_STATE__` in the
 * server-rendered HTML — reading it avoids needing a separate API call (and its
 * own Cloudflare check) just to list recent matches.
 */
export async function fetchRecentMatches(page) {
  await page.goto(config.trackerProfileUrl, { waitUntil: 'networkidle2', timeout: 60_000 });

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

async function fetchJson(page, url) {
  const result = await page.evaluate(async (url) => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, json: await res.json() };
  }, url);

  if (!result.ok) {
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

/**
 * Premier team identity (name, logo, league rank) isn't part of the match
 * payload at all — it lives under a separate Premier roster API, keyed by a
 * roster id that a player's own standard profile happens to carry
 * (metadata.premierRosterId). Our roster's own `recentMatches` list then
 * points at the specific opponent roster for a given matchId.
 */
export async function fetchTeamStandings(page, trackedRiotId, matchId) {
  const profileJson = await fetchJson(page, `${PROFILE_API_BASE}/${encodeURIComponent(trackedRiotId)}?`);
  const ourRosterId = profileJson.data.metadata.premierRosterId;
  if (!ourRosterId) return { ourTeam: null, theirTeam: null };

  const ourRosterJson = await fetchJson(page, `${ROSTER_API_BASE}/${ourRosterId}/summary`);
  const ourTeam = toTeamInfo(ourRosterJson.data);

  const matchEntry = ourRosterJson.data.recentMatches?.find((m) => m.matchId === matchId);
  if (!matchEntry) return { ourTeam, theirTeam: null };

  const theirRosterJson = await fetchJson(page, `${ROSTER_API_BASE}/${matchEntry.opponentRosterId}/summary`);
  const theirTeam = toTeamInfo(theirRosterJson.data);

  return { ourTeam, theirTeam };
}
