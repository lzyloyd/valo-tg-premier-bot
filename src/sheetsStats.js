import { config } from './config.js';
import { sheetLabelForRiotId, KNOWN_SHEET_LABELS_LOWER } from './statsRoster.js';
import {
  getSpreadsheetMeta,
  getValues,
  batchUpdateValues,
  clearValues,
  batchUpdate,
} from './sheetsClient.js';

// Fixed template layout (shared by every "<Map> - <Mode>" tab): column Q
// normally holds a player's label on the first row of their 14-row block —
// one row per stat, in a fixed order the sheet's own =AVERAGE(...) heatmap
// formulas read from — and columns R onward are one per played game.
//
// Premier tabs track TRS, so that first (label) row doubles as the TRS row.
// Practice ("Праки") tabs don't — TRS is meaningless for customs — so their
// block's first row is label-only (no stat lives there) and every stat
// shifts down one row. `null` marks that skipped slot below.
const ANCHOR_COLUMN = 'Q';
const FIRST_GAME_COLUMN = 'R';
const BLOCK_SIZE = 14;
const ANCHOR_FIRST_ROW = 2;
const ROSTER_SIZE = 7;

const STAT_ROWS_PREMIER = [
  'trs', 'acs', 'kills', 'deaths', 'assists', 'plusMinus', 'kdRatio',
  'ddelta', 'adr', 'hsAccuracy', 'kast', 'firstKills', 'firstDeaths', 'multiKills',
];
const STAT_ROWS_PRAKTIKA = [
  null, 'acs', 'kills', 'deaths', 'assists', 'plusMinus', 'kdRatio',
  'ddelta', 'adr', 'hsAccuracy', 'kast', 'firstKills', 'firstDeaths', 'multiKills',
];
// Column probed to find the current AVERAGE(...) range's end column — must
// be a stat that's actually present on offset 0/1 for that mode.
const PROBE_COLUMN = { Premier: 'C', Праки: 'D' };
const PROBE_OFFSET = { Premier: 0, Праки: 1 };

function statRowsForMode(mode) {
  return mode === 'Premier' ? STAT_ROWS_PREMIER : STAT_ROWS_PRAKTIKA;
}

function valueForStatKey(p, key) {
  switch (key) {
    case 'trs': return p.trs;
    case 'acs': return p.acs;
    case 'kills': return p.kills;
    case 'deaths': return p.deaths;
    case 'assists': return p.assists;
    case 'plusMinus': return p.plusMinus;
    case 'kdRatio': return p.kdRatio;
    case 'ddelta': return p.ddelta;
    case 'adr': return p.adr;
    case 'hsAccuracy': return p.hsAccuracy / 100; // sheet stores percentages as fractions
    case 'kast': return p.kast / 100;
    case 'firstKills': return p.firstKills;
    case 'firstDeaths': return p.firstDeaths;
    case 'multiKills': return p.multiKills;
    default: throw new Error(`unknown stat key: ${key}`);
  }
}

