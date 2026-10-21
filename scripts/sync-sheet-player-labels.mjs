import { config } from '../src/config.js';
import { batchUpdate, getSpreadsheetMeta } from '../src/sheetsClient.js';
import { ROSTER, displayName, trackerProfileUrl } from '../src/statsRoster.js';
import {
  OVERALL_PREMIER_TAB, ANCHOR_FIRST_ROW, BLOCK_SIZE, ROSTER_SIZE, TABLE1_FIRST_ROW, TABLE2_FIRST_ROW,
} from '../src/sheetsStats.js';

// Rewrites every player label on the master stats tab (both heatmap tables'
// "Player" column B and the game-area anchors in column Q) from statsRoster.js:
// the nickname without its #tag, linked to that player's tracker.gg profile.
// Run after any roster change; new map tabs are cloned from the master.
//   node scripts/sync-sheet-player-labels.mjs
if (ROSTER.length !== ROSTER_SIZE) {
  throw new Error(`statsRoster has ${ROSTER.length} players but the sheet layout expects ${ROSTER_SIZE}`);
}

const spreadsheetId = config.statsSpreadsheetId;
const sheet = (await getSpreadsheetMeta(spreadsheetId)).find((s) => s.title === OVERALL_PREMIER_TAB);
if (!sheet) throw new Error(`Tab "${OVERALL_PREMIER_TAB}" not found`);

const LINK_COLOR = { red: 0.06666667, green: 0.33333334, blue: 0.8 };
const linkedCell = (riotId) => ({
  userEnteredValue: { stringValue: displayName(riotId) },
  textFormatRuns: [{ startIndex: 0, format: { link: { uri: trackerProfileUrl(riotId) }, underline: true, foregroundColorStyle: { rgbColor: LINK_COLOR } } }],
});
const writeCell = (row1, col0, riotId) => ({
  updateCells: {
    start: { sheetId: sheet.sheetId, rowIndex: row1 - 1, columnIndex: col0 },
    rows: [{ values: [linkedCell(riotId)] }],
    fields: 'userEnteredValue,textFormatRuns',
  },
});

const COL_B = 1;
const COL_Q = 16;
const requests = ROSTER.flatMap(({ riotId }, i) => [
  writeCell(TABLE1_FIRST_ROW + i, COL_B, riotId),
  writeCell(TABLE2_FIRST_ROW + i, COL_B, riotId),
  writeCell(ANCHOR_FIRST_ROW + i * BLOCK_SIZE, COL_Q, riotId),
]);
await batchUpdate(spreadsheetId, requests);
for (const { riotId } of ROSTER) console.log(`${displayName(riotId)} -> ${trackerProfileUrl(riotId)}`);
