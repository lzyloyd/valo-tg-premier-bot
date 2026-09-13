import { resetWeekAndAnnounce, sendDeadlineReminder, sendAutoSummary } from '../src/scheduleNotifications.js';

// Fires one of the three schedule notifications on demand, without waiting
// for its actual Sunday/Monday trigger time — same functions the real
// scheduler in src/scheduler.js calls.
const actions = {
  reset: resetWeekAndAnnounce, // wipes the current week's data — see README warning
  reminder: sendDeadlineReminder,
  summary: sendAutoSummary,
};

const which = process.argv[2];
if (!actions[which]) {
  console.error(`usage: node scripts/test-notifications.mjs <${Object.keys(actions).join('|')}>`);
  process.exit(1);
}

console.log(`Running "${which}"...`);
await actions[which]();
console.log('Done — check the "Сборы" topic.');
