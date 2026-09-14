import { getBrowser, closeBrowser } from '../src/browser.js';
import { getTabSheetId } from '../src/sheetsStats.js';
import { config } from '../src/config.js';
import fs from 'node:fs';

// Renders the same "heatmap range" screenshot sheetsAnnounce.js posts to
// Telegram, but saves it locally instead — for checking the crop/rendering
// before risking an actual send to the real "Статистика" topic.
const tabTitle = process.argv[2] || 'Статистика за V26A5';
const range = process.argv[3] || 'B1:P20';

const sheetId = await getTabSheetId(config.statsSpreadsheetId, tabTitle);
if (sheetId === null) {
  console.error('tab not found:', tabTitle);
  process.exit(1);
}

const browser = await getBrowser();
const page = await browser.newPage();
try {
  await page.setViewport({ width: 1500, height: 650 });
  const url = `https://docs.google.com/spreadsheets/d/${config.statsSpreadsheetId}/edit?gid=${sheetId}&range=${range}&rm=minimal`;
  console.log('navigating to', url);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.mouse.click(105, 30);
  await new Promise((r) => setTimeout(r, 200));
  const png = await page.screenshot({ type: 'png' });
  fs.writeFileSync('/tmp/sheet-screenshot.png', png);
  console.log('saved to /tmp/sheet-screenshot.png');
} finally {
  await page.close();
  await closeBrowser();
}
