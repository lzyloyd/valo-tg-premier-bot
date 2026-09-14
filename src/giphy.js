import { config } from './config.js';

const API_BASE = 'https://api.giphy.com/v1/gifs/random';

/** Returns a direct .gif URL for a random gif matching `tag`, or null if Giphy has nothing. */
export async function fetchRandomGifUrl(tag) {
  const url = `${API_BASE}?api_key=${config.giphyApiKey}&tag=${encodeURIComponent(tag)}&rating=pg-13`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Giphy API returned ${res.status}`);
  const json = await res.json();
  return json.data?.images?.original?.url ?? null;
}
