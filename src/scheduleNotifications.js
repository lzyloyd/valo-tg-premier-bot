import { config } from './config.js';
import { ROSTER, hasFullyAnswered, buildSummaryText, computeWeekSessions } from './scheduleModel.js';
import { loadCurrentWeek, runWeeklyReset } from './scheduleStore.js';
import { sendTextTo } from './telegram.js';

const MINUTE_MS = 60 * 1000;

function formatSessionTime(session) {
  return `${session.dayLabel}, ${session.slot} МСК`;
}

// One-off (non-recurring) reminder, scheduled directly from a session's own
// start time — unlike the weekly recurring triggers in scheduler.js, these
// only exist for the current week's sessions and are recomputed fresh each
// time this runs (see scheduleUpcomingSessionReminders below).
function scheduleOneOff(at, send) {
  const delayMs = at.getTime() - Date.now();
  if (delayMs <= 0) return;
  setTimeout(() => {
    send().catch((err) => console.error('[schedule] session reminder failed:', err));
  }, delayMs);
}

async function sendSessionReminder(session, minutesBefore) {
  const mentions = session.lineup.map((u) => `@${u}`).join(', ');
  await sendTextTo(
    config.scheduleChatId,
    null, // straight into the group's general topic, not "Сборы"
    `⏰ Через ${minutesBefore} минут — ${formatSessionTime(session)}\nИграют: ${mentions}`,
  );
}

/**
 * Schedules the 60- and 10-minute-before reminders for every session the
 * current week actually produced. Called right after the deadline resolves
 * the week's final lineups, and again on process startup so a mid-week
 * restart doesn't silently drop the rest of that week's reminders (these
 * are plain in-memory timers, not persisted).
 */
export async function scheduleUpcomingSessionReminders() {
  const week = await loadCurrentWeek();
  const sessions = computeWeekSessions(week);
  for (const session of sessions) {
    scheduleOneOff(new Date(session.startsAt.getTime() - 60 * MINUTE_MS), () => sendSessionReminder(session, 60));
    scheduleOneOff(new Date(session.startsAt.getTime() - 10 * MINUTE_MS), () => sendSessionReminder(session, 10));
  }
  console.log(`[schedule] ${sessions.length} session(s) this week, reminders (re)scheduled`);
}

// Fires at the week's own reset (Sunday 20:00 MSK) — the fresh empty week
// is created first, then everyone's told filling starts now.
export async function resetWeekAndAnnounce() {
  await runWeeklyReset();
  const mentions = ROSTER.map((u) => `@${u}`).join(', ');
  await sendTextTo(
    config.scheduleChatId,
    config.scheduleThreadId,
    `📅 Открыли новую неделю — заполните расписание в мини-аппе до понедельника 24:00 МСК.\n${mentions}`,
  );
}

// Fires 4 hours before the deadline (Monday 20:00 MSK) — only nags whoever
// hasn't finished all 6 days yet, and says nothing if everyone already has.
export async function sendDeadlineReminder() {
  const week = await loadCurrentWeek();
  const missing = ROSTER.filter((u) => !hasFullyAnswered(week.responses, u));
  if (missing.length === 0) return;
  await sendTextTo(
    config.scheduleChatId,
    config.scheduleThreadId,
    `⏰ Осталось 4 часа до дедлайна (Пн 24:00 МСК) — ещё не заполнил(и) расписание: ${missing.map((u) => `@${u}`).join(', ')}`,
  );
}

// Fires right at the deadline (Monday 24:00 / Tuesday 00:00 MSK) — the same
// summary the admin can send by hand from the app, just automatic so it
// doesn't get missed if nobody presses the button in time. This is also the
// point the week's lineups are considered final, so the session reminders
// for the rest of the week get scheduled right here.
export async function sendAutoSummary() {
  const week = await loadCurrentWeek();
  await sendTextTo(config.scheduleChatId, config.scheduleThreadId, buildSummaryText(week));
  await scheduleUpcomingSessionReminders();
}