function colToIndex(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function indexToCol(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function findOrCreateTab(spreadsheetId, tabTitle, mode) {
  const sheets = await getSpreadsheetMeta(spreadsheetId);
  const existing = sheets.find((s) => s.title === tabTitle);
  if (existing) return existing;

  const template = sheets.find((s) => s.title.endsWith(` - ${mode}`)) ?? sheets.find((s) => s.title !== sheets[0].title);
  if (!template) throw new Error(`No template tab found to clone for a new "${tabTitle}" tab`);

  const dupRes = await batchUpdate(spreadsheetId, [
    {
      duplicateSheet: {
        sourceSheetId: template.sheetId,
        insertSheetIndex: template.index + 1,
        newSheetName: tabTitle,
      },
    },
  ]);
  const newSheetId = dupRes.replies[0].duplicateSheet.properties.sheetId;

  // The clone still has the template map's old per-game data — wipe every
  // game column's header + all 7 players' raw rows, but leave the heatmap
  // formulas and the column Q player labels (identical for every tab) intact.
  await clearValues(spreadsheetId, `'${tabTitle}'!${FIRST_GAME_COLUMN}1:BZ${BLOCK_SIZE * ROSTER_SIZE + 2}`);

  return { sheetId: newSheetId, title: tabTitle, index: template.index + 1 };
}

/**
 * Player-block anchor rows are always ANCHOR_FIRST_ROW, +BLOCK_SIZE, +2*BLOCK_SIZE...
 * (fixed by the template, not derived from where text happens to be) — that
 * sidesteps an inconsistency seen on a real tab where column Q was blank for
 * one player's row while every other player's label was present there. The
 * label is read from column Q first, falling back to any known-label text
 * elsewhere in that row (game columns sometimes carry the same label too).
 */
async function getPlayerAnchorRows(spreadsheetId, tabTitle) {
  const anchorRowNumbers = Array.from({ length: ROSTER_SIZE }, (_, i) => ANCHOR_FIRST_ROW + i * BLOCK_SIZE);
  const lastRow = anchorRowNumbers[anchorRowNumbers.length - 1];
  const values = await getValues(spreadsheetId, `'${tabTitle}'!${ANCHOR_COLUMN}${ANCHOR_FIRST_ROW}:BZ${lastRow}`);

  const map = new Map();
  for (const rowNumber of anchorRowNumbers) {
    const rowValues = values[rowNumber - ANCHOR_FIRST_ROW] ?? [];
    const label = rowValues.find((cell) => typeof cell === 'string' && KNOWN_SHEET_LABELS_LOWER.has(cell.toLowerCase()));
    if (label) map.set(label.toLowerCase(), rowNumber);
  }
  return map;
}

async function findTargetGameColumn(spreadsheetId, tabTitle, firstAnchorRow, mode) {
  const row1 = (await getValues(spreadsheetId, `'${tabTitle}'!${FIRST_GAME_COLUMN}1:BZ1`))[0] ?? [];
  let lastGameNumber = 0;
  let firstEmptyOffset = -1;
  for (let i = 0; i < row1.length; i++) {
    const cell = row1[i];
    if (!cell) {
      if (firstEmptyOffset === -1) firstEmptyOffset = i;
      continue;
    }
    const m = /Game (\d+)/.exec(cell);
    if (m) lastGameNumber = Math.max(lastGameNumber, Number(m[1]));
  }
  if (firstEmptyOffset === -1) firstEmptyOffset = row1.length;

  const candidateColIndex = colToIndex(FIRST_GAME_COLUMN) + firstEmptyOffset;
  const nextGameNumber = lastGameNumber + 1;

  const probeRow = firstAnchorRow + PROBE_OFFSET[mode];
  const formulaRow = (await getValues(spreadsheetId, `'${tabTitle}'!${PROBE_COLUMN[mode]}${probeRow}`, 'FORMULA'))[0];
  const formula = formulaRow?.[0] ?? '';
  const rangeMatch = /:\$?([A-Z]+)\$?\d+\)/.exec(formula);
  const endColIndex = rangeMatch ? colToIndex(rangeMatch[1]) : candidateColIndex;

  if (candidateColIndex <= endColIndex) {
    return { colIndex: candidateColIndex, gameNumber: nextGameNumber, needsInsert: false };
  }
  // No blank column left inside the AVERAGE range — insert one right before
  // its current end column. Sheets auto-extends the (absolute) range to
  // cover the newly inserted column, so the formulas keep working unchanged.
  return { colIndex: endColIndex, gameNumber: nextGameNumber, needsInsert: true, insertBeforeIndex: endColIndex };
}

/**
 * Appends one match's per-player stats as a new "Game N" column on the
 * relevant "<Map> - <Mode>" tab, creating the tab if this map/mode hasn't
 * been logged before. `players` is buildMatchView's ourTeam/theirTeam player
 * list — only entries recognized as one of our own roster (via
 * statsRoster.js) actually get written; everyone else is silently skipped.
 */
export async function appendMatchToStatsSheet({ mapName, mode, players }) {
  const spreadsheetId = config.statsSpreadsheetId;
  if (!spreadsheetId) throw new Error('STATS_SPREADSHEET_ID is not configured');
  const tabTitle = `${mapName} - ${mode}`;
  const statRows = statRowsForMode(mode);

  const sheet = await findOrCreateTab(spreadsheetId, tabTitle, mode);
  const anchorRows = await getPlayerAnchorRows(spreadsheetId, tabTitle);
  if (anchorRows.size === 0) throw new Error(`Tab "${tabTitle}" has no recognizable player rows`);
  const firstAnchorRow = Math.min(...anchorRows.values());

  const { colIndex, gameNumber, needsInsert, insertBeforeIndex } = await findTargetGameColumn(
    spreadsheetId,
    tabTitle,
    firstAnchorRow,
    mode,
  );
  if (needsInsert) {
    await batchUpdate(spreadsheetId, [
      {
        insertDimension: {
          range: { sheetId: sheet.sheetId, dimension: 'COLUMNS', startIndex: insertBeforeIndex - 1, endIndex: insertBeforeIndex },
          inheritFromBefore: true,
        },
      },
    ]);
  }
  const col = indexToCol(colIndex);

  const written = [];
  const skipped = [];
  const data = [{ range: `'${tabTitle}'!${col}1`, values: [[`Game ${gameNumber}\n(${mapName})`]] }];

  const firstStatOffset = statRows[0] === null ? 1 : 0;
  for (const p of players) {
    const label = sheetLabelForRiotId(p.riotId);
    const anchorRow = label ? anchorRows.get(label.toLowerCase()) : null;
    if (!anchorRow) {
      skipped.push(p.riotId);
      continue;
    }
    const values = statRows.slice(firstStatOffset).map((key) => [valueForStatKey(p, key)]);
    const startRow = anchorRow + firstStatOffset;
    const endRow = anchorRow + BLOCK_SIZE - 1;
    data.push({ range: `'${tabTitle}'!${col}${startRow}:${col}${endRow}`, values });
    written.push(p.riotId);
  }

  await batchUpdateValues(spreadsheetId, data);
  return { tabTitle, gameNumber, written, skipped };
}
