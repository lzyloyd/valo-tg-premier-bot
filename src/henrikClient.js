import { config } from './config.js';

// HenrikDev's unofficial VALORANT API (https://docs.henrikdev.xyz) — the
// match data source since api.tracker.gg started answering the server with a
// Cloudflare challenge. Plain HTTPS + API key, no browser involved. Links
// people paste are still tracker.gg ones; only the match id is taken from them.
const BASE = 'https://api.henrikdev.xyz';
const MAX_ATTEMPTS = 4;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function henrikGet(path, attempt = 1) {
  if (!config.henrikApiKey) throw new Error('HENRIK_API_KEY не задан');
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { headers: { Authorization: config.henrikApiKey, Accept: 'application/json' } });
  } catch (err) {
    if (attempt < MAX_ATTEMPTS) {
      await sleep(attempt * 2000);
      return henrikGet(path, attempt + 1);
    }
    throw new Error(`Henrik API недоступен: ${err.message}`);
  }
  // Rate-limited (or a transient upstream Riot failure): wait as told and retry.
  if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
    const retryAfter = Number(res.headers.get('retry-after') ?? res.headers.get('x-ratelimit-reset'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : attempt * 3000);
    return henrikGet(path, attempt + 1);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = json?.errors?.[0]?.message ?? res.statusText;
    throw new Error(`Henrik API ${res.status} на ${path}: ${message}`);
  }
  return json.data;
}

/** Full match details (Henrik v4 shape: metadata/players/teams/rounds/kills). */
export async function fetchMatch(matchId) {
  try {
    return await henrikGet(`/valorant/v4/match/${config.henrikRegion}/${encodeURIComponent(matchId)}`);
  } catch (err) {
    if (/ 404 /.test(err.message)) throw new Error(`матч ${matchId} не найден в Henrik API`);
    throw err;
  }
}

/**
 * The team's Premier league matches, oldest first, from the roster's own
 * history — one call, independent of which players happened to play.
 */
export async function fetchPremierHistory() {
  const data = await henrikGet(`/valorant/v1/premier/${encodeURIComponent(config.premierRosterId)}/history`);
  return [...(data.league_matches ?? [])]
    .map((m) => ({ id: m.id, startedAt: m.started_at }))
    .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
}

const TIER_CACHE_MS = 30 * 60 * 1000;
const tierCache = new Map(); // puuid -> { tierId, at }

/**
 * A player's current competitive tier id (0 if unranked/unknown). Custom
 * games carry no ranks at all, so the card fills them in from here; cached
 * briefly since one card needs up to 10 of these.
 */
export async function fetchCurrentTier(puuid) {
  const cached = tierCache.get(puuid);
  if (cached && Date.now() - cached.at < TIER_CACHE_MS) return cached.tierId;
  try {
    const data = await henrikGet(`/valorant/v3/by-puuid/mmr/${config.henrikRegion}/pc/${encodeURIComponent(puuid)}`);
    const tierId = data?.current?.tier?.id ?? 0;
    tierCache.set(puuid, { tierId, at: Date.now() });
    return tierId;
  } catch (err) {
    console.error(`[henrik] rank lookup failed for ${puuid}:`, err.message);
    return 0;
  }
}

const teamByPlayerCache = new Map(); // puuid -> { team, at }

/**
 * The Premier team a player is currently on (v2 shape: id, name, tag,
 * customization, current_season, seasons[].placement), or null if they
 * aren't on one. Custom games carry no team info, so this is how a practice
 * card still gets team names; cached like ranks.
 */
export async function fetchPremierTeamByPlayer(puuid) {
  const cached = teamByPlayerCache.get(puuid);
  if (cached && Date.now() - cached.at < TIER_CACHE_MS) return cached.team;
  let team = null;
  try {
    team = await henrikGet(`/valorant/v2/premier/players/${config.henrikRegion}/${encodeURIComponent(puuid)}`);
  } catch (err) {
    if (!/ 404 /.test(err.message)) console.error(`[henrik] premier team lookup failed for player ${puuid}:`, err.message);
  }
  teamByPlayerCache.set(puuid, { team, at: Date.now() });
  return team;
}

/** A Premier roster's current standing (placement + crest), or null if unavailable. */
export async function fetchPremierTeam(rosterId) {
  const path = `/valorant/v1/premier/${encodeURIComponent(rosterId)}`;
  // Pinning our region is faster, but some teams only resolve without it.
  for (const query of [`?affinity=${config.henrikRegion}`, '']) {
    try {
      return await henrikGet(path + query);
    } catch (err) {
      if (!/ 404 /.test(err.message)) {
        console.error(`[henrik] premier team lookup failed for ${rosterId}:`, err.message);
        return null;
      }
    }
  }
  return null;
}
