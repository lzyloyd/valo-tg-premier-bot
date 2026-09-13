import { promises as fs } from 'node:fs';
import { config } from './config.js';
import { DAYS, currentWeekStart, weekDeadline, mskIsoDate } from './scheduleModel.js';

function emptyWeek(weekStart) {
  return {
    weekStart: mskIsoDate(weekStart),
    responses: {},
    edits: [], // post-deadline changes, newest first — shown on the admin tab
  };
}

async function readFile() {
  try {
    const raw = await fs.readFile(config.scheduleDataPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeFile(data) {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(config.scheduleDataPath, JSON.stringify(data, null, 2));
}

/**
 * Loads the current week, resetting to a fresh empty one if the stored week
 * has rolled past its own reset point — a lazy fallback for whenever the
 * process wasn't running exactly at Sunday 20:00 MSK, on top of the cron
 * job that normally does this on time (see scheduler.js).
 */
export async function loadCurrentWeek(now = new Date()) {
  const wantedWeekStart = mskIsoDate(currentWeekStart(now));
  const stored = await readFile();
  if (stored && stored.weekStart === wantedWeekStart) return stored;

  const fresh = emptyWeek(currentWeekStart(now));
  await writeFile(fresh);
  return fresh;
}

export async function resetToNextWeek(nextWeekStart) {
  const fresh = emptyWeek(nextWeekStart);
  await writeFile(fresh);
  return fresh;
}

// Called by the Sunday-20:00-MSK scheduler trigger — currentWeekStart() at
// that exact instant already resolves to the week that's just starting.
export async function runWeeklyReset() {
  const week = await resetToNextWeek(currentWeekStart());
  console.log(`[schedule] reset to new week starting ${week.weekStart}`);
  return week;
}

/**
 * Sets one user's answer for one day. Returns { week, isPostDeadlineEdit }
 * so the caller can decide whether to fire off an alert.
 */
export async function setResponse(username, day, avail, slots, now = new Date()) {
  if (!DAYS.some((d) => d.key === day)) throw new Error(`Unknown day: ${day}`);

  const week = await loadCurrentWeek(now);
  const deadline = weekDeadline(currentWeekStart(now));
  const isPostDeadlineEdit = now > deadline;

  week.responses[username] ??= {};
  const previous = week.responses[username][day];
  week.responses[username][day] = { avail, slots: avail === 'yes' ? slots : [] };

  if (isPostDeadlineEdit) {
    week.edits.unshift({
      username,
      day,
      before: previous ?? null,
      after: week.responses[username][day],
      at: now.toISOString(),
    });
    week.edits = week.edits.slice(0, 50); // keep the log from growing forever
  }

  await writeFile(week);
  return { week, isPostDeadlineEdit };
}
