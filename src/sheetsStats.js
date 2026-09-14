import { config } from './config.js';
import { LABEL_TO_RIOT_ID } from './statsRoster.js';
import {
  getSpreadsheetMeta,
  getValues,
  getCellNotes,
  batchUpdateValues,
  clearValues,
  batchUpdate,
} from './sheetsClient.js';

// Every "<Map> - <Mode>" tab is cloned from the same single master tab (the
// overall Premier summary — always exists, always has the right base
// layout) rather than from "whichever existing tab happens to match this
// mode" — that used to inherit whatever drift/inconsistency a given
// existing tab had accumulated. Praки mode additionally deletes the master's
// TRS column (meaningless for customs) right after cloning, which shifts
// every later column one letter left — LAYOUT below reflects that shift.
export const OVERALL_PREMIER_TAB = 'Статистика за V26A5';

const BLOCK_SIZE = 14;
const ANCHOR_FIRST_ROW = 2;
const ROSTER_SIZE = 7;
const TABLE1_FIRST_ROW = 3;
const TABLE2_FIRST_ROW = 13;

const STAT_ROWS_PREMIER = [
  'trs', 'acs', 'kills', 'deaths', 'assists', 'plusMinus', 'kdRatio',
  'ddelta', 'adr', 'hsAccuracy', 'kast', 'firstKills', 'firstDeaths', 'multiKills',
];
// offset 0 (the anchor/label row) carries no stat in Praки mode — TRS's
// column got physically deleted, so there's nothing to shift into it.
const STAT_ROWS_PRAKTIKA = [
  null, 'acs', 'kills', 'deaths', 'assists', 'plusMinus', 'kdRatio',
  'ddelta', 'adr', 'hsAccuracy', 'kast', 'firstKills', 'firstDeaths', 'multiKills',
];

const LAYOUT = {
  Premier: {
    anchorColumn: 'Q',
    firstGameColumn: 'R',
    firstStatOffset: 0,
    statRows: STAT_ROWS_PREMIER,
    table1Columns: ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'],
    table2Columns: ['C', 'D', 'E', 'F', 'G', 'H', 'I'],
    table2Stats: ['trs', 'acs', 'kdRatio', 'ddelta', 'adr', 'hsAccuracy', 'kast'],
    table1PercentCols: ['L', 'M'],
    table2PercentCols: ['H', 'I'],
    probeColumn: 'C',
    probeOffset: 0,
  },
  Праки: {
    anchorColumn: 'P',
    firstGameColumn: 'Q',
    firstStatOffset: 1,
    statRows: STAT_ROWS_PRAKTIKA,
    table1Columns: ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'],
    table2Columns: ['C', 'D', 'E', 'F', 'G', 'H'],
    table2Stats: ['acs', 'kdRatio', 'ddelta', 'adr', 'hsAccuracy', 'kast'],
    table1PercentCols: ['K', 'L'],
    table2PercentCols: ['G', 'H'],
    probeColumn: 'C',
    probeOffset: 1,
  },
};

function statOffset(mode, key) {
  return LAYOUT[mode].statRows.indexOf(key);
}
function averageFormula(firstGameColumn, rawRow, endColLetter) {
  return `=AVERAGE($${firstGameColumn}$${rawRow}:$${endColLetter}$${rawRow})`;
}

// Matches the main heatmap header band's color (read off an existing tab).
const HEADER_BG = { red: 0.0627451, green: 0.30588236, blue: 0.28235295 };
const DATA_BG = { red: 0.10588235, green: 0.11764706, blue: 0.15686275 };
const WHITE = { red: 1, green: 1, blue: 1 };

/**
 * Writing "-" (or a formula) via values.batchUpdate's USER_ENTERED mode can
 * silently reset a cell's number format to "Automatic" — seen on HS%/KAST
 * cells that ended up showing a plain fraction (0.25) instead of "25%".
 * Explicitly reapplying PERCENT format on every write sidesteps that
 * regardless of why the format got lost in the first place.
 */
function percentFormatRequests(sheetId, row0List) {
  const requests = [];
  for (const { row0, cols } of row0List) {
    for (const col of cols) {
      const col0 = colToIndex(col) - 1;
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: col0, endColumnIndex: col0 + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0%' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      });
    }
  }
  return requests;
}

