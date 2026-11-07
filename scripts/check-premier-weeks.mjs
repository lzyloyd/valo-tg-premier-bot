import { config } from '../src/config.js';
import { getSpreadsheetMeta, getValues } from '../src/sheetsClient.js';
import { premierWeekNumber } from '../src/sheetsStats.js';

// Read-only: report the actual captions' week numbers, without Telegram posts.
const id = config.statsSpreadsheetId;
for (const sheet of await getSpreadsheetMeta(id)) {
  if (!sheet.title.endsWith(' - Premier')) continue;
  const headers = await getValues(id, `'${sheet.title.replaceAll("'", "''")}'!R1:${sheet.gridProperties.columnCount >= 78 ? 'BZ' : 'AC'}1`);
  if (!headers.flat().some(v => /Game \d+/.test(v))) continue;
  console.log(`${await premierWeekNumber(id, sheet.sheetId)} неделя: ${sheet.title} (gid=${sheet.sheetId})`);
}
