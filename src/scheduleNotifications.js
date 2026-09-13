import { config } from './config.js';
import { ROSTER, hasFullyAnswered } from './scheduleModel.js';
import { loadCurrentWeek, runWeeklyReset } from './scheduleStore.js';
import { sendTextTo } from './telegram.js';

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
