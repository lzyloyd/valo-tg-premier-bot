import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getBrowser } from './browser.js';
import { fetchMatchDetail, fetchTeamStandings, openTracker } from './trackerClient.js';
import { buildMatchView } from './matchModel.js';
import { renderScoreboardPng } from './render/renderCard.js';
import { sendPhotoTo, sendTextTo, sendAnimationTo, matchCaption } from './telegram.js';
import { fetchRandomGifUrl } from './giphy.js';
import { appendMatchToStatsSheet, getTabSheetId, OVERALL_PREMIER_TAB } from './sheetsStats.js';
import { announceMapWeekComplete, sendSeasonStats } from './sheetsAnnounce.js';

const API_BASE = `https://api.telegram.org/bot${config.telegramBotToken}`;
const OFFSET_PATH = path.join(config.dataDir, 'telegram-offset.json');

// How you get the bot's attention — "Резалтик, ..." with or without the comma.
const TRIGGER = /^рез[аa]лтик[\s,:-]*/i;
const MATCH_URL_RE_G = /tracker\.gg\/valorant\/match\/([0-9a-f-]{36})/gi;
const HEALTHCHECK_RE = /^healthcheck$/i;
const SCHEDULE_RE = /^расписание$/i;
const WUVOCHKA_RE = /^вувочка$/i;
// "покажи премьер матч" must match before the more general "покажи матч" —
// both start with "покажи", only one has "премьер" in the middle.
// Note: no \b here — \b is defined via \w, which is ASCII-only ([A-Za-z0-9_]),
// so it never finds a boundary next to Cyrillic text. (?=\s|$) instead.
const PREMIER_MATCH_RE = /^покажи\s+премьер\s+матч(?=\s|$)/i;
const ANY_MATCH_RE = /^покажи\s+матч(?=\s|$)/i;
const PRACTICE_MATCH_RE = /^покажи\s+прак(?=\s|$)/i;
// "добавь в таблицу статистики следующие премьер матчи:\n<ссылка>\n<ссылка>..."
const STATS_PREMIER_RE = /^добавь\s+в\s+таблицу\s+статистики\s+следующие\s+премьер\s+матч/i;
const STATS_PRACTICE_RE = /^добавь\s+в\s+таблицу\s+статистики\s+следующие\s+прак/i;
const SEASON_STATS_RE = /^отправь\s+статистику\s+за\s+сезон(?=\s|$)/i;
// "отправь сводку по карте Split" — manual trigger for the same map-week
// announcement, for a week that only had 1 premier match (never reaches the
// auto-trigger's 2nd game).
const MAP_SUMMARY_RE = /^отправь\s+сводку\s+по\s+карте\s+(\S+)/i;
const LEGEND_RE = /^легенда$/i;
const SAD_RE = /^плохо$/i;

function extractAllMatchIds(text) {
  return [...text.matchAll(MATCH_URL_RE_G)].map((m) => m[1]);
}

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

// A match to process: either a tracker.gg id the bot fetches itself, or the
// match payload a user uploaded as a JSON file (opened from api.tracker.gg in
// their own browser — the server's own requests there can be blocked by
// Cloudflare). Uploads win over a link to the same match.
function collectMatchRefs(text, uploads) {
  const refs = new Map(uploads.map((raw) => [raw.attributes.id, { id: raw.attributes.id, raw }]));
  for (const id of extractAllMatchIds(text)) if (!refs.has(id)) refs.set(id, { id });
  return [...refs.values()];
}

// Uploaded payloads skip tracker.gg entirely — including the Premier team
// lookup, which is another api.tracker.gg call — so their card falls back
// to "Команда A/B" names. A fetched match needs a tracker.gg page first:
// api.tracker.gg only allows fetches originating from one (CORS).
async function loadMatch(page, ref, { withStandings = false } = {}) {
  if (ref.raw) return { raw: ref.raw, teamsInfo: {} };
  await openTracker(page);
  const raw = await fetchMatchDetail(page, ref.id);
  return { raw, teamsInfo: withStandings ? await fetchTeamStandings(page, raw) : {} };
}

