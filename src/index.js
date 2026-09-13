import { runPollCycle } from './poller.js';
import { scheduleNext, scheduleWeeklyReset, scheduleDeadlineReminder, scheduleAutoSummary } from './scheduler.js';
import { runTelegramListener } from './telegramListener.js';
import { closeBrowser } from './browser.js';
import { startMiniAppServer } from './miniappServer.js';
import { resetWeekAndAnnounce, sendDeadlineReminder, sendAutoSummary } from './scheduleNotifications.js';
import { config } from './config.js';

const once = process.argv.includes('--once');

if (once) {
  await runPollCycle();
  await closeBrowser();
  process.exit(0);
} else {
  console.log('[index] tg-results-bot started. Polling tracker.gg only Saturdays at 21:00 and 23:00 MSK.');
  scheduleNext(runPollCycle);
  if (config.scheduleChatId && config.scheduleThreadId) {
    scheduleWeeklyReset(resetWeekAndAnnounce);
    scheduleDeadlineReminder(sendDeadlineReminder);
    scheduleAutoSummary(sendAutoSummary);
  }
  startMiniAppServer();
  runTelegramListener().catch((err) => {
    console.error('[index] Telegram listener crashed:', err);
    process.exit(1);
  });

  // Close Chromium cleanly on shutdown — otherwise systemd killing the whole
  // process tree can leave the profile directory's lock file behind for the
  // next start to trip over.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      console.log(`[index] received ${signal}, shutting down...`);
      await closeBrowser();
      process.exit(0);
    });
  }
}
