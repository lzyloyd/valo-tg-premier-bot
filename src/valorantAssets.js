// Agent portraits/colors and map art — Henrik's match data only carries ids
// and names, so images come from the public valorant-api.com asset API
// (no key needed), loaded once per process and kept in memory.
const AGENTS_URL = 'https://valorant-api.com/v1/agents?isPlayableCharacter=true';
const MAPS_URL = 'https://valorant-api.com/v1/maps';
const FALLBACK_COLOR = '#2a3442';

let cache = null;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`valorant-api.com ${res.status} on ${url}`);
  return (await res.json()).data;
}

// "ff7b6aff" (RRGGBBAA) -> "#ff7b6a"
function toCssColor(rgba) {
  return typeof rgba === 'string' && rgba.length >= 6 ? `#${rgba.slice(0, 6)}` : FALLBACK_COLOR;
}

async function loadAssets() {
  if (cache) return cache;
  try {
    const [agents, maps] = await Promise.all([getJson(AGENTS_URL), getJson(MAPS_URL)]);
    cache = {
      agents: new Map(agents.map((a) => [a.uuid.toLowerCase(), { imageUrl: a.displayIcon, color: toCssColor(a.backgroundGradientColors?.[0]) }])),
      maps: new Map(maps.map((m) => [m.uuid.toLowerCase(), m.splash ?? m.listViewIcon])),
    };
  } catch (err) {
    // Images are cosmetic — a card without them beats no card. Retry next time.
    console.error('[assets] valorant-api.com unavailable:', err.message);
    return { agents: new Map(), maps: new Map() };
  }
  return cache;
}

export async function agentAsset(agentId) {
  const { agents } = await loadAssets();
  return agents.get(String(agentId).toLowerCase()) ?? { imageUrl: '', color: FALLBACK_COLOR };
}

export async function mapImageUrl(mapId) {
  const { maps } = await loadAssets();
  return maps.get(String(mapId).toLowerCase()) ?? '';
}
