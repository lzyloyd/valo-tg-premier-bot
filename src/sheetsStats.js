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

// Pools every map's Premier games into one running set of "Game N" columns,
// alongside (not derived from) the per-map "<Map> - Premier" tabs — Praки
// matches have no equivalent overall tab.
export const OVERALL_PREMIER_TAB = 'Статистика за V26A5';

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

// The two heatmap tables' per-player row numbers (fixed, same for every
// tab) and which columns they show — table1 is every stat, table2 a
// narrower "highlights" subset. Both read the exact same raw stat rows as
// appendMatchToStatsSheet writes; a brand new tab has no data yet for
// anyone, so every one of these cells starts out as a literal "-" (matching
// the sheet's existing convention for "hasn't played this map/mode") and
// only gets a real =AVERAGE(...) formula once that player actually has a
// game logged — otherwise a cloned tab's inherited formula errors out to
// #DIV/0! the moment its source data is cleared.
const TABLE1_FIRST_ROW = 3;
const TABLE1_COLUMNS_PREMIER = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'];
const TABLE1_COLUMNS_PRAKTIKA = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'];
const TABLE2_FIRST_ROW = 13;
const TABLE2_COLUMNS_PREMIER = ['C', 'D', 'E', 'F', 'G', 'H', 'I'];
const TABLE2_STATS_PREMIER = ['trs', 'acs', 'kdRatio', 'ddelta', 'adr', 'hsAccuracy', 'kast'];
const TABLE2_COLUMNS_PRAKTIKA = ['D', 'E', 'F', 'G', 'H', 'I'];
const TABLE2_STATS_PRAKTIKA = ['acs', 'kdRatio', 'ddelta', 'adr', 'hsAccuracy', 'kast'];

function statRowsForMode(mode) {
  return mode === 'Premier' ? STAT_ROWS_PREMIER : STAT_ROWS_PRAKTIKA;
}
function statOffset(mode, key) {
  return statRowsForMode(mode).indexOf(key);
}
function averageFormula(rawRow, endColLetter) {
  return `=AVERAGE($${FIRST_GAME_COLUMN}$${rawRow}:$${endColLetter}$${rawRow})`;
}

// Matches the main heatmap header band's color (read off an existing tab).
const HEADER_BG = { red: 0.0627451, green: 0.30588236, blue: 0.28235295 };
const DATA_BG = { red: 0.10588235, green: 0.11764706, blue: 0.15686275 };
const WHITE = { red: 1, green: 1, blue: 1 };

// HS%/KAST land in the same columns in both tables regardless of mode.
const TABLE1_PERCENT_COLS = ['L', 'M'];
const TABLE2_PERCENT_COLS = ['H', 'I'];

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

  const template = sheets.find((s) => s.title.endsWith(` - ${mode}`)) ?? sheets.find((s) => s.title !== sheets[0].title);
  if (!template) throw new Error(`No template tab found to clone for a new "${tabTitle}" tab`);

  // Always append at the very end (never right after the template) — tabs
  // are only ever created the first time a map/mode is actually logged, so
  // appending keeps them in the order matches actually happened, with the
  // overall summary tab (created once, up front) staying first.
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

  // The clone still has the template map's old per-game data — wipe every
  // game column's header + all 7 players' raw rows (column Q player labels
  // are identical for every tab, so those stay).
  await clearValues(spreadsheetId, `'${tabTitle}'!${FIRST_GAME_COLUMN}1:BZ${BLOCK_SIZE * ROSTER_SIZE + 2}`);
  // The clone also still has whichever heatmap formulas the template
  // happened to have (real ones for players who'd played that map before) —
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
  const probeCol = mode === 'Premier' ? TABLE1_COLUMNS_PREMIER[0] : TABLE1_COLUMNS_PRAKTIKA[0];
  const lastRow = TABLE1_FIRST_ROW + ROSTER_SIZE - 1;
  const values = (await getValues(spreadsheetId, `'${tabTitle}'!${probeCol}${TABLE1_FIRST_ROW}:${probeCol}${lastRow}`)).flat();
  return values.some((v) => typeof v === 'string' && v.startsWith('#'));
}

export async function resetHeatmapPlaceholders(spreadsheetId, tabTitle, mode, sheetId = null) {
  const table1Cols = mode === 'Premier' ? TABLE1_COLUMNS_PREMIER : TABLE1_COLUMNS_PRAKTIKA;
  const table2Cols = mode === 'Premier' ? TABLE2_COLUMNS_PREMIER : TABLE2_COLUMNS_PRAKTIKA;
  const data = [];
  const percentRows = [];
  for (let i = 0; i < ROSTER_SIZE; i++) {
    const t1Row = TABLE1_FIRST_ROW + i;
    const t2Row = TABLE2_FIRST_ROW + i;
    data.push({
      range: `'${tabTitle}'!${table1Cols[0]}${t1Row}:${table1Cols[table1Cols.length - 1]}${t1Row}`,
      values: [table1Cols.map(() => '-')],
    });
    data.push({
      range: `'${tabTitle}'!${table2Cols[0]}${t2Row}:${table2Cols[table2Cols.length - 1]}${t2Row}`,
      values: [table2Cols.map(() => '-')],
    });
    percentRows.push({ row0: t1Row - 1, cols: TABLE1_PERCENT_COLS }, { row0: t2Row - 1, cols: TABLE2_PERCENT_COLS });
  }
  await batchUpdateValues(spreadsheetId, data);

  const resolvedSheetId = sheetId ?? (await getTabSheetId(spreadsheetId, tabTitle));
  await batchUpdate(spreadsheetId, percentFormatRequests(resolvedSheetId, percentRows));
}

