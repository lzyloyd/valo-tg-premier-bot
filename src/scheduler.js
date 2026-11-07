import { nextResetInstant, nextReminderInstant, nextDeadlineInstant } from './scheduleModel.js';

// Check Premier results twice: Saturday 22:00 and 24:00 Moscow time.
// Both checks are still on Saturday in UTC (19:00 and 21:00).
// Moscow has used a fixed UTC+3 offset (no DST) since 2014, so working in UTC
// directly is safe and avoids a timezone-database dependency.
const TRIGGER_UTC_HOURS = [19, 21]; // MSK Saturday 22:00 and Sunday 00:00

function saturdayMidnightUtc(from, weeksAhead) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const daysUntilSaturday = (6 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + daysUntilSaturday + weeksAhead * 7);
  return d;
}

export function nextTriggerAt(now = new Date()) {
  const candidates = [0, 1].flatMap((weeksAhead) =>
    TRIGGER_UTC_HOURS.map((hour) => {
      const t = saturdayMidnightUtc(now, weeksAhead);
      t.setUTCHours(hour, 0, 0, 0);
      return t;
    }),
  );
  return candidates.filter((t) => t > now).sort((a, b) => a - b)[0];
}

export function scheduleNext(runTrigger) {
  const at = nextTriggerAt();
  const delayMs = at.getTime() - Date.now();
  console.log(`[scheduler] next poll at ${at.toISOString()} (in ${Math.round(delayMs / 60000)} min)`);
  setTimeout(async () => {
    try {
      await runTrigger();
    } catch (err) {
      console.error('[scheduler] run failed:', err);
    } finally {
      scheduleNext(runTrigger);
    }
  }, delayMs);
}

// Shared plumbing for a recurring trigger whose next instant is computed
// fresh each time (rather than a fixed interval) — used for both the
// schedule mini app's weekly reset and its deadline reminder.
function scheduleRecurring(label, nextInstant, runTrigger) {
  const delayMs = nextInstant().getTime() - Date.now();
  console.log(`[scheduler] next ${label} in ${Math.round(delayMs / 60000)} min`);
  setTimeout(async () => {
    try {
      await runTrigger();
    } catch (err) {
      console.error(`[scheduler] ${label} failed:`, err);
    } finally {
      scheduleRecurring(label, nextInstant, runTrigger);
    }
  }, delayMs);
}

// Monday 00:00 MSK — the week's data resets and the new one opens for filling.
export function scheduleWeeklyReset(runReset) {
  scheduleRecurring('weekly schedule reset', nextResetInstant, runReset);
}

// Monday 10:00 MSK — 4 hours before the Monday 14:00 deadline.
export function scheduleDeadlineReminder(runReminder) {
  scheduleRecurring('schedule deadline reminder', nextReminderInstant, runReminder);
}

// Monday 14:00 MSK — submissions close, the summary that
// would otherwise need a manual button press goes out on its own.
export function scheduleAutoSummary(runAutoSummary) {
  scheduleRecurring('schedule auto-summary', nextDeadlineInstant, runAutoSummary);
}
