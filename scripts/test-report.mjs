import { getBrowser, closeBrowser } from '../src/browser.js';
import { fetchMatch } from '../src/henrikClient.js';
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

try {
  const match = await buildMatchView(await fetchMatch(matchId), { withStandings: true });
  match.playlistName = 'Premier';
  const png = await renderScoreboardPng(await getBrowser(), match);
  await sendMatchReport(match, png);
  console.log('sent to', config.telegramChatId, config.telegramMessageThreadId);
} finally {
  await closeBrowser();
}
