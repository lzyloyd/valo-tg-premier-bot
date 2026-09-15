import { config } from './config.js';
import { ROSTER, hasFullyAnswered, buildSummaryText, buildEditAlertText, computeWeekSessions } from './scheduleModel.js';
import { loadCurrentWeek, runWeeklyReset, saveSummaryMessageId } from './scheduleStore.js';
import { sendTextTo, sendTextToWithId, editMessageText } from './telegram.js';

const MINUTE_MS = 60 * 1000;

function formatSessionTime(session) {
  return `${session.dayLabel}, ${session.slot} МСК`;
}

// One-off (non-recurring) reminder, scheduled directly from a session's own
// start time — unlike the weekly recurring triggers in scheduler.js, these
// only exist for the current week's sessions. Returns the timer handle (or
// null if the instant's already passed) so a later reschedule can clear it.
function scheduleOneOff(at, send) {
  const delayMs = at.getTime() - Date.now();
  if (delayMs <= 0) return null;
  return setTimeout(() => {
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

// Handles for whatever's currently scheduled, so a reschedule (a
// post-deadline edit can change who's actually playing) clears the old
// timers instead of leaving stale ones to fire alongside the new ones.
let scheduledTimers = [];

function clearScheduledReminders() {
  for (const timer of scheduledTimers) clearTimeout(timer);
  scheduledTimers = [];
}

/**
 * Schedules the 60- and 10-minute-before reminders for every session the
 * current week actually produced. Called right after the deadline resolves
 * the week's final lineups, again on process startup (a mid-week restart
 * would otherwise silently drop the rest of that week's reminders, since
 * these are plain in-memory timers, not persisted), and again whenever a
 * post-deadline edit changes a lineup.
 */
export async function scheduleUpcomingSessionReminders() {
  clearScheduledReminders();
  const week = await loadCurrentWeek();
  const sessions = computeWeekSessions(week);
  for (const session of sessions) {
    const t60 = scheduleOneOff(new Date(session.startsAt.getTime() - 60 * MINUTE_MS), () => sendSessionReminder(session, 60));
    const t10 = scheduleOneOff(new Date(session.startsAt.getTime() - 10 * MINUTE_MS), () => sendSessionReminder(session, 10));
    if (t60) scheduledTimers.push(t60);
    if (t10) scheduledTimers.push(t10);
  }
  console.log(`[schedule] ${sessions.length} session(s) this week, reminders (re)scheduled`);
}

// Shared by the admin's manual "Отправить сводку" button and the automatic
// deadline trigger — remembers the sent message's id so a later edit can
// keep it in sync instead of only alerting separately.
export async function sendSummary() {
  const week = await loadCurrentWeek();
  const messageId = await sendTextToWithId(config.scheduleChatId, config.scheduleThreadId, buildSummaryText(week));
  await saveSummaryMessageId(messageId);
}

// If a summary's already been sent this week, edits it in place to match
// the current data — a no-op if nothing actually looks different (Telegram
// rejects a same-text edit; that's caught and ignored in telegram.js).
export async function refreshSummaryMessage() {
  const week = await loadCurrentWeek();
  if (!week.summaryMessageId) return;
  await editMessageText(config.scheduleChatId, week.summaryMessageId, buildSummaryText(week));
}

// Called after any post-deadline edit: alerts it, keeps the standing
// summary message (if one's been sent) in sync, and re-derives the session
// reminders in case the edit actually changed who's playing.
export async function handlePostDeadlineEdit(edit) {
  await sendTextTo(config.scheduleChatId, config.scheduleThreadId, buildEditAlertText(edit));
  await refreshSummaryMessage();
  await scheduleUpcomingSessionReminders();
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
  const missing = ROSTER.filter((u) => !hasFullyAnswered(week.responses, u, week.daysOff));
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
  await sendSummary();
  await scheduleUpcomingSessionReminders();
}