/**
 * A "Game N" column's cells are supposed to read white-on-dark — but at
 * least one tab turned out to have the light text color set with no
 * matching background (probably lost to a manual "clear formatting" at some
 * point), making it unreadable. Every write reapplies both explicitly
 * rather than trusting whatever the tab already has.
 */
async function formatGameColumn(spreadsheetId, sheetId, colIndex, matchId) {
  const col0 = colIndex - 1;
  const lastRow0 = ANCHOR_FIRST_ROW - 1 + BLOCK_SIZE * ROSTER_SIZE;
  await batchUpdate(spreadsheetId, [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: col0, endColumnIndex: col0 + 1 },
        cell: {
          userEnteredFormat: { backgroundColor: HEADER_BG, textFormat: { foregroundColor: WHITE, bold: true } },
          note: matchId ?? undefined,
        },
        fields: matchId ? 'userEnteredFormat(backgroundColor,textFormat),note' : 'userEnteredFormat(backgroundColor,textFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: lastRow0, startColumnIndex: col0, endColumnIndex: col0 + 1 },
        cell: { userEnteredFormat: { backgroundColor: DATA_BG, textFormat: { foregroundColor: WHITE } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    },
  ]);
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

  const template = sheets.find((s) => s.title === OVERALL_PREMIER_TAB);
  if (!template) throw new Error(`Master template tab "${OVERALL_PREMIER_TAB}" not found`);
  const layout = LAYOUT[mode];

  // Always append at the very end — tabs are only ever created the first
  // time a map/mode is actually logged, so appending keeps them in the
  // order matches actually happened, with the master tab staying first.
  const dupRes = await batchUpdate(spreadsheetId, [
    {
      duplicateSheet: {
        sourceSheetId: template.sheetId,
        insertSheetIndex: sheets.length,
        newSheetName: tabTitle,
      },
    },
  ]);
  const newSheetId = dupRes.replies[0].duplicateSheet.properties.sheetId;

  if (mode === 'Праки') {
    // The master template tracks TRS (column C) — meaningless for customs.
    // Deleting it (rather than just leaving it blank) shifts every later
    // column one letter left, which is what LAYOUT.Праки's column letters
    // assume from here on.
    await batchUpdate(spreadsheetId, [
      { deleteDimension: { range: { sheetId: newSheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 } } },
    ]);
  }

  // The clone also still has whatever dark "Game N" cell formatting the
  // master had accumulated for its own (much longer) game history —
  // clearValues below only wipes the values, not the formatting, so those
  // extra columns would otherwise sit there as blank dark rectangles. Reset
  // the whole game-column region back to default formatting first; only the
  // columns actually written from here on (via formatGameColumn) get styled.
  const gameAreaStartCol0 = colToIndex(layout.firstGameColumn) - 1;
  const gameAreaLastRow0 = ANCHOR_FIRST_ROW - 1 + BLOCK_SIZE * ROSTER_SIZE;
  await batchUpdate(spreadsheetId, [
    {
      repeatCell: {
        range: { sheetId: newSheetId, startRowIndex: 0, endRowIndex: gameAreaLastRow0, startColumnIndex: gameAreaStartCol0, endColumnIndex: colToIndex('BZ') },
        cell: { userEnteredFormat: {} },
        fields: 'userEnteredFormat',
      },
    },
  ]);

  // The clone still has the master's old per-game data — wipe every game
  // column's header + all 7 players' raw rows (column Q/P player labels are
  // identical for every tab, so those stay).
  await clearValues(spreadsheetId, `'${tabTitle}'!${layout.firstGameColumn}1:BZ${BLOCK_SIZE * ROSTER_SIZE + 2}`);
  // The clone also still has whichever heatmap formulas the master happened
  // to have (real ones for players with games already logged there) —
  // now-orphaned since their source data is gone. Reset every player's
  // heatmap cells to "-" so nothing shows #DIV/0! before it has data.
  await resetHeatmapPlaceholders(spreadsheetId, tabTitle, mode, newSheetId);

  return { sheetId: newSheetId, title: tabTitle, index: sheets.length };
}

