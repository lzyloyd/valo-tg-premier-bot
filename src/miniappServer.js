import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { verifyInitData } from './telegramAuth.js';
import { DAYS, ROSTER, QUORUM, weekDayDates, weekStartFromIso, buildSummaryText, buildEditAlertText, hasFullyAnswered } from './scheduleModel.js';
import { loadCurrentWeek, setResponse } from './scheduleStore.js';
import { sendTextTo } from './telegram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function authenticate(req, res) {
  const user = verifyInitData(req.body?.initData);
  if (!user) {
    res.status(401).json({ error: 'Не удалось подтвердить, что это ты — открой мини-апп заново из Telegram.' });
    return null;
  }
  const username = (user.username || '').toLowerCase();
  if (!ROSTER.includes(username)) {
    res.status(403).json({ error: 'Тебя нет в ростере команды — обратись к @lzyloyd.' });
    return null;
  }
  return { username, id: user.id, isAdmin: user.id === config.adminUserId };
}

function weekView(week, auth) {
  const weekStart = weekStartFromIso(week.weekStart);
  return {
    days: weekDayDates(weekStart),
    quorum: QUORUM,
    roster: ROSTER,
    responses: week.responses,
    edits: auth.isAdmin ? week.edits : [],
    summaryPreview: auth.isAdmin ? buildSummaryText(week) : null,
    answeredCount: ROSTER.filter((u) => hasFullyAnswered(week.responses, u)).length,
    me: { username: auth.username, isAdmin: auth.isAdmin },
  };
}

export function startMiniAppServer() {
  if (!config.scheduleChatId || !config.scheduleThreadId || !config.adminUserId) {
    console.log('[miniapp] SCHEDULE_CHAT_ID / SCHEDULE_THREAD_ID / ADMIN_USER_ID not set — mini app server not started.');
    return null;
  }

  const app = express();
  app.use(express.json());
  // Telegram's in-app webview caches the mini app aggressively — without an
  // explicit no-store (set before the static handler can send a response),
  // edits to index.html can keep showing the old version even after a fresh
  // open of the app.
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.static(path.join(__dirname, 'miniapp-public'), { etag: false, lastModified: false, cacheControl: false }));

  app.post('/api/state', async (req, res) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    const week = await loadCurrentWeek();
    res.json(weekView(week, auth));
  });

  app.post('/api/update', async (req, res) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    const { day, avail, slots } = req.body ?? {};
    const dayDef = DAYS.find((d) => d.key === day);
    if (!dayDef || !['yes', 'no'].includes(avail) || !Array.isArray(slots) || slots.some((s) => !dayDef.slots.includes(s))) {
      res.status(400).json({ error: 'Некорректные данные.' });
      return;
    }
    try {
      const { week, isPostDeadlineEdit } = await setResponse(auth.username, day, avail, slots);
      if (isPostDeadlineEdit) {
        const edit = week.edits[0];
        sendTextTo(config.scheduleChatId, config.scheduleThreadId, buildEditAlertText(edit)).catch((err) =>
          console.error('[miniapp] failed to post edit alert:', err),
        );
      }
      res.json(weekView(week, auth));
    } catch (err) {
      console.error('[miniapp] update failed:', err);
      res.status(500).json({ error: 'Не получилось сохранить, попробуй ещё раз.' });
    }
  });

  app.post('/api/send-summary', async (req, res) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    if (!auth.isAdmin) {
      res.status(403).json({ error: 'Сводку может отправить только админ.' });
      return;
    }
    try {
      const week = await loadCurrentWeek();
      await sendTextTo(config.scheduleChatId, config.scheduleThreadId, buildSummaryText(week));
      res.json({ ok: true });
    } catch (err) {
      console.error('[miniapp] send-summary failed:', err);
      res.status(500).json({ error: 'Не получилось отправить сводку.' });
    }
  });

  const server = app.listen(config.miniappPort, () => {
    console.log(`[miniapp] listening on :${config.miniappPort}`);
  });
  return server;
}
