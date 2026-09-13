// Fixed roster of Telegram usernames (lowercase, no @) allowed to use the
// mini app — matched against Telegram WebApp initData, not self-registered.
export const ROSTER = ['qu1ly', 'toshir0000', 'men4ikcs', 'yozhee', 'natomatrixx', 'mania_boo', 'lzyloyd'];

// The 5 starters and their 2 subs — who actually plays a session is resolved
// from these, not from raw availability (see resolveLineup below).
export const MAIN_ROSTER = ['qu1ly', 'yozhee', 'toshir0000', 'natomatrixx', 'lzyloyd'];
export const SUB_ROSTER = ['men4ikcs', 'mania_boo']; // in preference order — Men4ikcs fills a single gap first

export const QUORUM = 5;

// A week runs Tue-Sun. Practice days share the same two slots but only one
// of them actually happens (pickOneSlot); Saturday's Premier plays both
// times as independent sessions; Sunday's tournament is optional and only
// ever has one slot.
export const DAYS = [
  { key: 'tue', label: 'Вторник', kind: 'Праки', slots: ['20:00', '22:00'], pickOneSlot: true },
  { key: 'wed', label: 'Среда', kind: 'Праки', slots: ['20:00', '22:00'], pickOneSlot: true },
  { key: 'thu', label: 'Четверг', kind: 'Праки', slots: ['20:00', '22:00'], pickOneSlot: true },
  { key: 'fri', label: 'Пятница', kind: 'Праки', slots: ['20:00', '22:00'], pickOneSlot: true },
  { key: 'sat', label: 'Суббота', kind: 'Премьер', slots: ['20:00', '22:00'] },
  { key: 'sun', label: 'Воскресенье', kind: 'МСК турнир', slots: ['18:00'] },
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
 * Who actually plays a slot, given who's available for it — a team needs
 * exactly 5. All 5 starters present: no subs, even if one's also free.
 * One starter missing: whichever sub is available fills in (Men4ikcs
 * preferred when both are). Two starters missing: both subs have to be
 * available, or there's no team. Fewer than 3 starters: never enough subs
 * to cover it. Returns the 5 usernames, or null if no viable lineup.
 */
export function resolveLineup(available) {
  const mains = MAIN_ROSTER.filter((u) => available.includes(u));
  const subs = SUB_ROSTER.filter((u) => available.includes(u));

  if (mains.length === 5) return [...mains];
  if (mains.length === 4) return subs.length >= 1 ? [...mains, subs[0]] : null;
  if (mains.length === 3) return subs.length === 2 ? [...mains, ...subs] : null;
  return null;
}

function mainsAvailableCount(responses, day, slot) {
  return MAIN_ROSTER.filter((u) => responses[u]?.[day]?.avail === 'yes' && responses[u]?.[day]?.slots?.includes(slot)).length;
}

/**
 * The session(s) a day actually produces: for a pickOneSlot day (practice),
 * the single time with the better starter turnout (earlier time wins ties)
 * — but only if that time actually resolves to a full lineup; if it doesn't
 * while the other slot would, the other slot is used instead. Everything
 * else (Premier, МСК) resolves each of its slots independently.
 */
export function computeDaySessions(day, responses) {
  const candidates = day.slots
    .map((slot) => ({ slot, lineup: resolveLineup(availableFor(responses, day.key, slot)) }))
    .filter((c) => c.lineup);

  if (!day.pickOneSlot) return candidates;
  if (candidates.length <= 1) return candidates;
  // Both slots are viable — pick by starter turnout, earlier time on a tie.
  const [a, b] = day.slots;
  const countA = mainsAvailableCount(responses, day.key, a);
  const countB = mainsAvailableCount(responses, day.key, b);
  const winner = countB > countA ? b : a;
  return candidates.filter((c) => c.slot === winner);
}

// The absolute instant (UTC) a given day+slot within a week actually starts.
export function slotInstant(weekStart, dayKey, time) {
  const dayIndex = DAYS.findIndex((d) => d.key === dayKey);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(weekStart.getTime() + dayIndex * DAY_MS + hh * 60 * 60 * 1000 + mm * 60 * 1000);
}

// Every session the whole week actually produces, flattened across days —
// what the 60/10-minute-before reminders are scheduled from.
export function computeWeekSessions(week) {
  const weekStart = weekStartFromIso(week.weekStart);
  const sessions = [];
  for (const day of DAYS) {
    for (const { slot, lineup } of computeDaySessions(day, week.responses)) {
      sessions.push({ dayKey: day.key, dayLabel: day.label, slot, lineup, startsAt: slotInstant(weekStart, day.key, slot) });
    }
  }
  return sessions;
}

/**
 * The text posted to "Сборы" — shows the actual resolved lineup per session
 * (see resolveLineup/computeDaySessions), not just raw availability.
 */
export function buildSummaryText(week) {
  const days = weekDayDates(weekStartFromIso(week.weekStart));
  const lines = [`📅 Расписание — ${formatDayDate(days[0].dateIso)}–${formatDayDate(days[5].dateIso)}`, ''];

  for (const day of days) {
    lines.push(`${day.label} ${formatDayDate(day.dateIso)} · ${day.kind}`);
    const sessions = computeDaySessions(day, week.responses);
    if (sessions.length === 0) {
      lines.push('▫️ сессии не будет');
    } else {
      for (const s of sessions) {
        lines.push(`✅ ${s.slot} — играют: ${s.lineup.map((u) => `@${u}`).join(', ')}`);
      }
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