/**
 * A tab can end up with stale heatmap formulas pointing at raw data that no
 * longer exists — e.g. someone manually clears a tab back to a blank
 * template without going through resetHeatmapPlaceholders — which shows as
 * #DIV/0! instead of "-". Checking a probe cell per player catches that
 * regardless of how it happened, so appendMatchToStatsSheet can self-heal
 * before writing rather than adding new data on top of a broken sheet.
 */
async function hasHeatmapErrors(spreadsheetId, tabTitle, mode) {
  const layout = LAYOUT[mode];
  const probeCol = layout.table1Columns[0];
  const lastRow = TABLE1_FIRST_ROW + ROSTER_SIZE - 1;
  const values = (await getValues(spreadsheetId, `'${tabTitle}'!${probeCol}${TABLE1_FIRST_ROW}:${probeCol}${lastRow}`)).flat();
  return values.some((v) => typeof v === 'string' && v.startsWith('#'));
}

export async function resetHeatmapPlaceholders(spreadsheetId, tabTitle, mode, sheetId = null) {
  const layout = LAYOUT[mode];
  const data = [];
  const percentRows = [];
  for (let i = 0; i < ROSTER_SIZE; i++) {
    const t1Row = TABLE1_FIRST_ROW + i;
    const t2Row = TABLE2_FIRST_ROW + i;
    data.push({
      range: `'${tabTitle}'!${layout.table1Columns[0]}${t1Row}:${layout.table1Columns[layout.table1Columns.length - 1]}${t1Row}`,
      values: [layout.table1Columns.map(() => '-')],
    });
    data.push({
      range: `'${tabTitle}'!${layout.table2Columns[0]}${t2Row}:${layout.table2Columns[layout.table2Columns.length - 1]}${t2Row}`,
      values: [layout.table2Columns.map(() => '-')],
    });
    percentRows.push({ row0: t1Row - 1, cols: layout.table1PercentCols }, { row0: t2Row - 1, cols: layout.table2PercentCols });
  }
  await batchUpdateValues(spreadsheetId, data);

  const resolvedSheetId = sheetId ?? (await getTabSheetId(spreadsheetId, tabTitle));
  await batchUpdate(spreadsheetId, percentFormatRequests(resolvedSheetId, percentRows));
}

/**
 * Player-block anchor rows are always ANCHOR_FIRST_ROW, +BLOCK_SIZE, +2*BLOCK_SIZE...
 * (fixed by the template, not derived from where text happens to be) — that
 * sidesteps an inconsistency seen across real tabs where the anchor column
 * is blank on some rows, and different tabs label the same player under
 * different (old vs. current) Riot IDs. Every cell in the row is checked
 * against every known label for every player (LABEL_TO_RIOT_ID), and the
 * match is recorded under that player's canonical current Riot ID either way.
 */
async function getPlayerAnchorRows(spreadsheetId, tabTitle, mode) {
  const anchorColumn = LAYOUT[mode].anchorColumn;
  const anchorRowNumbers = Array.from({ length: ROSTER_SIZE }, (_, i) => ANCHOR_FIRST_ROW + i * BLOCK_SIZE);
  const lastRow = anchorRowNumbers[anchorRowNumbers.length - 1];
  const values = await getValues(spreadsheetId, `'${tabTitle}'!${anchorColumn}${ANCHOR_FIRST_ROW}:BZ${lastRow}`);

  const map = new Map();
  for (const rowNumber of anchorRowNumbers) {
    const rowValues = values[rowNumber - ANCHOR_FIRST_ROW] ?? [];
    for (const cell of rowValues) {
      if (typeof cell !== 'string') continue;
      const riotId = LABEL_TO_RIOT_ID.get(cell.toLowerCase());
      if (riotId) {
        map.set(riotId, rowNumber);
        break;
      }
    }
  }
  return map;
}