/**
 * Player-block anchor rows are always ANCHOR_FIRST_ROW, +BLOCK_SIZE, +2*BLOCK_SIZE...
 * (fixed by the template, not derived from where text happens to be) — that
 * sidesteps an inconsistency seen across real tabs where column Q is blank
 * on some rows, and different tabs label the same player under different
 * (old vs. current) Riot IDs. Every cell in the row is checked against every
 * known label for every player (LABEL_TO_RIOT_ID), and the match is recorded
 * under that player's canonical current Riot ID either way.
 */
async function getPlayerAnchorRows(spreadsheetId, tabTitle) {
  const anchorRowNumbers = Array.from({ length: ROSTER_SIZE }, (_, i) => ANCHOR_FIRST_ROW + i * BLOCK_SIZE);
  const lastRow = anchorRowNumbers[anchorRowNumbers.length - 1];
  const values = await getValues(spreadsheetId, `'${tabTitle}'!${ANCHOR_COLUMN}${ANCHOR_FIRST_ROW}:BZ${lastRow}`);

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
  const row1 = (await getValues(spreadsheetId, `'${tabTitle}'!${FIRST_GAME_COLUMN}1:BZ1`))[0] ?? [];
  const row1Notes = (await getCellNotes(spreadsheetId, `'${tabTitle}'!${FIRST_GAME_COLUMN}1:BZ1`))[0] ?? [];

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

  const candidateColIndex = colToIndex(FIRST_GAME_COLUMN) + firstEmptyOffset;
  const nextGameNumber = lastGameNumber + 1;

  const probeRow = firstAnchorRow + PROBE_OFFSET[mode];
  const formulaRow = (await getValues(spreadsheetId, `'${tabTitle}'!${PROBE_COLUMN[mode]}${probeRow}`, 'FORMULA'))[0];
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
 * creating it (cloned from an existing same-mode tab) if it doesn't exist
 * yet. Defaults to the "<Map> - <Mode>" tab; pass `tabTitle` to target a
 * fixed tab instead (the "Статистика за V26A5" overall-premier summary,
 * which pools every map's Premier games into one running set of "Game N"
 * columns rather than per-map ones). `players` is buildMatchView's
 * ourTeam/theirTeam player list — only entries recognized as one of our own
 * roster (via statsRoster.js) actually get written; everyone else is
 * silently skipped. `matchId` is stashed as a note on the "Game N" header
 * cell — re-logging the same match (e.g. the same link pasted twice, or
 * across a manual re-run) is detected via that note and skipped rather than
 * added as a duplicate column.
 */
export async function appendMatchToStatsSheet({ mapName, mode, players, matchId, tabTitle = `${mapName} - ${mode}` }) {
  const spreadsheetId = config.statsSpreadsheetId;
  if (!spreadsheetId) throw new Error('STATS_SPREADSHEET_ID is not configured');
  const statRows = statRowsForMode(mode);

  const sheet = await findOrCreateTab(spreadsheetId, tabTitle, mode);
  if (await hasHeatmapErrors(spreadsheetId, tabTitle, mode)) {
    await resetHeatmapPlaceholders(spreadsheetId, tabTitle, mode, sheet.sheetId);
  }
  const anchorRows = await getPlayerAnchorRows(spreadsheetId, tabTitle);
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

  const table1Cols = mode === 'Premier' ? TABLE1_COLUMNS_PREMIER : TABLE1_COLUMNS_PRAKTIKA;
  const table2Cols = mode === 'Premier' ? TABLE2_COLUMNS_PREMIER : TABLE2_COLUMNS_PRAKTIKA;
  const table2Stats = mode === 'Premier' ? TABLE2_STATS_PREMIER : TABLE2_STATS_PRAKTIKA;

  const written = [];
  const skipped = [];
  const data = [{ range: `'${tabTitle}'!${col}1`, values: [[`Game ${gameNumber}\n(${mapName})`]] }];
  const percentRows = [];

  const firstStatOffset = statRows[0] === null ? 1 : 0;
  for (const p of players) {
    const anchorRow = anchorRows.get(p.riotId.toLowerCase());
    if (!anchorRow) {
      skipped.push(p.riotId);
      continue;
    }
    const values = statRows.slice(firstStatOffset).map((key) => [valueForStatKey(p, key)]);
    const startRow = anchorRow + firstStatOffset;
    const endRow = anchorRow + BLOCK_SIZE - 1;
    data.push({ range: `'${tabTitle}'!${col}${startRow}:${col}${endRow}`, values });
    written.push(p.riotId);

    // This player now has at least one game logged on this tab — make sure
    // both heatmap tables show a live formula for them instead of "-"
    // (idempotent: re-writing an already-live formula is harmless).
    const playerIndex = (anchorRow - ANCHOR_FIRST_ROW) / BLOCK_SIZE;
    const t1Row = TABLE1_FIRST_ROW + playerIndex;
    const t1Values = table1Cols.map((_, k) => averageFormula(anchorRow + k + firstStatOffset, endColLetter));
    data.push({ range: `'${tabTitle}'!${table1Cols[0]}${t1Row}:${table1Cols[table1Cols.length - 1]}${t1Row}`, values: [t1Values] });

    const t2Row = TABLE2_FIRST_ROW + playerIndex;
    const t2Values = table2Stats.map((key) => averageFormula(anchorRow + statOffset(mode, key), endColLetter));
    data.push({ range: `'${tabTitle}'!${table2Cols[0]}${t2Row}:${table2Cols[table2Cols.length - 1]}${t2Row}`, values: [t2Values] });

    percentRows.push({ row0: t1Row - 1, cols: TABLE1_PERCENT_COLS }, { row0: t2Row - 1, cols: TABLE2_PERCENT_COLS });
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
