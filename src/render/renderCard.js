import { buildScoreboardHtml } from './template.js';

export async function renderScoreboardPng(browser, match) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 780, height: 900, deviceScaleFactor: 2 });
    await page.setContent(buildScoreboardHtml(match), { waitUntil: 'networkidle0' });
    const card = await page.$('#card');
    return await card.screenshot({ type: 'png' });
  } finally {
    await page.close();
  }
}
