import { currentWeekStart, weekResetInstant } from './scheduleModel.js';

// Premier matches only happen Saturday 21:00 and 23:00 Moscow time, so the bot
// only ever needs to wake up twice a week — no benefit to polling more often.
// Moscow has used a fixed UTC+3 offset (no DST) since 2014, so working in UTC
// directly is safe and avoids a timezone-database dependency.
const TRIGGER_UTC_HOURS = [18, 20]; // MSK 21:00 and 23:00

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

// The schedule mini app's week rolls over every Sunday 20:00 MSK — the exact
// instant currentWeekStart() itself uses to decide "has this week already
// ended", so a trigger fired right at that point and a lazy check on the
// next read always agree on what the current week is.
export function scheduleWeeklyReset(runReset) {
  const delayMs = weekResetInstant(currentWeekStart()).getTime() - Date.now();
  console.log(`[scheduler] next weekly schedule reset in ${Math.round(delayMs / 60000)} min`);
  setTimeout(async () => {
    try {
      await runReset();
    } catch (err) {
      console.error('[scheduler] weekly reset failed:', err);
    } finally {
      scheduleWeeklyReset(runReset);
    }
  }, delayMs);
}
