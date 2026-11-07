import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { config } from '../src/config.js';
import { getSpreadsheetMeta, getValues, getCellNotes, batchUpdate, getFormulaArgSeparator } from '../src/sheetsClient.js';

// One-off correction requested by the manager: attribute these two
// matches to speak with dead instead of Space. No permanent alias.
const ids = ['29999e1b-d31d-4da6-9749-010580af20e1', 'f176b404-c3c2-4afe-af3c-78dbb2ec3103'];
const spreadsheetId = config.statsSpreadsheetId;
assert.equal(spreadsheetId, '1mFUXQPeRIdtSuRKhYUXvqG1W0dLj-NzIc7Q76SMC-wg');
const sheets = await getSpreadsheetMeta(spreadsheetId);
const separator = await getFormulaArgSeparator(spreadsheetId);
const targets = ['Sunset - Premier', 'Статистика за V26A5'];
const requests = [], backup = [], checks = [];
const letter = n => { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
const cellValue = value => value === undefined || value === '' ? {} : { userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value } };
function write(sheetId, row, col, values) {
  requests.push({ updateCells: { start: { sheetId, rowIndex: row, columnIndex: col }, rows: values.map(row => ({ values: row.map(cellValue) })), fields: 'userEnteredValue' } });
}
function formulaRow(sheetId, row, rawOffsets, lastCol) {
  requests.push({ updateCells: {
    start: { sheetId, rowIndex: row, columnIndex: 2 },
    rows: [{ values: rawOffsets.map(offset => ({ userEnteredValue: { formulaValue: `=IFERROR(AVERAGE($R$${72 + offset}:$${lastCol}$${72 + offset})${separator}"-")` } })) }],
    fields: 'userEnteredValue',
  } });
}
for (const title of targets) {
  const sheet = sheets.find(s => s.title === title);
  assert(sheet, title);
  const tab = `'${title}'`;
  assert.equal((await getValues(spreadsheetId, `${tab}!Q2`))[0]?.[0], 'Space Kururugi');
  assert.equal((await getValues(spreadsheetId, `${tab}!Q72`))[0]?.[0], 'speak with dead');
  const headers = (await getValues(spreadsheetId, `${tab}!R1:BZ1`))[0] ?? [];
  const notes = (await getCellNotes(spreadsheetId, `${tab}!R1:BZ1`))[0] ?? [];
  const matchCols = ids.map(id => { const index = notes.indexOf(id); assert(index >= 0, `${title}: match ${id} absent`); assert(headers[index].includes('(Sunset)')); return index + 17; });
  const last = letter(17 + headers.length - 1);
  for (const [i, col] of matchCols.entries()) {
    const c = letter(col);
    const source = await getValues(spreadsheetId, `${tab}!${c}2:${c}15`, 'FORMULA');
    const dest = await getValues(spreadsheetId, `${tab}!${c}72:${c}85`, 'FORMULA');
    assert.equal(source.length, 14, `${title}: missing source stats`);
    assert(source.every(row => typeof row[0] === 'number'), 'Expected numeric source stats');
    assert(dest.every(row => row.every(v => v === '')), `${title}: destination already populated`);
    if (checks[i]) assert.deepEqual(source, checks[i].values, 'Season and Sunset stats differ');
    else checks[i] = { values: source };
    backup.push({ title, matchId: ids[i], sourceRange: `${tab}!${c}2:${c}15`, targetRange: `${tab}!${c}72:${c}85`, source, dest });
    write(sheet.sheetId, 71, col, source);
    write(sheet.sheetId, 1, col, Array.from({ length: 14 }, () => ['']));
  }
  formulaRow(sheet.sheetId, 7, Array.from({ length: 14 }, (_, i) => i), last);
  formulaRow(sheet.sheetId, 18, [0, 1, 6, 7, 8, 9, 10], last);
  if (title === 'Sunset - Premier') {
    assert.equal(headers.filter(Boolean).length, 2, 'Unexpected other Sunset matches');
    write(sheet.sheetId, 2, 2, [Array(14).fill('-')]);
    write(sheet.sheetId, 13, 2, [Array(7).fill('-')]);
  }
}
console.log(JSON.stringify({ spreadsheetId, corrections: backup.map(({ source, dest, ...p }) => p), requests: requests.length }, null, 2));
if (!process.argv.includes('--apply')) {
  console.log('Preview only. Use --apply to move these four stat blocks.');
} else {
  await fs.writeFile('/tmp/ovt-sunset-reassignment-before.json', JSON.stringify(backup, null, 2));
  await batchUpdate(spreadsheetId, requests);
  for (const p of backup) {
    assert.deepEqual(await getValues(spreadsheetId, p.targetRange, 'FORMULA'), p.source);
    assert.equal((await getValues(spreadsheetId, p.sourceRange, 'FORMULA')).flat().filter(v => v !== '').length, 0);
  }
  for (const title of targets) {
    for (const range of ['C8:P8', 'C19:I19']) {
      const values = (await getValues(spreadsheetId, `'${title}'!${range}`)).flat();
      assert(values.length > 0 && values.every(v => !String(v).startsWith('#') && v !== '-'), 'Recipient summary failed');
    }
  }
  console.log('PASS: both matches moved on Sunset and season sheets; source blocks cleared, recipient summaries calculated.');
}
