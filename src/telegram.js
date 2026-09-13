import { config } from './config.js';

const API_BASE = `https://api.telegram.org/bot${config.telegramBotToken}`;

function caption(match) {
  const icon = match.won ? '✅' : '❌';
  const date = new Date(match.dateStarted).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
  return (
    `${icon} ${date} · ${match.mapName} · Premier — ${match.ourScore}:${match.theirScore}\n` +
    `tracker.gg/valorant/match/${match.matchId}`
  );
}

export async function sendMatchReport(match, pngBuffer) {
  const form = new FormData();
  form.append('chat_id', config.telegramChatId);
  if (config.telegramMessageThreadId) {
    form.append('message_thread_id', config.telegramMessageThreadId);
  }
  form.append('caption', caption(match));
  form.append('photo', new Blob([pngBuffer], { type: 'image/png' }), 'scoreboard.png');

  const res = await fetch(`${API_BASE}/sendPhoto`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendPhoto failed: ${res.status} ${body}`);
  }
}
