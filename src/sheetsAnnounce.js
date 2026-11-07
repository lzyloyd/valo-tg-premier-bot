import { currentStatsTeam } from './statsTeams.js';
import { config } from './config.js';
import { sendPhotoTo } from './telegram.js';
import { premierWeekNumber } from './sheetsStats.js';

function escapeHtml(str) {
  return String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function sheetRangeUrl(spreadsheetId, gid, range) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}&range=${range}`;
}

// OVT uses the compact seven-player layout; Clarity keeps its own template.
const heatmapRange = () => currentStatsTeam().id === 'ovt' ? 'B1:P20' : 'B1:P22';

// Calibrated against a fresh (default A1, no range= param) load at this
// exact viewport size: skips the row-number/column-A gutter on the left and
// the column-letter band on top, and stops right at column P / row 20 with
// no sliver of column Q bleeding in on the right; the bottom edge sits right
// under row 22 ("Целевой показатель") — re-measure if rows are added again.
const CROP = { x: 148, y: 26, width: 1520, height: 709 };

export async function screenshotSheetRange(browser, spreadsheetId, gid) {
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
    return await page.screenshot({ type: 'png', clip: { ...CROP, height: currentStatsTeam().id === 'ovt' ? 650 : CROP.height } });
  } finally {
    await page.close();
  }
}

/**
 * "Резалтик, добавь в таблицу статистики следующие премьер матчи:" calls
 * this once a "<Map> - Premier" tab's 2nd game just got logged (one map's
 * best-of-2 = one week) — posts a screenshot of its heatmap into the
 * "Статистика" topic, numbered by this map's place in the match chronology.
 */
export async function announceMapWeekComplete(browser, { spreadsheetId, sheetId, tabTitle }) {
  if (!currentStatsTeam().chatId) return; // not configured yet — skip quietly rather than error the whole command
  const week = await premierWeekNumber(spreadsheetId, sheetId);
  const png = await screenshotSheetRange(browser, spreadsheetId, sheetId);
  const link = sheetRangeUrl(spreadsheetId, sheetId, heatmapRange());
  const caption = `${week} неделя ${escapeHtml(currentStatsTeam().splitLabel)} прем матчи (${escapeHtml(tabTitle)})\n${escapeHtml(link)}`;
  await sendPhotoTo(currentStatsTeam().chatId, currentStatsTeam().threadId, caption, png);
}

/** "Резалтик, отправь статистику за сезон" */
export async function sendSeasonStats(browser, { spreadsheetId, sheetId, tabTitle }) {
  const png = await screenshotSheetRange(browser, spreadsheetId, sheetId);
  const link = sheetRangeUrl(spreadsheetId, sheetId, heatmapRange());
  const caption = `Статистика за сезон ${escapeHtml(currentStatsTeam().splitLabel)}\n${escapeHtml(link)}`;
  await sendPhotoTo(currentStatsTeam().chatId ?? config.scheduleChatId, currentStatsTeam().threadId ?? config.scheduleThreadId, caption, png);
  return { tabTitle };
}
