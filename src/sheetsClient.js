import fs from 'node:fs';
import { JWT } from 'google-auth-library';
import { config } from './config.js';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

let jwtClient = null;
function getJwtClient() {
  if (!jwtClient) {
    const key = JSON.parse(fs.readFileSync(config.googleServiceAccountKeyPath, 'utf8'));
    jwtClient = new JWT({ email: key.client_email, key: key.private_key, scopes: SCOPES });
  }
  return jwtClient;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The free tier's Sheets API quota (60 read requests/min/user) is easy to
// blow through when a batch command ("...следующие премьер матчи:" with a
// handful of links) fires off several reads per match in a tight loop.
// Retrying with backoff on 429 lets a big batch just take longer instead of
// failing partway through.
const MAX_RATE_LIMIT_ATTEMPTS = 6;

async function authedFetch(url, options = {}, attempt = 1) {
  const { token } = await getJwtClient().getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 429 && attempt < MAX_RATE_LIMIT_ATTEMPTS) {
    const waitMs = Math.min(2 ** attempt * 1000, 30_000); // 2s, 4s, 8s, 16s, 30s
    console.warn(`[sheetsClient] 429 rate limited, retrying in ${waitMs}ms (attempt ${attempt}/${MAX_RATE_LIMIT_ATTEMPTS})`);
    await sleep(waitMs);
    return authedFetch(url, options, attempt + 1);
  }
  if (!res.ok) throw new Error(`Sheets API ${res.status} on ${url}: ${JSON.stringify(json)}`);
  return json;
}

/** {sheets: [{properties: {sheetId, title, gridProperties: {rowCount, columnCount}}}]} */
export async function getSpreadsheetMeta(spreadsheetId) {
  const json = await authedFetch(`${BASE}/${spreadsheetId}?fields=sheets.properties`);
  return json.sheets.map((s) => s.properties);
}

/**
 * A1-style range, e.g. "'Haven - Premier'!A1:Z50". Returns a raw values matrix
 * (rows of cells; missing trailing cells are simply absent from that row's
 * array). `valueRenderOption: 'FORMULA'` reads formulas instead of computed
 * values — used to find an AVERAGE range's current end column.
 */
export async function getValues(spreadsheetId, range, valueRenderOption = 'FORMATTED_VALUE') {
  const json = await authedFetch(
    `${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=${valueRenderOption}`,
  );
  return json.values ?? [];
}

export async function updateValues(spreadsheetId, range, values) {
  return authedFetch(
    `${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', body: JSON.stringify({ range, values }) },
  );
}

/** data: [{range, values}] — writes several disjoint ranges in one call. */
export async function batchUpdateValues(spreadsheetId, data) {
  return authedFetch(`${BASE}/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
  });
}

export async function clearValues(spreadsheetId, range) {
  return authedFetch(`${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`, { method: 'POST' });
}

/** Cell notes for an A1 range (row-major, same shape as getValues) — used to stash a match id on its "Game N" header cell so re-logging the same match can be detected. */
export async function getCellNotes(spreadsheetId, range) {
  const json = await authedFetch(
    `${BASE}/${spreadsheetId}?ranges=${encodeURIComponent(range)}&fields=sheets.data.rowData.values.note`,
  );
  const rowData = json.sheets?.[0]?.data?.[0]?.rowData ?? [];
  return rowData.map((row) => (row.values ?? []).map((v) => v.note ?? null));
}

/** Developer metadata is invisible in the Sheets UI (unlike a cell note) — used to stash bot-internal bookkeeping. Returns every {developerMetadata: {metadataId, metadataValue, location: {sheetId}, ...}} entry matching this key across the whole spreadsheet. */
export async function searchDeveloperMetadata(spreadsheetId, metadataKey) {
  const json = await authedFetch(`${BASE}/${spreadsheetId}/developerMetadata:search`, {
    method: 'POST',
    body: JSON.stringify({ dataFilters: [{ developerMetadataLookup: { metadataKey } }] }),
  });
  return json.matchedDeveloperMetadata ?? [];
}

export async function batchUpdate(spreadsheetId, requests) {
  return authedFetch(`${BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests }),
  });
}
