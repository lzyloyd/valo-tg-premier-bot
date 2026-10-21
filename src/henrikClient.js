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
    if (res.status === 404) throw new Error(`матч не найден в Henrik API (${message})`);
    throw new Error(`Henrik API ${res.status} на ${path}: ${message}`);
  }
  return json.data;
}

/** Full match details (Henrik v4 shape: metadata/players/teams/rounds/kills). */
export function fetchMatch(matchId) {
  return henrikGet(`/valorant/v4/match/${config.henrikRegion}/${encodeURIComponent(matchId)}`);
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

/** A Premier roster's current standing (placement + crest), or null if unavailable. */
export async function fetchPremierTeam(rosterId) {
  try {
    return await henrikGet(`/valorant/v1/premier/${encodeURIComponent(rosterId)}?affinity=${config.henrikRegion}`);
  } catch (err) {
    console.error(`[henrik] premier team lookup failed for ${rosterId}:`, err.message);
    return null;
  }
}
