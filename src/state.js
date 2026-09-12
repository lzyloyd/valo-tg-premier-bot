import { promises as fs } from 'node:fs';
import { config } from './config.js';

async function ensureDataDir() {
  await fs.mkdir(config.dataDir, { recursive: true });
}

export async function loadSeenMatchIds() {
  try {
    const raw = await fs.readFile(config.statePath, 'utf8');
    return new Set(JSON.parse(raw).seenMatchIds ?? []);
  } catch (err) {
    if (err.code === 'ENOENT') return new Set();
    throw err;
  }
}

export async function saveSeenMatchIds(seenMatchIds) {
  await ensureDataDir();
  // Cap growth — we only ever need enough history to dedupe against the
  // handful of matches tracker.gg's profile page returns.
  const trimmed = [...seenMatchIds].slice(-200);
  await fs.writeFile(config.statePath, JSON.stringify({ seenMatchIds: trimmed }, null, 2));
}
