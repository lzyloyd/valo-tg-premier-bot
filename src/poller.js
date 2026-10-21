import { getBrowser } from './browser.js';
import { fetchPremierHistory, fetchMatch } from './henrikClient.js';
import { buildMatchView } from './matchModel.js';
import { renderScoreboardPng } from './render/renderCard.js';
import { sendMatchReport } from './telegram.js';
import { loadSeenMatchIds, saveSeenMatchIds } from './state.js';

// Only matches this recent are "new" — guards against posting the team's
// whole season history if state.json is ever lost or reset.
const RECENT_MATCH_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export async function runPollCycle() {
  console.log('[poller] checking for new Premier matches...');
  const seen = await loadSeenMatchIds();
  const recent = (await fetchPremierHistory()).filter((m) => Date.now() - new Date(m.startedAt) <= RECENT_MATCH_MAX_AGE_MS);
  const newMatches = recent.filter((m) => !seen.has(m.id));

  if (newMatches.length === 0) {
    console.log('[poller] nothing new.');
    return;
  }

  for (const { id } of newMatches) {
    console.log(`[poller] new match ${id}, fetching detail...`);
    const match = await buildMatchView(await fetchMatch(id), { requireOurTeam: true, withStandings: true });
    match.playlistName = 'Premier'; // this poller only ever watches Premier matches
    const png = await renderScoreboardPng(await getBrowser(), match);
    await sendMatchReport(match, png);
    seen.add(id);
    await saveSeenMatchIds(seen);
    console.log(`[poller] posted match ${id} (${match.won ? 'win' : 'loss'} ${match.ourScore}:${match.theirScore})`);
  }
}