// "покажи премьер матч" (Premier team standings, card pinned to "Premier"
// whatever tracker.gg's raw queueId says), "покажи прак" (same standings
// lookup; a custom lobby's null queueId makes buildMatchView render it as
// "Кастомка" with no TRS on its own) and "покажи матч" (any match, no
// standings lookup). "Our" side is whichever team a roster member played on,
// or the first team if none of us is in the match.
async function summarizeMatch(ref, message, { withStandings, pinPremier }) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const { raw, teamsInfo } = await loadMatch(page, ref, { withStandings });
    const match = buildMatchView(raw, teamsInfo);
    if (pinPremier) match.playlistName = 'Premier';
    const png = await renderScoreboardPng(browser, match);
    await sendPhotoTo(message.chat.id, message.message_thread_id, matchCaption(match), png);
  } finally {
    await page.close();
  }
}

// "Резалтик, добавь в таблицу статистики следующие премьер матчи:"/"...праки:"
// — logs each match's per-player stats as a new "Game N" column on the
// relevant "<Map> - <Mode>" tab of the Google Sheet, instead of rendering a
// scoreboard. A match with none of our roster in it is rejected rather than
// logging the other side's stats.
async function addMatchesToStatsSheet(refs, mode, message) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const lines = [];
  try {
    for (const ref of refs) {
      const matchId = ref.id;
      const short = matchId.slice(0, 8);
      try {
        const { raw } = await loadMatch(page, ref);
        const queueId = raw.metadata.queueId?.toLowerCase() ?? null;

        // The command trusts the caller's claim about what kind of match
        // this is (it's how the sheet decides TRS vs. no-TRS layout) — check
        // it against tracker.gg's own record instead, so a premier link
        // pasted into "...праки:" (or vice versa) doesn't get logged askew.
        if (mode === 'Premier' && queueId !== 'premier') {
          lines.push(`❌ ${short}… — это не премьер-матч (queueId: ${queueId ?? 'кастомка'}), пропущен`);
          continue;
        }
        if (mode === 'Праки' && queueId !== null) {
          lines.push(`❌ ${short}… — это не кастомка (queueId: ${queueId}), пропущен`);
          continue;
        }

        const match = buildMatchView(raw, {}, { requireOurTeam: true });
        const { tabTitle, gameNumber, written, skipped, alreadyLogged, sheetId } = await appendMatchToStatsSheet({
          mapName: match.mapName,
          mode,
          players: match.ourTeam,
          matchId,
          matchDate: match.dateStarted,
        });
        if (alreadyLogged) {
          lines.push(`↩️ ${short}… уже был записан в "${tabTitle}" (Game ${gameNumber}), пропущен`);
          continue;
        }
        const skippedNote = skipped.length ? `, не найдены в таблице: ${skipped.join(', ')}` : '';
        lines.push(`✅ ${short}… → "${tabTitle}", Game ${gameNumber} (${written.length} игроков${skippedNote})`);

        // One map's Premier best-of-2 just completed — post its heatmap into
        // the "Статистика" topic, numbered by how many maps have wrapped up
        // so far this split.
        if (mode === 'Premier' && gameNumber === 2) {
          try {
            await announceMapWeekComplete(browser, { spreadsheetId: config.statsSpreadsheetId, sheetId, tabTitle });
            lines.push(`   📸 отправлено в топик "Статистика"`);
          } catch (err) {
            console.error(`[listener] failed to announce map week complete for ${tabTitle}:`, err);
            lines.push(`   ⚠️ не удалось отправить скриншот в "Статистика": ${err.message}`);
          }
        }

        // Every Premier map also feeds one running "overall" tab that isn't
        // derived from the per-map tabs — it needs its own write.
        if (mode === 'Premier') {
          const overall = await appendMatchToStatsSheet({
            mapName: match.mapName,
            mode,
            players: match.ourTeam,
            matchId,
            tabTitle: OVERALL_PREMIER_TAB,
          });
          lines.push(
            overall.alreadyLogged
              ? `   ↳ уже был записан в "${OVERALL_PREMIER_TAB}" (Game ${overall.gameNumber})`
              : `   ↳ "${OVERALL_PREMIER_TAB}", Game ${overall.gameNumber}`,
          );
        }
      } catch (err) {
        console.error(`[listener] failed to log match ${matchId} to stats sheet:`, err);
        lines.push(`❌ ${short}… — ${err.message}`);
      }
    }
  } finally {
    await page.close();
  }
  await sendTextTo(message.chat.id, message.message_thread_id, lines.join('\n'));
}

