import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getBrowser } from './browser.js';
import { fetchMatchDetail, fetchTeamStandings } from './trackerClient.js';
import { buildMatchView } from './matchModel.js';
import { renderScoreboardPng } from './render/renderCard.js';
import { sendPhotoTo, sendTextTo, matchCaption } from './telegram.js';

const API_BASE = `https://api.telegram.org/bot${config.telegramBotToken}`;
const OFFSET_PATH = path.join(config.dataDir, 'telegram-offset.json');

// How you get the bot's attention — "Резалтик, ..." with or without the comma.
const TRIGGER = /^рез[аa]лтик[\s,:-]*/i;
const MATCH_URL_RE = /tracker\.gg\/valorant\/match\/([0-9a-f-]{36})/i;

async function loadOffset() {
  try {
    const raw = await fs.readFile(OFFSET_PATH, 'utf8');
    return JSON.parse(raw).offset ?? 0;
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
}

async function saveOffset(offset) {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(OFFSET_PATH, JSON.stringify({ offset }));
}

async function summarizeMatch(matchId, message) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const raw = await fetchMatchDetail(page, matchId);
    const teamsInfo = await fetchTeamStandings(page, config.trackedRiotId, matchId);
    const match = buildMatchView(raw, teamsInfo);
    const png = await renderScoreboardPng(browser, match);
    await sendPhotoTo(message.chat.id, message.message_thread_id, matchCaption(match), png);
  } finally {
    await page.close();
  }
}

async function handleCommand(commandText, message) {
  const urlMatch = commandText.match(MATCH_URL_RE);
  try {
    if (urlMatch) {
      await summarizeMatch(urlMatch[1], message);
      return;
    }
    await sendTextTo(message.chat.id, message.message_thread_id, 'Не знаю такой команды пока.');
  } catch (err) {
    console.error('[listener] command failed:', err);
    await sendTextTo(message.chat.id, message.message_thread_id, `Не получилось: ${err.message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Long-polls Telegram for new messages and reacts to ones addressed to the
 * bot ("Резалтик, ..."). This runs continuously alongside the twice-a-week
 * match scheduler — long polling itself is cheap (no browser involved); a
 * browser only gets launched when a command actually needs to render something.
 */
export async function runTelegramListener() {
  let offset = await loadOffset();
  console.log('[listener] watching for "Резалтик, ..." commands...');

  for (;;) {
    let updates;
    try {
      const res = await fetch(`${API_BASE}/getUpdates?timeout=30&offset=${offset}`);
      const json = await res.json();
      if (!json.ok) {
        await sleep(5000);
        continue;
      }
      updates = json.result;
    } catch (err) {
      console.error('[listener] poll failed:', err);
      await sleep(5000);
      continue;
    }

    for (const update of updates) {
      offset = update.update_id + 1;
      const text = update.message?.text;
      if (!text) continue;
      const triggerMatch = TRIGGER.exec(text);
      if (!triggerMatch) continue;
      const commandText = text.slice(triggerMatch[0].length).trim();
      handleCommand(commandText, update.message).catch((err) =>
        console.error('[listener] unhandled command error:', err),
      );
    }

    if (updates.length > 0) await saveOffset(offset);
  }
}
