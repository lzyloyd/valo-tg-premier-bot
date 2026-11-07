import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { config } from '../src/config.js';
import { getSpreadsheetMeta, getSpreadsheetDetails, batchUpdate } from '../src/sheetsClient.js';

const id = config.statsSpreadsheetId;
assert.equal(id, '1mFUXQPeRIdtSuRKhYUXvqG1W0dLj-NzIc7Q76SMC-wg');
const metadata = await getSpreadsheetMeta(id);
function column(n) { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }
const ranges = metadata.map(s => `'${s.title.replaceAll("'", "''")}'!B1:${column(s.gridProperties.columnCount - 1)}117`);
const fields = 'sheets(properties,merges,conditionalFormats,data(startRow,startColumn,rowMetadata,rowData))';
const before = await getSpreadsheetDetails(id, ranges, fields);
const cell = (sheet, row, col) => sheet.data?.[0]?.rowData?.[row]?.values?.[col - 1] ?? {};
const requests = [];
for (const sheet of before.sheets) {
  assert(sheet.properties.title === 'Статистика за V26A5' || / - (Premier|Праки)$/.test(sheet.properties.title));
  const endColumnIndex = sheet.properties.title.endsWith(' - Праки') ? 15 : 16;
  assert.equal(cell(sheet, 13, 1).formattedValue, 'Space Kururugi', 'Expected old compact-table layout');
  assert.equal(cell(sheet, 21, 1).formattedValue, 'Целевой показатель');
  for (const row of [9, 20]) for (let col = 1; col < endColumnIndex; col++) assert(!cell(sheet, row, col).userEnteredValue, 'Row is not empty');
  // Bottom first, so the first deletion cannot change the second index.
  for (const row of [20, 9]) requests.push({ deleteRange: {
    range: { sheetId: sheet.properties.sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 1, endColumnIndex }, shiftDimension: 'ROWS',
  } });
  // Keep target-value heatmap colors tied to the moved footer as well.
  // Explicit updates avoid depending on how Sheets rewrites rule strings.
  for (const [index, original] of (sheet.conditionalFormats ?? []).entries()) {
    const rule = JSON.parse(JSON.stringify(original));
    const boundary = n => n - Number(n > 9) - Number(n > 20);
    for (const range of rule.ranges) {
      assert(range.startColumnIndex >= 1 && range.endColumnIndex <= endColumnIndex);
      if (range.startRowIndex !== undefined) range.startRowIndex = boundary(range.startRowIndex);
      if (range.endRowIndex !== undefined) range.endRowIndex = boundary(range.endRowIndex);
    }
    for (const point of Object.values(rule.gradientRule ?? {})) if (typeof point?.value === 'string') point.value = point.value.replace(/(\$[A-Z]+\$)22\b/g, (_, prefix) => `${prefix}20`);
    requests.push({ updateConditionalFormatRule: { sheetId: sheet.properties.sheetId, index, rule } });
  }
}
console.log(JSON.stringify({ sheets: before.sheets.map(s => s.properties.title), action: 'Delete empty player cells in rows 21 and 10, within left heatmaps only', requests: requests.length }));
if (!process.argv.includes('--apply')) {
  console.log('Preview only. Add --apply to compact the heatmaps.');
} else {
  await fs.writeFile('/tmp/ovt-heatmaps-before-compaction.json', JSON.stringify(before));
  await batchUpdate(id, requests);
  const after = await getSpreadsheetDetails(id, ranges, fields);
  for (const sheet of after.sheets) {
    const old = before.sheets.find(s => s.properties.sheetId === sheet.properties.sheetId);
    const rawStart = sheet.properties.title.endsWith(' - Праки') ? 15 : 16;
    assert.equal(cell(sheet, 12, 1).formattedValue, 'Space Kururugi');
    assert.equal(cell(sheet, 18, 1).formattedValue, 'Mench Lamperouge');
    assert.equal(cell(sheet, 19, 1).formattedValue, 'Целевой показатель');
    for (let row = 0; row < 115; row++) for (let col = 1; col < sheet.properties.gridProperties.columnCount; col++) {
      const oldRow = col < rawStart ? row < 9 ? row : row < 19 ? row + 1 : row + 2 : row;
      const a = cell(old, oldRow, col), b = cell(sheet, row, col);
      for (const key of ['userEnteredValue', 'formattedValue', 'note', 'userEnteredFormat', 'textFormatRuns']) {
        assert.deepEqual(b[key], a[key], `${sheet.properties.title}!${column(col)}${row + 1} ${key}`);
      }
      assert(!b.userEnteredValue?.formulaValue?.includes('#REF!'), 'Broken reference');
    }
    for (const rule of sheet.conditionalFormats ?? []) {
      const midpoint = rule.gradientRule?.midpoint?.value;
      assert(!midpoint || !/\$[A-Z]+\$22/.test(midpoint), 'Stale target-row reference in heatmap colors');
    }
  }
  console.log(`PASS: ${after.sheets.length} tabs compacted; every shifted formula, calculated value, format and raw match cell verified.`);
}
