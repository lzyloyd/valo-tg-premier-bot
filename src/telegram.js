import { config } from './config.js';

const API_BASE = `https://api.telegram.org/bot${config.telegramBotToken}`;

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

// 5 non-breaking spaces (the Unicode counterpart of the old Alt+255 trick) —
// padding to stretch the caption line so Telegram renders the photo wider.
const WIDTH_PAD = ' '.repeat(5);

function caption(match) {
  const icon = match.won ? '✅' : '❌';
  const date = new Date(match.dateStarted).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
  const matchUrl = `https://tracker.gg/valorant/match/${match.matchId}`;
  return (
    `${icon} ${date} · ${escapeHtml(match.mapName)} · Premier — ` +
    `<a href="${matchUrl}">Ссылка на матч тут</a>${WIDTH_PAD}`
  );
}

async function callApi(method, form) {
  const res = await fetch(`${API_BASE}/${method}`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram ${method} failed: ${res.status} ${body}`);
  }
}

export async function sendPhotoTo(chatId, threadId, captionText, pngBuffer) {
  const form = new FormData();
  form.append('chat_id', chatId);
  if (threadId) form.append('message_thread_id', threadId);
  form.append('caption', captionText);
  form.append('parse_mode', 'HTML');
  form.append('photo', new Blob([pngBuffer], { type: 'image/png' }), 'scoreboard.png');
  await callApi('sendPhoto', form);
}

export async function sendTextTo(chatId, threadId, text) {
  const form = new FormData();
  form.append('chat_id', chatId);
  if (threadId) form.append('message_thread_id', threadId);
  form.append('text', text);
  await callApi('sendMessage', form);
}

export async function sendMatchReport(match, pngBuffer) {
  await sendPhotoTo(config.telegramChatId, config.telegramMessageThreadId, caption(match), pngBuffer);
}

export { caption as matchCaption };
