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

async function authedFetch(url, options = {}) {
  const { token } = await getJwtClient().getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Sheets API ${res.status} on ${url}: ${JSON.stringify(json)}`);
  return json;
}

/** {sheets: [{properties: {sheetId, title, gridProperties: {rowCount, columnCount}}}]} */
export async function getSpreadsheetMeta(spreadsheetId) {
  const json = await authedFetch(`${BASE}/${spreadsheetId}?fields=sheets.properties`);
  return json.sheets.map((s) => s.properties);
}

/** A1-style range, e.g. "'Haven - Premier'!A1:Z50". Returns a raw values matrix (rows of cells; missing trailing cells are simply absent from that row's array). */
export async function getValues(spreadsheetId, range) {
  const json = await authedFetch(`${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`);
  return json.values ?? [];
}

export async function updateValues(spreadsheetId, range, values) {
  return authedFetch(
    `${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', body: JSON.stringify({ range, values }) },
  );
}

export async function batchUpdate(spreadsheetId, requests) {
  return authedFetch(`${BASE}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests }),
  });
}
