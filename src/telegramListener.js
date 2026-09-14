import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getBrowser } from './browser.js';
import { fetchMatchDetail, fetchTeamStandings, gotoTrackerProfile } from './trackerClient.js';
import { buildMatchView } from './matchModel.js';
import { renderScoreboardPng } from './render/renderCard.js';
import { sendPhotoTo, sendTextTo, matchCaption } from './telegram.js';
import { appendMatchToStatsSheet, OVERALL_PREMIER_TAB } from './sheetsStats.js';

const API_BASE = `https://api.telegram.org/bot${config.telegramBotToken}`;
const OFFSET_PATH = path.join(config.dataDir, 'telegram-offset.json');

// How you get the bot's attention — "Резалтик, ..." with or without the comma.
const TRIGGER = /^рез[аa]лтик[\s,:-]*/i;
const MATCH_URL_RE = /tracker\.gg\/valorant\/match\/([0-9a-f-]{36})/i;
const MATCH_URL_RE_G = /tracker\.gg\/valorant\/match\/([0-9a-f-]{36})/gi;
const HEALTHCHECK_RE = /^healthcheck$/i;
const SCHEDULE_RE = /^расписание$/i;
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

// "Резалтик, покажи премьер матч <ссылка>" — looks up the tracked player's
// Premier team standings when they're in the match; if they're not (subbed
// out, or someone pastes a link where they didn't play), falls back to
// treating the first team as "our" side instead of failing outright —
// the same fallback "покажи матч" already uses.
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
    const match = buildMatchView(raw, teamsInfo, { trackedRiotId: config.trackedRiotId, requireTracked: false });
    match.playlistName = 'Premier'; // this command is specifically for Premier matches — pin it regardless of tracker.gg's raw queueId
    const png = await renderScoreboardPng(browser, match);
    await sendPhotoTo(message.chat.id, message.message_thread_id, matchCaption(match), png);
  } finally {
    await page.close();
  }
}

// "Резалтик, покажи прак <ссылка>" — for custom (scrim) matches: same
// Premier roster lookup as "покажи премьер матч" (team name + rank/standing,
// gracefully falling back if the tracked player isn't in this match either),
// but no playlistName override — the match's own queueId is null for a
// custom lobby, so buildMatchView's isCustom kicks in on its own (no TRS
// column, MVP by ACS, "Кастомка" label) exactly like "покажи матч" already does.
async function summarizePracticeMatch(matchId, message) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await gotoTrackerProfile(page);
    const raw = await fetchMatchDetail(page, matchId);
    const teamsInfo = await fetchTeamStandings(page, raw, config.trackedRiotId);
    const match = buildMatchView(raw, teamsInfo, { trackedRiotId: config.trackedRiotId, requireTracked: false });
    const png = await renderScoreboardPng(browser, match);
    await sendPhotoTo(message.chat.id, message.message_thread_id, matchCaption(match), png);
  } finally {
    await page.close();
  }
}

// "Резалтик, покажи матч <ссылка>" — any match, any player, any playlist.
// No Premier roster lookup (doesn't make sense outside Premier anyway), so
// team names fall back to "Команда A"/"Команда B" with no rank/standing.
// "Our" side is whichever team has a known roster member in it (checked
// against config.teamRosterRiotIds, since the tracked player specifically
// might not be the one who played this match); if nobody we know played,
// it's just a neutral team1-vs-team2 view.
async function summarizeAnyMatch(matchId, message) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await gotoTrackerProfile(page);
    const raw = await fetchMatchDetail(page, matchId);
    const match = buildMatchView(raw, {}, {
      trackedRiotId: null,
      requireTracked: false,
      ourRosterRiotIds: config.teamRosterRiotIds,
    });
    const png = await renderScoreboardPng(browser, match);
    await sendPhotoTo(message.chat.id, message.message_thread_id, matchCaption(match), png);
  } finally {
    await page.close();
  }
}

// "Резалтик, добавь в таблицу статистики следующие премьер матчи:"/"...праки:"
// — logs each match's per-player stats as a new "Game N" column on the
// relevant "<Map> - <Mode>" tab of the Google Sheet, instead of rendering a
// scoreboard. "Our team" is resolved the same permissive way as "покажи
// матч" (tracked player first, falling back to any known roster member) so
// a match Space didn't play still gets logged correctly.
async function addMatchesToStatsSheet(matchIds, mode, message) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const lines = [];
  try {
    await gotoTrackerProfile(page);
    for (const matchId of matchIds) {
      const short = matchId.slice(0, 8);
      try {
        const raw = await fetchMatchDetail(page, matchId);
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

        const match = buildMatchView(raw, {}, {
          trackedRiotId: config.trackedRiotId,
          requireTracked: false,
          ourRosterRiotIds: config.teamRosterRiotIds,
        });
        const { tabTitle, gameNumber, written, skipped, alreadyLogged } = await appendMatchToStatsSheet({
          mapName: match.mapName,
          mode,
          players: match.ourTeam,
          matchId,
        });
        if (alreadyLogged) {
          lines.push(`↩️ ${short}… уже был записан в "${tabTitle}" (Game ${gameNumber}), пропущен`);
          continue;
        }
        const skippedNote = skipped.length ? `, не найдены в таблице: ${skipped.join(', ')}` : '';
        lines.push(`✅ ${short}… → "${tabTitle}", Game ${gameNumber} (${written.length} игроков${skippedNote})`);

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
    if (PRACTICE_MATCH_RE.test(trimmed)) {
      if (!urlMatch) {
        await sendTextTo(message.chat.id, message.message_thread_id, 'Нужна ссылка на матч tracker.gg.');
        return;
      }
      await summarizePracticeMatch(urlMatch[1], message);
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
    if (STATS_PREMIER_RE.test(trimmed) || STATS_PRACTICE_RE.test(trimmed)) {
      const matchIds = extractAllMatchIds(commandText);
      if (matchIds.length === 0) {
        await sendTextTo(message.chat.id, message.message_thread_id, 'Нужна хотя бы одна ссылка на матч tracker.gg.');
        return;
      }
      const mode = STATS_PREMIER_RE.test(trimmed) ? 'Premier' : 'Праки';
      await addMatchesToStatsSheet(matchIds, mode, message);
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
      if (update.message) {
        console.log(
          `[listener] DEBUG msg — chat_id=${update.message.chat.id} thread_id=${update.message.message_thread_id} text=${JSON.stringify((text || '').slice(0, 40))}`,
        );
      }
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
