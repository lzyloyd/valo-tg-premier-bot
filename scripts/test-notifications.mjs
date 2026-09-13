import { resetWeekAndAnnounce, sendDeadlineReminder, sendAutoSummary } from '../src/scheduleNotifications.js';
import { computeWeekSessions } from '../src/scheduleModel.js';
import { loadCurrentWeek } from '../src/scheduleStore.js';

// Fires one of the schedule notifications on demand, without waiting for its
// actual Sunday/Monday trigger time — same functions the real scheduler in
// src/scheduler.js calls. "sessions" is read-only: it doesn't send anything,
// just previews which lineups the current week's data resolves to.
const actions = {
  reset: resetWeekAndAnnounce, // wipes the current week's data — see README warning
  reminder: sendDeadlineReminder,
  summary: sendAutoSummary,
  async sessions() {
    const week = await loadCurrentWeek();
    const sessions = computeWeekSessions(week);
    if (sessions.length === 0) {
      console.log('No sessions resolve from this week\'s current data.');
      return;
    }
    for (const s of sessions) {
      console.log(`${s.dayLabel} ${s.slot} (starts ${s.startsAt.toISOString()}): ${s.lineup.join(', ')}`);
    }
  },
};

const which = process.argv[2];
if (!actions[which]) {
  console.error(`usage: node scripts/test-notifications.mjs <${Object.keys(actions).join('|')}>`);
  process.exit(1);
}

console.log(`Running "${which}"...`);
await actions[which]();
console.log('Done.');