async function findTargetGameColumn(spreadsheetId, tabTitle, firstAnchorRow, mode, matchId) {
  const layout = LAYOUT[mode];
  const row1 = (await getValues(spreadsheetId, `'${tabTitle}'!${layout.firstGameColumn}1:BZ1`))[0] ?? [];
  const row1Notes = (await getCellNotes(spreadsheetId, `'${tabTitle}'!${layout.firstGameColumn}1:BZ1`))[0] ?? [];

  let lastGameNumber = 0;
  let firstEmptyOffset = -1;
  for (let i = 0; i < row1.length; i++) {
    const cell = row1[i];
    if (matchId && row1Notes[i] === matchId) {
      const m = /Game (\d+)/.exec(cell ?? '');
      return { alreadyLogged: true, gameNumber: m ? Number(m[1]) : null };
    }
    if (!cell) {
      if (firstEmptyOffset === -1) firstEmptyOffset = i;
      continue;
    }
    const m = /Game (\d+)/.exec(cell);
    if (m) lastGameNumber = Math.max(lastGameNumber, Number(m[1]));
  }
  if (firstEmptyOffset === -1) firstEmptyOffset = row1.length;

  const candidateColIndex = colToIndex(layout.firstGameColumn) + firstEmptyOffset;
  const nextGameNumber = lastGameNumber + 1;

  const probeRow = firstAnchorRow + layout.probeOffset;
  const formulaRow = (await getValues(spreadsheetId, `'${tabTitle}'!${layout.probeColumn}${probeRow}`, 'FORMULA'))[0];
  const formula = formulaRow?.[0] ?? '';
  const rangeMatch = /:\$?([A-Z]+)\$?\d+\)/.exec(formula);
  const endColIndex = rangeMatch ? colToIndex(rangeMatch[1]) : candidateColIndex;

  if (candidateColIndex <= endColIndex) {
    return { colIndex: candidateColIndex, gameNumber: nextGameNumber, needsInsert: false, finalEndColIndex: endColIndex };
  }
  // No blank column left inside the AVERAGE range — insert one right before
  // its current end column. Sheets auto-extends the (absolute) range to
  // cover the newly inserted column, so the formulas keep working unchanged.
  return {
    colIndex: endColIndex,
    gameNumber: nextGameNumber,
    needsInsert: true,
    insertBeforeIndex: endColIndex,
    finalEndColIndex: endColIndex + 1,
  };
}

/**
 * Appends one match's per-player stats as a new "Game N" column on a tab,
 * creating it (cloned from the master template) if it doesn't exist yet.
 * Defaults to the "<Map> - <Mode>" tab; pass `tabTitle` to target a fixed
 * tab instead (the "Статистика за V26A5" overall-premier summary, which
 * pools every map's Premier games into one running set of "Game N" columns
 * rather than per-map ones). `players` is buildMatchView's ourTeam/theirTeam
 * player list — only entries recognized as one of our own roster (via
 * statsRoster.js) actually get written; everyone else is silently skipped.
 * `matchId` is stashed as a note on the "Game N" header cell — re-logging
 * the same match (e.g. the same link pasted twice, or across a manual
 * re-run) is detected via that note and skipped rather than added as a
 * duplicate column.
 */
