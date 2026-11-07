import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { getSpreadsheetMeta, getValues, batchUpdate } from '../src/sheetsClient.js';
import { trackerProfileUrl } from '../src/statsRoster.js';

// Change only this player's name/link. Never relabel other roster rows or
// rewrite stat values, formulas, formatting, or historical match IDs.
const spreadsheetId = config.statsSpreadsheetId;
assert(spreadsheetId, 'STATS_SPREADSHEET_ID is required');
const sheets = await getSpreadsheetMeta(spreadsheetId);
const plan = [];
for (const sheet of sheets) {
  const title = `'${sheet.title.replaceAll("'", "''")}'`;
  for (const [range, firstCol, firstRow] of [['B1:B35', 1, 0], ['P1:Q115', 15, 0]]) {
    const values = await getValues(spreadsheetId, `${title}!${range}`, 'FORMULA');
    for (const [r, row] of values.entries()) for (const [c, value] of row.entries()) {
      if (typeof value !== 'string' || !/^militantum(?:#bonr)?$/i.test(value)) continue;
      plan.push({ sheetId: sheet.sheetId, title, row: firstRow + r, col: firstCol + c, before: value });
    }
  }
}
console.log(JSON.stringify({ spreadsheetId, cells: plan }, null, 2));
if (!process.argv.includes('--apply')) {
  console.log('Read-only preview. Use --apply to update the listed cells.');
} else if (plan.length) {
  // Re-read each target immediately before writing, guarding concurrent edits.
  const cellRange = p => `${p.title}!${String.fromCharCode(65 + p.col)}${p.row + 1}`;
  for (const p of plan) assert.equal((await getValues(spreadsheetId, cellRange(p), 'FORMULA'))[0]?.[0], p.before);
  await batchUpdate(spreadsheetId, plan.map(p => ({ updateCells: {
    start: { sheetId: p.sheetId, rowIndex: p.row, columnIndex: p.col },
    rows: [{ values: [{ userEnteredValue: { stringValue: 'Ice blue' }, userEnteredFormat: {
      textFormat: { link: { uri: trackerProfileUrl('Ice blue#bonr') } },
    } }] }],
    fields: 'userEnteredValue,userEnteredFormat.textFormat.link',
  } })));
  for (const p of plan) assert.equal((await getValues(spreadsheetId, cellRange(p)))[0]?.[0], 'Ice blue');
  console.log(`Updated and verified ${plan.length} cells.`);
}
