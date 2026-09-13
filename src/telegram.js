import { config } from './config.js';

const API_BASE = `https://api.telegram.org/bot${config.telegramBotToken}`;

function caption(match) {
  const icon = match.won ? '✅' : '❌';
  const date = new Date(match.dateStarted).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
  return `${icon} ${date} · ${match.mapName} · Premier\ntracker.gg/valorant/match/${match.matchId}`;
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
