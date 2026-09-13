import { runPollCycle } from './poller.js';
import { scheduleNext } from './scheduler.js';
import { runTelegramListener } from './telegramListener.js';
import { closeBrowser } from './browser.js';

const once = process.argv.includes('--once');

if (once) {
  await runPollCycle();
  await closeBrowser();
  process.exit(0);
} else {
  console.log('[index] tg-results-bot started. Polling tracker.gg only Saturdays at 21:00 and 23:00 MSK.');
  scheduleNext(runPollCycle);
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
