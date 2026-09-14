import { getSpreadsheetMeta, getValues } from '../src/sheetsClient.js';
import { config } from '../src/config.js';

// Dumps tab names + a sample values range, to confirm the stats sheet's
// column/row layout before wiring up the write path.
const spreadsheetId = config.statsSpreadsheetId;
const tabTitle = process.argv[2] || 'Haven - Premier';

const sheets = await getSpreadsheetMeta(spreadsheetId);
console.log('tabs:', sheets.map((s) => s.title).join(', '));

const target = sheets.find((s) => s.title === tabTitle);
console.log('target sheet properties:', target);

const values = await getValues(spreadsheetId, `'${tabTitle}'!A1:AB20`);
values.forEach((row, i) => console.log(i + 1, JSON.stringify(row)));
