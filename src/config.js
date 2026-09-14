import 'dotenv/config';
import path from 'node:path';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const dataDir = path.resolve(process.env.DATA_DIR || './data');

export const config = {
  telegramBotToken: required('TELEGRAM_BOT_TOKEN'),
  telegramChatId: required('TELEGRAM_CHAT_ID'),
  // Only needed when posting into one topic of a forum-mode supergroup.
  telegramMessageThreadId: process.env.TELEGRAM_MESSAGE_THREAD_ID || null,
  trackerProfileUrl: required('TRACKER_PROFILE_URL'),
  trackedRiotId: required('TRACKED_RIOT_ID'),
  // Every known roster member's Riot ID (Name#tag) — lets the generic
  // "покажи матч" command recognize our team even when the tracked player
  // (Space) isn't the one who happened to play this particular match.
  teamRosterRiotIds: (process.env.TEAM_ROSTER_RIOT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  headless: process.env.HEADLESS !== 'false',
  dataDir,
  statePath: path.join(dataDir, 'state.json'),
  browserProfileDir: path.join(dataDir, 'browser-profile'),

  // "Расписание" mini app
  miniappPort: Number(process.env.MINIAPP_PORT || 3001),
  // Public HTTPS URL Caddy/DuckDNS expose the mini app on (what Telegram
  // actually loads once launched).
  miniappPublicUrl: process.env.MINIAPP_PUBLIC_URL || null,
  // t.me/<bot>/<short name> deep link registered via BotFather's /newapp —
  // this is what actually launches the mini app from a group chat. A
  // "web_app" inline keyboard button can't: Telegram only allows those in
  // private chats with the bot.
  miniappLaunchUrl: process.env.MINIAPP_LAUNCH_URL || null,
  // Same NF // OVT group as everything else — the schedule summary and
  // post-deadline edit alerts both go into its "Сборы" topic.
  scheduleChatId: process.env.SCHEDULE_CHAT_ID || null,
  scheduleThreadId: process.env.SCHEDULE_THREAD_ID || null,
  // Numeric Telegram user id — only this user sees the admin tab / can send
  // the summary. Usernames can change; ids don't.
  adminUserId: process.env.ADMIN_USER_ID ? Number(process.env.ADMIN_USER_ID) : null,
  scheduleDataPath: path.join(dataDir, 'schedule.json'),

  // "Вувочка" (Wuthering Waves companion) mini app — shares the same
  // MINIAPP_PORT/MINIAPP_PUBLIC_URL server above, served from /wuvochka/.
  miniappWuvochkaLaunchUrl: process.env.MINIAPP_WUVOCHKA_LAUNCH_URL || null,
  wuvochkaDataPath: path.join(dataDir, 'wuvochka.json'),

  // "добавь в таблицу статистики" — writes per-match player stats into the
  // team's Google Sheet (one tab per map+mode, see sheetsStats.js).
  googleServiceAccountKeyPath: path.join(dataDir, 'google-service-account.json'),
  statsSpreadsheetId: process.env.STATS_SPREADSHEET_ID || null,
  // Same group as everything else — its own "Статистика" topic gets the
  // per-map-complete screenshot and the "статистика за сезон" command.
  statsChatId: process.env.STATS_CHAT_ID || null,
  statsThreadId: process.env.STATS_THREAD_ID || null,
  currentSplitLabel: process.env.CURRENT_SPLIT_LABEL || 'V26A5',

  // "Резалтик, легенда" — random gif via Giphy's /gifs/random endpoint.
  giphyApiKey: process.env.GIPHY_API_KEY || null,
};