// "Резалтик, отправь статистику за сезон" — posts a screenshot of the
// overall "Статистика за V26A5" tab's heatmap into the "Статистика" topic.
async function sendSeasonStatsCommand(message) {
  const browser = await getBrowser();
  const sheetId = await getTabSheetId(config.statsSpreadsheetId, OVERALL_PREMIER_TAB);
  if (sheetId === null) {
    await sendTextTo(message.chat.id, message.message_thread_id, `Вкладка "${OVERALL_PREMIER_TAB}" не найдена в таблице.`);
    return;
  }
  await sendSeasonStats(browser, { spreadsheetId: config.statsSpreadsheetId, sheetId, tabTitle: OVERALL_PREMIER_TAB });
}

// "Резалтик, отправь сводку по карте <Map>" — manual version of the
// map-week-complete announcement (same announceMapWeekComplete call the
// auto-trigger uses at the tab's 2nd game), for a week that only had 1
// premier match and so never reached that trigger on its own.
async function sendMapSummaryCommand(mapName, message) {
  const tabTitle = `${mapName} - Premier`;
  const sheetId = await getTabSheetId(config.statsSpreadsheetId, tabTitle);
  if (sheetId === null) {
    await sendTextTo(message.chat.id, message.message_thread_id, `Вкладка "${tabTitle}" не найдена в таблице.`);
    return;
  }
  const browser = await getBrowser();
  await announceMapWeekComplete(browser, { spreadsheetId: config.statsSpreadsheetId, sheetId, tabTitle });
  await sendTextTo(message.chat.id, message.message_thread_id, `Отправлено в "Статистика": "${tabTitle}".`);
}

// "Резалтик, легенда"/"Резалтик, плохо" — a random gif for a given tag, just for fun.
async function sendRandomGif(message, tag) {
  const url = await fetchRandomGifUrl(tag);
  if (!url) {
    await sendTextTo(message.chat.id, message.message_thread_id, 'Гифка не нашлась, попробуй ещё раз.');
    return;
  }
  await sendAnimationTo(message.chat.id, message.message_thread_id, url);
}

function healthcheckReply() {
  const uptimeMin = Math.floor(process.uptime() / 60);
  return `✅ На связи, вижу сообщения. Аптайм процесса: ${uptimeMin} мин.`;
}

const NEED_MATCH = 'Нужна ссылка на матч tracker.gg или JSON-файл матча.';

// A match JSON the user saved from api.tracker.gg/.../matches/<id> in their
// own browser and attached to the command (Bot API downloads cap at 20 MB;
// a match is ~1-2 MB).
async function downloadMatchFiles(documents) {
  const out = [];
  for (const doc of documents) {
    const meta = await (await fetch(`${API_BASE}/getFile?file_id=${encodeURIComponent(doc.file_id)}`)).json();
    if (!meta.ok) throw new Error(`не удалось скачать ${doc.file_name}: ${meta.description}`);
    const res = await fetch(`https://api.telegram.org/file/bot${config.telegramBotToken}/${meta.result.file_path}`);
    let json;
    try {
      json = JSON.parse(await res.text());
    } catch {
      throw new Error(`${doc.file_name} — не JSON`);
    }
    const data = json.data ?? json;
    if (!data?.attributes?.id || !Array.isArray(data.segments)) {
      throw new Error(`${doc.file_name} — это не данные матча tracker.gg`);
    }
    out.push(data);
  }
  return out;
}

