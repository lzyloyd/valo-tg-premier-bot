import { getBrowser, closeBrowser } from '../src/browser.js';
import { gotoTrackerProfile, fetchMatchDetail, fetchTeamStandings } from '../src/trackerClient.js';
import { buildMatchView } from '../src/matchModel.js';
import { renderScoreboardPng } from '../src/render/renderCard.js';
import { sendMatchReport } from '../src/telegram.js';
import { config } from '../src/config.js';

// Sends one specific match through the exact same path the scheduled poller
// uses (sendMatchReport -> TELEGRAM_CHAT_ID / TELEGRAM_MESSAGE_THREAD_ID),
// without touching the poller's seen-matches state.
const matchId = process.argv[2];
if (!matchId) {
  console.error('usage: node scripts/test-report.mjs <matchId>');
  process.exit(1);
}

const browser = await getBrowser();
const page = await browser.newPage();
try {
  await gotoTrackerProfile(page);
  const raw = await fetchMatchDetail(page, matchId);
  const teamsInfo = await fetchTeamStandings(page, raw, config.trackedRiotId);
  const match = buildMatchView(raw, teamsInfo);
  const png = await renderScoreboardPng(browser, match);
  await sendMatchReport(match, png);
  console.log('sent to', config.telegramChatId, config.telegramMessageThreadId);
} finally {
  await page.close();
  await closeBrowser();
}
