import fs from 'node:fs';
import { getBrowser, closeBrowser } from '../src/browser.js';
import { getTabSheetId } from '../src/sheetsStats.js';
import { screenshotSheetRange } from '../src/sheetsAnnounce.js';
import { config } from '../src/config.js';

// Renders the same heatmap screenshot sheetsAnnounce.js posts to Telegram,
// but saves it locally instead — for checking the crop before an actual send.
const tabTitle = process.argv[2] || 'Статистика за V26A5';
const outPath = process.argv[3] || '/tmp/sheet-screenshot.png';

const sheetId = await getTabSheetId(config.statsSpreadsheetId, tabTitle);
if (sheetId === null) {
  console.error('tab not found:', tabTitle);
  process.exit(1);
}
try {
  fs.writeFileSync(outPath, await screenshotSheetRange(await getBrowser(), config.statsSpreadsheetId, sheetId));
  console.log('saved to', outPath);
} finally {
  await closeBrowser();
}
