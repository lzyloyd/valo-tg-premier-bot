// Fixed roster of Telegram usernames (lowercase, no @) allowed to use the
// mini app — matched against Telegram WebApp initData, not self-registered.
export const ROSTER = ['qu1ly', 'toshir0000', 'men4ikcs', 'yozhee', 'natomatrixx', 'mania_boo', 'lzyloyd'];

export const QUORUM = 5;

// A week runs Tue-Sun. Practice days share the same two slots; Saturday is
// Premier; Sunday's tournament is optional and only ever has one slot.
export const DAYS = [
  { key: 'tue', label: 'Вторник', kind: 'Праки, до 00:00 МСК', slots: ['20:00', '22:00'] },
  { key: 'wed', label: 'Среда', kind: 'Праки, до 00:00 МСК', slots: ['20:00', '22:00'] },
  { key: 'thu', label: 'Четверг', kind: 'Праки, до 00:00 МСК', slots: ['20:00', '22:00'] },
  { key: 'fri', label: 'Пятница', kind: 'Праки, до 00:00 МСК', slots: ['20:00', '22:00'] },
  { key: 'sat', label: 'Суббота', kind: 'Премьер', slots: ['20:00', '22:00'] },
  { key: 'sun', label: 'Воскресенье', kind: 'МСК турнир, если есть', slots: ['18:00'] },
];

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Moscow has used a fixed UTC+3 offset (no DST) since 2014 — plain ms math
// against that offset is safe, no timezone-database dependency needed.
function toMsk(instant) {
  return new Date(instant.getTime() + MSK_OFFSET_MS);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function mskIsoDate(instant) {
  const m = toMsk(instant);
  return `${m.getUTCFullYear()}-${pad(m.getUTCMonth() + 1)}-${pad(m.getUTCDate())}`;
}

// The UTC instant of MSK midnight for a given (MSK) calendar date.
function mskMidnightUtc(year, month, day) {
  return new Date(Date.UTC(year, month, day, -3, 0, 0));
}

// Inverse of mskIsoDate — turns a stored "YYYY-MM-DD" weekStart back into
// the same UTC instant currentWeekStart() would have produced for it.
export function weekStartFromIso(dateIso) {
  const [y, m, d] = dateIso.split('-').map(Number);
  return mskMidnightUtc(y, m - 1, d);
}

/**
 * The Tuesday (00:00 MSK, as a UTC instant) that starts the week currently
 * open for editing. Weeks roll over at their own Sunday 20:00 MSK — the
 * data store's reset job fires exactly then, this just has to agree with it
 * so a freshly-booted server (no reset job having run yet) computes the
 * same week a live one would already be showing.
 */
export function currentWeekStart(now = new Date()) {
  const msk = toMsk(now);
  const dow = msk.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceTue = (dow - 2 + 7) % 7;
  const tue = mskMidnightUtc(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() - daysSinceTue);
  const resetInstant = new Date(tue.getTime() + 5 * DAY_MS + 20 * 60 * 60 * 1000); // that week's Sun 20:00 MSK
  return now >= resetInstant ? new Date(tue.getTime() + 7 * DAY_MS) : tue;
}

// The instant the *next* week starts — also when the current one's data
// gets wiped and replaced (Sunday 20:00 MSK, i.e. weekStart + 5d20h).
export function weekResetInstant(weekStart) {
  return new Date(weekStart.getTime() + 5 * DAY_MS + 20 * 60 * 60 * 1000);
}

// The deadline for filling in a week's own schedule is simply its own start
// (Tuesday 00:00 MSK) — anything changed after this is a post-deadline edit.
export function weekDeadline(weekStart) {
  return weekStart;
}

// 4 hours before the deadline (Monday 20:00 MSK, since the deadline itself
// is Tuesday 00:00 MSK) — when the "last chance" reminder goes out.
export function reminderInstant(weekStart) {
  return new Date(weekStart.getTime() - 4 * 60 * 60 * 1000);
}

// Whichever of weekResetInstant/reminderInstant hasn't happened yet for the
// currently-open week — advances a full week once it has, same rollover
// rule currentWeekStart() itself uses.
function nextOccurrence(now, instantFor) {
  const instant = instantFor(currentWeekStart(now));
  return instant > now ? instant : new Date(instant.getTime() + 7 * DAY_MS);
}

export function nextResetInstant(now = new Date()) {
  return nextOccurrence(now, weekResetInstant);
}

export function nextReminderInstant(now = new Date()) {
  return nextOccurrence(now, reminderInstant);
}

// The deadline itself (Monday 24:00 MSK = Tuesday 00:00 MSK) — when
// submissions close, the automatic summary goes out unprompted.
export function nextDeadlineInstant(now = new Date()) {
  return nextOccurrence(now, weekDeadline);
}

export function weekDayDates(weekStart) {
  return DAYS.map((d, i) => ({ ...d, dateIso: mskIsoDate(new Date(weekStart.getTime() + i * DAY_MS)) }));
}

// "Answered" means all 6 days have a yes/no — a stray click on just one day
// (leaving the other 5 untouched) shouldn't read as a completed submission.
export function hasFullyAnswered(responses, username) {
  return DAYS.every((d) => responses[username]?.[d.key]?.avail);
}

function availableFor(responses, day, slot) {
  return Object.entries(responses)
    .filter(([, byDay]) => byDay[day]?.avail === 'yes' && byDay[day]?.slots?.includes(slot))
    .map(([username]) => username);
}

function formatDayDate(dateIso) {
  const [, month, day] = dateIso.split('-');
  return `${day}.${month}`;
}

/**
 * The text posted to "Сборы" — a checkmark only means a slot actually has
 * enough people (QUORUM) to run; fewer than that still lists who's in, just
 * without implying the session is happening.
 */
export function buildSummaryText(week) {
  const days = weekDayDates(weekStartFromIso(week.weekStart));
  const lines = [`📅 Расписание — ${formatDayDate(days[0].dateIso)}–${formatDayDate(days[5].dateIso)}`, ''];

  for (const day of days) {
    lines.push(`${day.label} ${formatDayDate(day.dateIso)} · ${day.kind.split(',')[0]}`);
    for (const slot of day.slots) {
      const names = availableFor(week.responses, day.key, slot);
      let mark;
      let text;
      if (names.length === 0) {
        mark = '▫️';
        text = 'нет доступных';
      } else if (names.length >= QUORUM) {
        mark = '✅';
        text = names.length === ROSTER.length ? `все ${ROSTER.length}/${ROSTER.length}` : names.map((n) => `@${n}`).join(', ');
      } else {
        mark = '•';
        text = names.map((n) => `@${n}`).join(', ');
      }
      lines.push(`${mark} ${slot} — ${text}`);
    }
    lines.push('');
  }

  const answered = ROSTER.filter((u) => hasFullyAnswered(week.responses, u));
  const missing = ROSTER.filter((u) => !hasFullyAnswered(week.responses, u));
  lines.push(`Ответили: ${answered.length}/${ROSTER.length}${missing.length ? ` · не ответил(и): ${missing.map((n) => `@${n}`).join(', ')}` : ''}`);

  return lines.join('\n');
}

function describeAnswer(entry) {
  if (!entry || entry.avail !== 'yes') return 'не может';
  return entry.slots.length ? entry.slots.join(', ') : 'может';
}

export function buildEditAlertText(edit) {
  const day = DAYS.find((d) => d.key === edit.day);
  return `✏️ @${edit.username} изменил(а) ответ на ${day.label.toLowerCase()}: ${describeAnswer(edit.before)} → ${describeAnswer(edit.after)}`;
}
