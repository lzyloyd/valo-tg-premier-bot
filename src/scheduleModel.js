// Fixed roster of Telegram usernames (lowercase, no @) allowed to use the
// mini app — matched against Telegram WebApp initData, not self-registered.
export const ROSTER = ['qu1ly', 'toshir0000', 'men4ikcs', 'kitkatfn', 'bonrik1', 'deadqq', 'mania_boo', 'lzyloyd'];

// The 5 starters and their substitutes — who actually plays a session is resolved
// from these, not from raw availability (see resolveLineup below).
export const MAIN_ROSTER = ['qu1ly', 'toshir0000', 'bonrik1', 'kitkatfn', 'lzyloyd'];
export const SUB_ROSTER = ['deadqq', 'men4ikcs', 'mania_boo']; // First available substitute wins priority.

export const QUORUM = 5;

// No-show warnings never reset and never expire — see attendanceStore.js.
export const MAX_WARNINGS = 3;

// A week runs Mon-Sun. Practice days share the same two slots but only one
// of them actually happens (pickOneSlot); Saturday's Premier plays both
// times as independent sessions; Sunday's tournament is optional and only
// ever has one slot.
export const DAYS = [
  { key: 'mon', label: 'Понедельник', kind: 'Праки', slots: ['20:00', '21:00', '22:00'], pickOneSlot: true },
  { key: 'tue', label: 'Вторник', kind: 'Праки', slots: ['20:00', '21:00', '22:00'], pickOneSlot: true },
  { key: 'wed', label: 'Среда', kind: 'Праки', slots: ['20:00', '21:00', '22:00'], pickOneSlot: true },
  { key: 'thu', label: 'Четверг', kind: 'Праки', slots: ['20:00', '21:00', '22:00'], pickOneSlot: true },
  { key: 'fri', label: 'Пятница', kind: 'Праки', slots: ['20:00', '21:00', '22:00'], pickOneSlot: true },
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
 * The Monday (00:00 MSK, as a UTC instant) that starts the week currently
 * open for editing. Weeks roll over at their own Sunday 20:00 MSK — the
 * data store's reset job fires exactly then, this just has to agree with it
 * so a freshly-booted server (no reset job having run yet) computes the
 * same week a live one would already be showing.
 */
export function currentWeekStart(now = new Date()) {
  const msk = toMsk(now);
  const dow = msk.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMon = (dow - 1 + 7) % 7;
  const mon = mskMidnightUtc(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() - daysSinceMon);
  const resetInstant = weekResetInstant(mon);
  return now >= resetInstant ? new Date(mon.getTime() + 7 * DAY_MS) : mon;
}

// The instant the *next* week starts — also when the current one's data
// gets wiped and replaced (Sunday 20:00 MSK, i.e. weekStart + 6d20h).
export function weekResetInstant(weekStart) {
  return new Date(weekStart.getTime() + 6 * DAY_MS + 20 * 60 * 60 * 1000);
}

// Filling closes Sunday 24:00 MSK = Monday 00:00, before the first playing day.
export function weekDeadline(weekStart) {
  return weekStart;
}

// Sunday 20:00 MSK — 4 hours before the deadline, also the week opening.
export function reminderInstant(weekStart) {
  return new Date(weekDeadline(weekStart).getTime() - 4 * 60 * 60 * 1000);
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

// The deadline itself (Sunday 24:00 MSK = Monday 00:00 MSK) — when
// submissions close, the automatic summary goes out unprompted.
export function nextDeadlineInstant(now = new Date()) {
  return nextOccurrence(now, weekDeadline);
}

export function weekDayDates(weekStart) {
  return DAYS.map((d, i) => ({ ...d, dateIso: mskIsoDate(new Date(weekStart.getTime() + i * DAY_MS)) }));
}

// "Answered" means every playing day has a yes/no.
export function hasFullyAnswered(responses, username, daysOff = []) {
  return DAYS.filter((d) => !daysOff.includes(d.key)).every((d) => responses[username]?.[d.key]?.avail);
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
 * Missing starters are filled from the available substitutes in roster
 * order. If there aren't enough substitutes, there's no team.
 * Returns the 5 usernames, or null if no viable lineup.
 */
export function resolveLineup(available) {
  const mains = MAIN_ROSTER.filter((u) => available.includes(u));
  const subs = SUB_ROSTER.filter((u) => available.includes(u));

  const missing = QUORUM - mains.length;
  if (subs.length < missing) return null;
  return [...mains, ...subs.slice(0, missing)];
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
  // Several slots are viable — pick by starter turnout, earliest time on a tie
  // (candidates keep day.slots' chronological order, and only a strictly
  // higher count replaces the current pick).
  let winner = candidates[0];
  let bestCount = mainsAvailableCount(responses, day.key, winner.slot);
  for (const c of candidates.slice(1)) {
    const count = mainsAvailableCount(responses, day.key, c.slot);
    if (count > bestCount) {
      winner = c;
      bestCount = count;
    }
  }
  return [winner];
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
  const daysOff = week.daysOff ?? [];
  const sessions = [];
  for (const day of DAYS) {
    if (daysOff.includes(day.key)) continue;
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
  const daysOff = week.daysOff ?? [];
  const lines = [`📅 Расписание — ${formatDayDate(days[0].dateIso)}–${formatDayDate(days.at(-1).dateIso)}`, ''];

  for (const day of days) {
    lines.push(`${day.label} ${formatDayDate(day.dateIso)} · ${day.kind}`);
    if (daysOff.includes(day.key)) {
      lines.push('☀️ выходной');
    } else {
      const sessions = computeDaySessions(day, week.responses);
      if (sessions.length === 0) {
        lines.push('▫️ сессии не будет');
      } else {
        for (const s of sessions) {
          lines.push(`✅ ${s.slot} — играют: ${s.lineup.map((u) => `@${u}`).join(', ')}`);
        }
      }
    }
    lines.push('');
  }

  const answered = ROSTER.filter((u) => hasFullyAnswered(week.responses, u, daysOff));
  const missing = ROSTER.filter((u) => !hasFullyAnswered(week.responses, u, daysOff));
  lines.push(`Ответили: ${answered.length}/${ROSTER.length}${missing.length ? ` · не ответил(и): ${missing.map((n) => `@${n}`).join(', ')}` : ''}`);

  return lines.join('\n');
}

function describeAnswer(entry) {
  if (!entry) return 'без ответа';
  if (entry.avail !== 'yes') return 'не может';
  return entry.slots.length ? entry.slots.join(', ') : 'может';
}

// Posted to "Сборы" the moment the admin marks someone absent from a
// specific session — see attendanceStore.js for why the count itself never
// resets. At the cap, the wording calls out the roster consequence
// (moved to reserve) instead of just another plain warning.
export function buildMissWarningText(username, session, count) {
  const day = DAYS.find((d) => d.key === session.dayKey);
  const label = `${day.label.toLowerCase()} ${session.slot} (${day.kind})`;
  if (count >= MAX_WARNINGS) {
    return `🚨 @${username} не пришёл(а) на ${label} — ${count}/${MAX_WARNINGS}. Лимит предупреждений исчерпан, игрок переводится в запас.`;
  }
  return `⚠️ @${username} не пришёл(а) на ${label}. Предупреждений: ${count}/${MAX_WARNINGS}.`;
}

export function buildEditAlertText(edit) {
  const day = DAYS.find((d) => d.key === edit.day);
  return `✏️ @${edit.username} изменил(а) ответ на ${day.label.toLowerCase()}: ${describeAnswer(edit.before)} → ${describeAnswer(edit.after)}`;
}