export async function appendMatchToStatsSheet({ mapName, mode, players, matchId, tabTitle = `${mapName} - ${mode}` }) {
  const spreadsheetId = config.statsSpreadsheetId;
  if (!spreadsheetId) throw new Error('STATS_SPREADSHEET_ID is not configured');
  const layout = LAYOUT[mode];

  const sheet = await findOrCreateTab(spreadsheetId, tabTitle, mode);
  if (await hasHeatmapErrors(spreadsheetId, tabTitle, mode)) {
    await resetHeatmapPlaceholders(spreadsheetId, tabTitle, mode, sheet.sheetId);
  }
  const anchorRows = await getPlayerAnchorRows(spreadsheetId, tabTitle, mode);
  if (anchorRows.size === 0) throw new Error(`Tab "${tabTitle}" has no recognizable player rows`);
  const firstAnchorRow = Math.min(...anchorRows.values());

  const targetColumn = await findTargetGameColumn(spreadsheetId, tabTitle, firstAnchorRow, mode, matchId);
  if (targetColumn.alreadyLogged) {
    return { tabTitle, gameNumber: targetColumn.gameNumber, written: [], skipped: [], alreadyLogged: true, sheetId: sheet.sheetId };
  }
  const { colIndex, gameNumber, needsInsert, insertBeforeIndex, finalEndColIndex } = targetColumn;
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
  const endColLetter = indexToCol(finalEndColIndex);

  const written = [];
  const skipped = [];
  const data = [{ range: `'${tabTitle}'!${col}1`, values: [[`Game ${gameNumber}\n(${mapName})`]] }];
  const percentRows = [];

  for (const p of players) {
    const anchorRow = anchorRows.get(p.riotId.toLowerCase());
    if (!anchorRow) {
      skipped.push(p.riotId);
      continue;
    }
    const values = layout.statRows.slice(layout.firstStatOffset).map((key) => [valueForStatKey(p, key)]);
    const startRow = anchorRow + layout.firstStatOffset;
    const endRow = anchorRow + BLOCK_SIZE - 1;
    data.push({ range: `'${tabTitle}'!${col}${startRow}:${col}${endRow}`, values });
    written.push(p.riotId);

    // This player now has at least one game logged on this tab — make sure
    // both heatmap tables show a live formula for them instead of "-"
    // (idempotent: re-writing an already-live formula is harmless).
    const playerIndex = (anchorRow - ANCHOR_FIRST_ROW) / BLOCK_SIZE;
    const t1Row = TABLE1_FIRST_ROW + playerIndex;
    const t1Values = layout.table1Columns.map((_, k) =>
      averageFormula(layout.firstGameColumn, anchorRow + k + layout.firstStatOffset, endColLetter),
    );
    data.push({
      range: `'${tabTitle}'!${layout.table1Columns[0]}${t1Row}:${layout.table1Columns[layout.table1Columns.length - 1]}${t1Row}`,
      values: [t1Values],
    });

    const t2Row = TABLE2_FIRST_ROW + playerIndex;
    const t2Values = layout.table2Stats.map((key) =>
      averageFormula(layout.firstGameColumn, anchorRow + statOffset(mode, key), endColLetter),
    );
    data.push({
      range: `'${tabTitle}'!${layout.table2Columns[0]}${t2Row}:${layout.table2Columns[layout.table2Columns.length - 1]}${t2Row}`,
      values: [t2Values],
    });

    percentRows.push({ row0: t1Row - 1, cols: layout.table1PercentCols }, { row0: t2Row - 1, cols: layout.table2PercentCols });
  }

  await batchUpdateValues(spreadsheetId, data);
  await formatGameColumn(spreadsheetId, sheet.sheetId, colIndex, matchId);
  if (percentRows.length) await batchUpdate(spreadsheetId, percentFormatRequests(sheet.sheetId, percentRows));
  return { tabTitle, gameNumber, written, skipped, sheetId: sheet.sheetId };
}

/** Looks up an existing tab's sheetId (gid) by title — for building sheet links / screenshots without re-deriving the write path. */
export async function getTabSheetId(spreadsheetId, tabTitle) {
  const sheets = await getSpreadsheetMeta(spreadsheetId);
  return sheets.find((s) => s.title === tabTitle)?.sheetId ?? null;
}

/**
 * Week number for the map-week announcement, derived from the sheet itself
 * rather than a separate persisted counter — a standalone counter kept
 * climbing even after the sheet was wiped and rebuilt from scratch, since
 * nothing tied it back to what the sheet actually contained. Counts every
 * "<Map> - Premier" tab (the overall summary excluded) that has at least one
 * logged game — so a freshly rebuilt sheet naturally starts back at 1.
 */
export async function countAnnouncedPremierWeeks(spreadsheetId) {
  const sheets = await getSpreadsheetMeta(spreadsheetId);
  const firstGameColumn = LAYOUT.Premier.firstGameColumn;
  let count = 0;
  for (const s of sheets) {
    if (s.title === OVERALL_PREMIER_TAB || !s.title.endsWith(' - Premier')) continue;
    const row1 = (await getValues(spreadsheetId, `'${s.title}'!${firstGameColumn}1:BZ1`))[0] ?? [];
    if (row1.some((cell) => /Game \d+/.test(cell ?? ''))) count += 1;
  }
  return count;
}
