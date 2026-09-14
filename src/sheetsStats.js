import { config } from './config.js';
import { sheetLabelForRiotId } from './statsRoster.js';
import {
  getSpreadsheetMeta,
  getValues,
  updateValues,
  batchUpdateValues,
  clearValues,
  batchUpdate,
} from './sheetsClient.js';

// Fixed template layout (shared by every "<Map> - <Mode>" tab): column Q
// holds a player's label on the first row of their block, columns R onward
// are one per played game, and each player occupies a fixed-size run of rows
// — one row per stat, always in this order — that the sheet's own heatmap
// formulas (=AVERAGE(...)) read from.
const ANCHOR_COLUMN = 'Q';
const FIRST_GAME_COLUMN = 'R';
const BLOCK_SIZE = 14;
const STAT_TABLE1_ROW_OFFSET = 1; // table1's per-player data row = anchor row + 1 (anchor row is the header row for the FIRST player only, but column C on that same row already holds player 1's TRS — see below)
const TABLE1_TRS_COLUMN = 'C';

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

function statValuesForPlayer(p) {
  return [
    p.trs,
    p.acs,
    p.kills,
    p.deaths,
    p.assists,
    p.plusMinus,
    p.kdRatio,
    p.ddelta,
    p.adr,
    p.hsAccuracy / 100,
    p.kast / 100,
    p.firstKills,
    p.firstDeaths,
    p.multiKills,
  ];
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
  await clearValues(spreadsheetId, `'${tabTitle}'!${FIRST_GAME_COLUMN}1:BZ${BLOCK_SIZE * 7 + 2}`);

  return { sheetId: newSheetId, title: tabTitle, index: template.index + 1 };
}

async function getPlayerAnchorRows(spreadsheetId, tabTitle) {
  const values = await getValues(spreadsheetId, `'${tabTitle}'!${ANCHOR_COLUMN}1:${ANCHOR_COLUMN}500`);
  const rows = new Map();
  values.forEach((row, i) => {
    const label = row[0];
    if (label) rows.set(label.toLowerCase(), i + 1); // 1-based sheet row
  });
  return rows;
}

async function findTargetGameColumn(spreadsheetId, tabTitle, firstAnchorRow) {
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
  if (firstEmptyOffset === -1) firstEmptyOffset = row1.length; // sheet had no blanks within the read range at all

  const candidateColIndex = colToIndex(FIRST_GAME_COLUMN) + firstEmptyOffset;
  const nextGameNumber = lastGameNumber + 1;

  const formulaRow = (
    await getValues(spreadsheetId, `'${tabTitle}'!${TABLE1_TRS_COLUMN}${firstAnchorRow + STAT_TABLE1_ROW_OFFSET}`, 'FORMULA')
  )[0];
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

  const sheet = await findOrCreateTab(spreadsheetId, tabTitle, mode);
  const anchorRows = await getPlayerAnchorRows(spreadsheetId, tabTitle);
  if (anchorRows.size === 0) throw new Error(`Tab "${tabTitle}" has no player rows in column ${ANCHOR_COLUMN}`);
  const firstAnchorRow = Math.min(...anchorRows.values());

  const { colIndex, gameNumber, needsInsert, insertBeforeIndex } = await findTargetGameColumn(
    spreadsheetId,
    tabTitle,
    firstAnchorRow,
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

  for (const p of players) {
    const label = sheetLabelForRiotId(p.riotId);
    const anchorRow = label ? anchorRows.get(label.toLowerCase()) : null;
    if (!anchorRow) {
      skipped.push(p.riotId);
      continue;
    }
    const values = statValuesForPlayer(p).map((v) => [v]);
    data.push({ range: `'${tabTitle}'!${col}${anchorRow}:${col}${anchorRow + BLOCK_SIZE - 1}`, values });
    written.push(p.riotId);
  }

  await batchUpdateValues(spreadsheetId, data);
  return { tabTitle, gameNumber, written, skipped };
}
