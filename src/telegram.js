import { config } from './config.js';

const API_BASE = `https://api.telegram.org/bot${config.telegramBotToken}`;

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function caption(match) {
  const icon = match.won ? '✅' : '❌';
  const date = new Date(match.dateStarted).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
  const matchUrl = `https://tracker.gg/valorant/match/${match.matchId}`;
  return (
    `${icon} ${date} · ${escapeHtml(match.mapName)} · ${escapeHtml(match.playlistName)} — ` +
    `<a href="${matchUrl}">Ссылка на матч тут</a>`
  );
}

async function callApi(method, form) {
  const res = await fetch(`${API_BASE}/${method}`, { method: 'POST', body: form });
  const body = await res.text();
  if (!res.ok) {
    // Editing a message with unchanged text is a no-op, not a real failure —
    // callers that recompute-then-edit hit this constantly when nothing
    // actually changed.
    if (method === 'editMessageText' && body.includes('message is not modified')) return null;
    throw new Error(`Telegram ${method} failed: ${res.status} ${body}`);
  }
  return JSON.parse(body).result;
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

// Same as sendTextTo, but hands back the message_id — needed anywhere the
// message might get edited later (e.g. the schedule summary, kept in sync
// as post-deadline edits come in).
export async function sendTextToWithId(chatId, threadId, text) {
  const form = new FormData();
  form.append('chat_id', chatId);
  if (threadId) form.append('message_thread_id', threadId);
  form.append('text', text);
  const result = await callApi('sendMessage', form);
  return result.message_id;
}

export async function editMessageText(chatId, messageId, text) {
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('message_id', messageId);
  form.append('text', text);
  await callApi('editMessageText', form);
}

export async function sendMatchReport(match, pngBuffer) {
  await sendPhotoTo(config.telegramChatId, config.telegramMessageThreadId, caption(match), pngBuffer);
}

export { caption as matchCaption };
