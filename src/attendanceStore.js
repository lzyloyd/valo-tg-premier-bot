import { promises as fs } from 'node:fs';
import { config } from './config.js';

async function readFile() {
  try {
    const raw = await fs.readFile(config.attendanceDataPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeFile(data) {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(config.attendanceDataPath, JSON.stringify(data, null, 2));
}

// { [username]: { count, history: [{ weekStart, dayKey, slot, dayLabel, dateIso, at }] } }
export async function loadAttendance() {
  return readFile();
}

/**
 * Records a no-show for one specific session. Idempotent per (username,
 * weekStart, dayKey, slot) — returns null instead of double-counting if
 * that exact session was already marked (e.g. a double click that raced
 * past the frontend's own disabled-button guard).
 */
export async function recordMiss(username, weekStart, dayKey, slot, meta, now = new Date()) {
  const data = await readFile();
  data[username] ??= { count: 0, history: [] };
  const alreadyMarked = data[username].history.some(
    (h) => h.weekStart === weekStart && h.dayKey === dayKey && h.slot === slot,
  );
  if (alreadyMarked) return null;

  data[username].count += 1;
  data[username].history.unshift({ weekStart, dayKey, slot, dayLabel: meta.dayLabel, dateIso: meta.dateIso, at: now.toISOString() });

  await writeFile(data);
  return data[username];
}
