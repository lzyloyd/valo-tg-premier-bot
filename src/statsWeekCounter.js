import { promises as fs } from 'node:fs';
import { config } from './config.js';

// Tracks how many "<Map> - Premier" tabs have reached their 2nd logged game
// this split — that's used directly as the week number in the auto-posted
// "N неделя V26A5 прем матчи" announcement (one map's best-of-2 per week).
export async function incrementStatsWeekCounter() {
  let count = 0;
  try {
    count = JSON.parse(await fs.readFile(config.statsWeekCounterPath, 'utf8')).count ?? 0;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  count += 1;
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(config.statsWeekCounterPath, JSON.stringify({ count }, null, 2));
  return count;
}
