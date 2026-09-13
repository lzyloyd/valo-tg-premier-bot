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
  headless: process.env.HEADLESS !== 'false',
  dataDir,
  statePath: path.join(dataDir, 'state.json'),
  browserProfileDir: path.join(dataDir, 'browser-profile'),
};