async function handleCommand(commandText, message, documents = []) {
  const trimmed = commandText.trim();
  try {
    if (HEALTHCHECK_RE.test(trimmed)) {
      await sendTextTo(message.chat.id, message.message_thread_id, healthcheckReply());
      return;
    }
    if (LEGEND_RE.test(trimmed)) {
      await sendRandomGif(message, 'sigma');
      return;
    }
    if (SAD_RE.test(trimmed)) {
      await sendRandomGif(message, 'sad kitten');
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
    if (WUVOCHKA_RE.test(trimmed)) {
      if (!config.miniappWuvochkaLaunchUrl) {
        await sendTextTo(message.chat.id, message.message_thread_id, 'Мини-апп Вувочка ещё не настроен (нет MINIAPP_WUVOCHKA_LAUNCH_URL).');
        return;
      }
      await sendTextTo(message.chat.id, message.message_thread_id, `🎐 Вувочка: ${config.miniappWuvochkaLaunchUrl}`);
      return;
    }
    const matchCommand = PREMIER_MATCH_RE.test(trimmed)
      ? { withStandings: true, pinPremier: true }
      : PRACTICE_MATCH_RE.test(trimmed)
        ? { withStandings: true, pinPremier: false }
        : ANY_MATCH_RE.test(trimmed)
          ? { withStandings: false, pinPremier: false }
          : null;
    if (matchCommand) {
      const [ref] = collectMatchRefs(commandText, await downloadMatchFiles(documents));
      if (!ref) {
        await sendTextTo(message.chat.id, message.message_thread_id, NEED_MATCH);
        return;
      }
      await summarizeMatch(ref, message, matchCommand);
      return;
    }
    if (SEASON_STATS_RE.test(trimmed)) {
      await sendSeasonStatsCommand(message);
      return;
    }
    const mapSummaryMatch = MAP_SUMMARY_RE.exec(trimmed);
    if (mapSummaryMatch) {
      await sendMapSummaryCommand(mapSummaryMatch[1], message);
      return;
    }
    if (STATS_PREMIER_RE.test(trimmed) || STATS_PRACTICE_RE.test(trimmed)) {
      const refs = collectMatchRefs(commandText, await downloadMatchFiles(documents));
      if (refs.length === 0) {
        await sendTextTo(message.chat.id, message.message_thread_id, NEED_MATCH);
        return;
      }
      const mode = STATS_PREMIER_RE.test(trimmed) ? 'Premier' : 'Праки';
      await addMatchesToStatsSheet(refs, mode, message);
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

// Several files sent as one album arrive as separate messages sharing a
// media_group_id, with the caption (the command) on only one of them —
// gather them until the album goes quiet, then handle it as one command.
const ALBUM_SETTLE_MS = 2000;
const pendingAlbums = new Map();

function bufferAlbumPart(message) {
  const album = pendingAlbums.get(message.media_group_id) ?? { messages: [], timer: null };
  album.messages.push(message);
  clearTimeout(album.timer);
  album.timer = setTimeout(() => {
    pendingAlbums.delete(message.media_group_id);
    dispatch(album.messages);
  }, ALBUM_SETTLE_MS);
  pendingAlbums.set(message.media_group_id, album);
}

// The command is a message's text, or a file's caption; attached .json files
// ride along as match payloads.
function dispatch(messages) {
  const head = messages.find((m) => m.text ?? m.caption);
  const text = head?.text ?? head?.caption;
  if (!text) return;
  const triggerMatch = TRIGGER.exec(text);
  if (!triggerMatch) return;
  const commandText = text.slice(triggerMatch[0].length).trim();
  const documents = messages.map((m) => m.document).filter((d) => d && /\.json$/i.test(d.file_name ?? ''));
  handleCommand(commandText, head, documents).catch((err) => console.error('[listener] unhandled command error:', err));
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
      const message = update.message;
      if (!message) continue;
      if (message.media_group_id) bufferAlbumPart(message);
      else dispatch([message]);
    }

    if (updates.length > 0) await saveOffset(offset);
  }
}
