import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { config } from '../src/config.js';
import { getSpreadsheetMeta, getValues, batchUpdate } from '../src/sheetsClient.js';

// Remove only the last (eighth) player's stats from the OVT spreadsheet.
// Do not delete whole worksheet rows: the adjacent columns belong to others.
const spreadsheetId = config.statsSpreadsheetId;
assert.equal(spreadsheetId, '1mFUXQPeRIdtSuRKhYUXvqG1W0dLj-NzIc7Q76SMC-wg');
const sheets = await getSpreadsheetMeta(spreadsheetId);
const requests = [], backup = [];
function letter(n) { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }
for (const sheet of sheets) {
  assert(sheet.title === 'Статистика за V26A5' || / - (Premier|Праки)$/.test(sheet.title), `Unrecognized tab: ${sheet.title}`);
  const practice = sheet.title.endsWith(' - Праки');
  const tab = `'${sheet.title.replaceAll("'", "''")}'`;
  const ranges = [
    { a1: `B10:${practice ? 'O' : 'P'}10`, row: 9, endRow: 10, col: 1, endCol: practice ? 15 : 16 },
    { a1: `B21:${practice ? 'H' : 'I'}21`, row: 20, endRow: 21, col: 1, endCol: practice ? 8 : 9 },
    { a1: `${practice ? 'P' : 'Q'}100:${letter(sheet.gridProperties.columnCount - 1)}113`, row: 99, endRow: 113, col: practice ? 15 : 16, endCol: sheet.gridProperties.columnCount },
  ];
  for (const range of ranges) {
    const a1 = `${tab}!${range.a1}`;
    const values = await getValues(spreadsheetId, a1, 'FORMULA');
    assert(/^mania(?:#uma)?$/i.test(values[0]?.[0] ?? ''), `Expected Mania at ${a1}; stopped without writing`);
    backup.push({ range: a1, values });
    requests.push({ repeatCell: {
      range: { sheetId: sheet.sheetId, startRowIndex: range.row, endRowIndex: range.endRow, startColumnIndex: range.col, endColumnIndex: range.endCol },
      cell: {}, fields: 'userEnteredValue,userEnteredFormat,textFormatRuns,note',
    } });
  }
}
console.log(JSON.stringify({ spreadsheetId, sheets: sheets.map(s => s.title), ranges: backup.map(b => b.range) }, null, 2));
if (!process.argv.includes('--apply')) {
  console.log('Preview only. Add --apply to remove Mania from this spreadsheet.');
} else {
  await fs.writeFile('/tmp/ovt-mania-stats-before-removal.json', JSON.stringify(backup, null, 2));
  await batchUpdate(spreadsheetId, requests);
  for (const entry of backup) assert.equal((await getValues(spreadsheetId, entry.range, 'FORMULA')).flat().filter(v => v !== '').length, 0, entry.range);
  console.log(`PASS: removed Mania names, summaries and raw game results from all ${sheets.length} OVT tabs.`);
}
