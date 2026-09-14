import { config } from './config.js';
import { sendPhotoTo } from './telegram.js';
import { countAnnouncedPremierWeeks } from './sheetsStats.js';

function escapeHtml(str) {
  return String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function sheetRangeUrl(spreadsheetId, gid, range) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}&range=${range}`;
}

// Both heatmap tables (rows 1-20, columns B-P covers every stat column
// either mode uses) — same crop the team already takes by hand.
const HEATMAP_RANGE = 'B1:P20';

// Calibrated against a fresh (default A1, no range= param) load at this
// exact viewport size: skips the row-number/column-A gutter on the left and
// the column-letter band on top, and stops right at column P / row 20 with
// no sliver of column Q bleeding in on the right.
const CROP = { x: 148, y: 26, width: 1520, height: 650 };

async function screenshotSheetRange(browser, spreadsheetId, gid) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1750, height: 820 });
    // rm=minimal drops Sheets' own menu/toolbar chrome (same param Google's
    // "publish to the web" embeds use). Deliberately NOT passing range= —
    // it does scroll to the range, but also leaves a persistent blue
    // selection-outline around it that nothing (Escape, clicking elsewhere)
    // manages to clear. The heatmap tables always start at A1 anyway, so a
    // fresh load already opens right there without needing to scroll.
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}&rm=minimal`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
    await new Promise((resolve) => setTimeout(resolve, 1500)); // grid/heatmap colors finish painting after load fires
    return await page.screenshot({ type: 'png', clip: CROP });
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
  const week = await countAnnouncedPremierWeeks(spreadsheetId);
  const png = await screenshotSheetRange(browser, spreadsheetId, sheetId);
  const link = sheetRangeUrl(spreadsheetId, sheetId, HEATMAP_RANGE);
  const caption = `${week} неделя ${escapeHtml(config.currentSplitLabel)} прем матчи (${escapeHtml(tabTitle)})\n${escapeHtml(link)}`;
  await sendPhotoTo(config.statsChatId, config.statsThreadId, caption, png);
}

/** "Резалтик, отправь статистику за сезон" */
export async function sendSeasonStats(browser, { spreadsheetId, sheetId, tabTitle }) {
  const png = await screenshotSheetRange(browser, spreadsheetId, sheetId);
  const link = sheetRangeUrl(spreadsheetId, sheetId, HEATMAP_RANGE);
  const caption = `Статистика за сезон ${escapeHtml(config.currentSplitLabel)}\n${escapeHtml(link)}`;
  await sendPhotoTo(config.statsChatId ?? config.scheduleChatId, config.statsThreadId ?? config.scheduleThreadId, caption, png);
  return { tabTitle };
}
