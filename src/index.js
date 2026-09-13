import { runPollCycle } from './poller.js';
import { scheduleNext } from './scheduler.js';
import { runTelegramListener } from './telegramListener.js';

const once = process.argv.includes('--once');

if (once) {
  await runPollCycle();
  process.exit(0);
} else {
  console.log('[index] tg-results-bot started. Polling tracker.gg only Saturdays at 21:00 and 23:00 MSK.');
  scheduleNext(runPollCycle);
  runTelegramListener().catch((err) => {
    console.error('[index] Telegram listener crashed:', err);
    process.exit(1);
  });
}
