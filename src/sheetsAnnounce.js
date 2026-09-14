import { config } from './config.js';
import { sendPhotoTo } from './telegram.js';
import { incrementStatsWeekCounter } from './statsWeekCounter.js';

function escapeHtml(str) {
  return String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function sheetRangeUrl(spreadsheetId, gid, range) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}&range=${range}`;
}

// Both heatmap tables (rows 1-20, columns B-P covers every stat column
// either mode uses) — same crop the team already takes by hand.
const HEATMAP_RANGE = 'B1:P20';

async function screenshotSheetRange(browser, spreadsheetId, gid, range) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1650, height: 650 });
    // rm=minimal drops Sheets' own menu/toolbar chrome — this is the same
    // param Google's "publish to the web" embeds use.
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}&range=${range}&rm=minimal`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
    await new Promise((resolve) => setTimeout(resolve, 1500)); // grid/heatmap colors finish painting after load fires
    // The range= param also selects it (blue highlight + a sum/count bar) —
    // clicking a single already-visible cell clears that without disturbing
    // scroll position the way Escape does (Escape recentered on A1 instead).
    await page.mouse.click(105, 124);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return await page.screenshot({ type: 'png' });
  } finally {
    await page.close();
  }
}

/**
 * "Резалтик, добавь в таблицу статистики следующие премьер матчи:" calls
 * this once a "<Map> - Premier" tab's 2nd game just got logged (one map's
 * best-of-2 = one week) — posts a screenshot of its heatmap into the
 * "Статистика" topic, numbered by how many maps have completed so far.
 */
export async function announceMapWeekComplete(browser, { spreadsheetId, sheetId, tabTitle }) {
  if (!config.statsChatId) return; // not configured yet — skip quietly rather than error the whole command
  const week = await incrementStatsWeekCounter();
  const png = await screenshotSheetRange(browser, spreadsheetId, sheetId, HEATMAP_RANGE);
  const link = sheetRangeUrl(spreadsheetId, sheetId, HEATMAP_RANGE);
  const caption = `${week} неделя ${escapeHtml(config.currentSplitLabel)} прем матчи (${escapeHtml(tabTitle)})\n${escapeHtml(link)}`;
  await sendPhotoTo(config.statsChatId, config.statsThreadId, caption, png);
}

/** "Резалтик, отправь статистику за сезон" */
export async function sendSeasonStats(browser, { spreadsheetId, sheetId, tabTitle }) {
  const png = await screenshotSheetRange(browser, spreadsheetId, sheetId, HEATMAP_RANGE);
  const link = sheetRangeUrl(spreadsheetId, sheetId, HEATMAP_RANGE);
  const caption = `Статистика за сезон ${escapeHtml(config.currentSplitLabel)}\n${escapeHtml(link)}`;
  await sendPhotoTo(config.statsChatId ?? config.scheduleChatId, config.statsThreadId ?? config.scheduleThreadId, caption, png);
  return { tabTitle };
}
