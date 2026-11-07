import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { config } from '../src/config.js';
import { getSpreadsheetMeta, getValues, getCellNotes, batchUpdate, getFormulaArgSeparator } from '../src/sheetsClient.js';

// Manager-requested attribution corrections for these two matches only.
const ids = ['d41b8ff0-6a95-48b3-ac22-e933e953d03e', '1069b966-5784-4c4d-956a-e90d3f313c9a'];
const spreadsheetId = config.statsSpreadsheetId;
assert.equal(spreadsheetId, '1mFUXQPeRIdtSuRKhYUXvqG1W0dLj-NzIc7Q76SMC-wg');
const meta = await getSpreadsheetMeta(spreadsheetId);
const separator = await getFormulaArgSeparator(spreadsheetId);
const requests = [], snapshots = [], expected = [], comparison = [];
function letter(n) { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }
const cell = value => value === undefined || value === '' ? {} : { userEnteredValue:
  typeof value === 'number' ? { numberValue: value } : { stringValue: value } };
function write(sheetId, row0, col0, values) {
  requests.push({ updateCells: { start: { sheetId, rowIndex: row0, columnIndex: col0 }, rows: values.map(row => ({ values: row.map(cell) })), fields: 'userEnteredValue' } });
}
for (const title of ['Corrode - Premier', 'Статистика за V26A5']) {
  const sheet = meta.find(s => s.title === title);
  assert(sheet, title);
  const tab = `'${title}'`;
  const lastGridCol = letter(sheet.gridProperties.columnCount - 1);
  const range = `${tab}!Q1:${lastGridCol}115`;
  const values = await getValues(spreadsheetId, range, 'FORMULA');
  snapshots.push({ title, range, values });
  const notes = (await getCellNotes(spreadsheetId, `${tab}!R1:${lastGridCol}1`))[0] ?? [];
  const columns = ids.map(id => { const i = notes.indexOf(id); assert(i >= 0, `${title}: missing ${id}`); assert(values[0][i + 1].includes('(Corrode)')); return i + 17; });
  const getBlock = (row1, col) => Array.from({ length: 14 }, (_, i) => [values[row1 - 1 + i]?.[col - 16] ?? '']);
  for (const [row1, name] of [[44, 'Ax1oM'], [58, 'Ice blue'], [72, 'speak with dead']]) assert.equal(values[row1 - 1]?.[0], name);
  const firstIce = getBlock(58, columns[0]);
  const blocks = columns.map((col, i) => {
    const axiom = getBlock(44, col), ice = getBlock(58, col), recipient = getBlock(72, col);
    assert(axiom.every(r => typeof r[0] === 'number') && ice.every(r => typeof r[0] === 'number'), 'Expected original numeric stats');
    assert(recipient.every(r => r[0] === ''), 'Recipient already has stats for this match');
    const original = { axiom, ice };
    if (comparison[i]) assert.deepEqual(original, comparison[i], 'Map and season differ');
    else comparison[i] = original;
    return { col, axiom };
  });
  for (const [i, { col, axiom }] of blocks.entries()) {
    const empty = Array.from({ length: 14 }, () => ['']);
    const replacement = i === 0 ? firstIce : empty;
    write(sheet.sheetId, 71, col, axiom);
    write(sheet.sheetId, 43, col, replacement);
    write(sheet.sheetId, 57, col, empty);
    expected.push({ range: `${tab}!${letter(col)}72:${letter(col)}85`, values: axiom });
    expected.push({ range: `${tab}!${letter(col)}44:${letter(col)}57`, values: replacement });
    expected.push({ range: `${tab}!${letter(col)}58:${letter(col)}71`, values: empty });
  }
  const headers = values[0].slice(1);
  const lastDataCol = letter(17 + headers.length - 1);
  for (const [rawStart, summaryRow, compactRow] of [[44, 6, 17], [58, 7, 18], [72, 8, 19]]) {
    const noData = title === 'Corrode - Premier' && rawStart === 58;
    for (const [row1, offsets] of [[summaryRow, Array.from({ length: 14 }, (_, i) => i)], [compactRow, [0, 1, 6, 7, 8, 9, 10]]]) {
      requests.push({ updateCells: { start: { sheetId: sheet.sheetId, rowIndex: row1 - 1, columnIndex: 2 }, rows: [{ values: offsets.map(offset => noData ? cell('-') : { userEnteredValue: { formulaValue: `=IFERROR(AVERAGE($R$${rawStart + offset}:$${lastDataCol}$${rawStart + offset})${separator}"-")` } }) }], fields: 'userEnteredValue' } });
    }
  }
}
console.log(JSON.stringify({ spreadsheetId, matchIds: ids, requests: requests.length, sheets: snapshots.map(s => s.title) }));
if (!process.argv.includes('--apply')) {
  console.log('Read-only preview. Add --apply to perform the correction.');
} else {
  for (const before of snapshots) assert.deepEqual(await getValues(spreadsheetId, before.range, 'FORMULA'), before.values, 'Sheet changed during planning');
  await fs.writeFile('/tmp/ovt-corrode-correction-before.json', JSON.stringify(snapshots, null, 2));
  await batchUpdate(spreadsheetId, requests);
  for (const check of expected) {
    const actual = await getValues(spreadsheetId, check.range, 'FORMULA');
    assert.deepEqual(Array.from({ length: 14 }, (_, i) => [actual[i]?.[0] ?? '']), check.values, check.range);
  }
  console.log('PASS: Ax1oM both games -> speak with dead; Ice blue game 1 -> Ax1oM; Ice blue game 2 removed, on map and season sheets.');
}
