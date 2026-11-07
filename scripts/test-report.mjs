import { getBrowser, closeBrowser } from '../src/browser.js';
import { fetchMatch } from '../src/henrikClient.js';
import { buildMatchView } from '../src/matchModel.js';
import { renderScoreboardPng } from '../src/render/renderCard.js';
import { sendMatchReport } from '../src/telegram.js';
import { config } from '../src/config.js';
import { loadSeenMatchIds, saveSeenMatchIds } from '../src/state.js';

// Sends one specific match through the exact same path the scheduled poller
// uses (sendMatchReport -> TELEGRAM_CHAT_ID / TELEGRAM_MESSAGE_THREAD_ID),
// Add --mark-seen to recover a missed report: skip already-sent matches
// and persist the ID only after Telegram confirms the photo was sent.
const matchId = process.argv[2];
const markSeen = process.argv.includes('--mark-seen');
if (!matchId) {
  console.error('usage: node scripts/test-report.mjs <matchId> [--mark-seen]');
  process.exit(1);
}

const seen = markSeen ? await loadSeenMatchIds() : null;
if (seen?.has(matchId)) {
  console.log('already sent:', matchId);
  process.exit(0);
}

try {
  const match = await buildMatchView(await fetchMatch(matchId), { requireOurTeam: markSeen, withStandings: true, fillRanks: true });
  match.playlistName = 'Premier';
  const png = await renderScoreboardPng(await getBrowser(), match);
  await sendMatchReport(match, png);
  if (seen) {
    seen.add(matchId);
    await saveSeenMatchIds(seen);
  }
  console.log('sent to', config.telegramChatId, config.telegramMessageThreadId);
} finally {
  await closeBrowser();
}
