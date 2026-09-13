import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getBrowser } from './browser.js';
import { fetchMatchDetail, fetchTeamStandings, gotoTrackerProfile } from './trackerClient.js';
import { buildMatchView } from './matchModel.js';
import { renderScoreboardPng } from './render/renderCard.js';
import { sendPhotoTo, sendTextTo, matchCaption } from './telegram.js';

const API_BASE = `https://api.telegram.org/bot${config.telegramBotToken}`;
const OFFSET_PATH = path.join(config.dataDir, 'telegram-offset.json');

// How you get the bot's attention — "Резалтик, ..." with or without the comma.
const TRIGGER = /^рез[аa]лтик[\s,:-]*/i;
const MATCH_URL_RE = /tracker\.gg\/valorant\/match\/([0-9a-f-]{36})/i;
const HEALTHCHECK_RE = /^healthcheck$/i;
const SCHEDULE_RE = /^расписание$/i;
// "покажи премьер матч" must match before the more general "покажи матч" —
// both start with "покажи", only one has "премьер" in the middle.
const PREMIER_MATCH_RE = /^покажи\s+премьер\s+матч\b/i;
const ANY_MATCH_RE = /^покажи\s+матч\b/i;

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

// "Резалтик, покажи премьер матч <ссылка>" — unchanged logic: looks up the
// tracked player's Premier team standings, throws if they're not in this
// match (buildMatchView's default behavior).
async function summarizePremierMatch(matchId, message) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // A fresh page has no origin yet — api.tracker.gg only allows fetches
    // that originate from a tracker.gg page (CORS), so we have to land on
    // one first, same as the scheduled poller does via fetchRecentMatches.
    await gotoTrackerProfile(page);
    const raw = await fetchMatchDetail(page, matchId);
    const teamsInfo = await fetchTeamStandings(page, raw, config.trackedRiotId);
    const match = buildMatchView(raw, teamsInfo);
    match.playlistName = 'Premier'; // this command is specifically for Premier matches — pin it regardless of tracker.gg's raw queueId
    const png = await renderScoreboardPng(browser, match);
    await sendPhotoTo(message.chat.id, message.message_thread_id, matchCaption(match), png);
  } finally {
    await page.close();
  }
}

// "Резалтик, покажи матч <ссылка>" — any match, any player, any playlist.
// No Premier roster lookup (doesn't make sense outside Premier anyway), so
// team names fall back to "Наша команда"/"Соперник" with no rank/standing;
// "our" side is just whichever team appears first in the data.
async function summarizeAnyMatch(matchId, message) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await gotoTrackerProfile(page);
    const raw = await fetchMatchDetail(page, matchId);
    const match = buildMatchView(raw, {}, { trackedRiotId: null, requireTracked: false });
    const png = await renderScoreboardPng(browser, match);
    await sendPhotoTo(message.chat.id, message.message_thread_id, matchCaption(match), png);
  } finally {
    await page.close();
  }
}

function healthcheckReply() {
  const uptimeMin = Math.floor(process.uptime() / 60);
  return `✅ На связи, вижу сообщения. Аптайм процесса: ${uptimeMin} мин.`;
}

async function handleCommand(commandText, message) {
  const trimmed = commandText.trim();
  const urlMatch = commandText.match(MATCH_URL_RE);
  try {
    if (HEALTHCHECK_RE.test(trimmed)) {
      await sendTextTo(message.chat.id, message.message_thread_id, healthcheckReply());
      return;
    }
    if (SCHEDULE_RE.test(trimmed)) {
      if (!config.miniappLaunchUrl) {
        await sendTextTo(message.chat.id, message.message_thread_id, 'Мини-апп расписания ещё не настроен (нет MINIAPP_LAUNCH_URL).');
        return;
      }
      // A t.me/<bot>/<app> deep link, not a "web_app" button — those only
      // work in private chats, and this needs to work from a group topic.
      await sendTextTo(message.chat.id, message.message_thread_id, `📅 Расписание команды: ${config.miniappLaunchUrl}`);
      return;
    }
    if (PREMIER_MATCH_RE.test(trimmed)) {
      if (!urlMatch) {
        await sendTextTo(message.chat.id, message.message_thread_id, 'Нужна ссылка на матч tracker.gg.');
        return;
      }
      await summarizePremierMatch(urlMatch[1], message);
      return;
    }
    if (ANY_MATCH_RE.test(trimmed)) {
      if (!urlMatch) {
        await sendTextTo(message.chat.id, message.message_thread_id, 'Нужна ссылка на матч tracker.gg.');
        return;
      }
      await summarizeAnyMatch(urlMatch[1], message);
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
