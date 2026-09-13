import { getBrowser } from './browser.js';
import { fetchRecentMatches, fetchMatchDetail, fetchTeamStandings } from './trackerClient.js';
import { buildMatchView } from './matchModel.js';
import { renderScoreboardPng } from './render/renderCard.js';
import { sendMatchReport } from './telegram.js';
import { loadSeenMatchIds, saveSeenMatchIds } from './state.js';
import { config } from './config.js';

export async function runPollCycle() {
  console.log('[poller] checking for new Premier matches...');
  const seen = await loadSeenMatchIds();
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    const recentMatches = await fetchRecentMatches(page);
    const newMatches = recentMatches.filter((m) => !seen.has(m.id));

    if (newMatches.length === 0) {
      console.log('[poller] nothing new.');
      return;
    }

    for (const { id } of newMatches) {
      console.log(`[poller] new match ${id}, fetching detail...`);
      const raw = await fetchMatchDetail(page, id);
      const teamsInfo = await fetchTeamStandings(page, config.trackedRiotId, id);
      const match = buildMatchView(raw, teamsInfo);
      const png = await renderScoreboardPng(browser, match);
      await sendMatchReport(match, png);
      seen.add(id);
      await saveSeenMatchIds(seen);
      console.log(`[poller] posted match ${id} (${match.won ? 'win' : 'loss'} ${match.ourScore}:${match.theirScore})`);
    }
  } finally {
    // Leave the shared browser running — the command listener can reuse it,
    // and closing it here would yank it out from under an in-flight command.
    await page.close();
  }
}
