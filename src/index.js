import { runPollCycle } from './poller.js';
import { scheduleNext } from './scheduler.js';

const once = process.argv.includes('--once');

if (once) {
  await runPollCycle();
  process.exit(0);
} else {
  console.log('[index] tg-results-bot started. Polling only Saturdays at 21:00 and 23:00 MSK.');
  scheduleNext(runPollCycle);
}
