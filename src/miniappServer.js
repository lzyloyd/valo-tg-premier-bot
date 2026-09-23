import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import express from 'express';
import { config } from './config.js';
import { verifyInitData } from './telegramAuth.js';
import {
  DAYS,
  ROSTER,
  QUORUM,
  MAX_WARNINGS,
  weekDayDates,
  weekStartFromIso,
  mskIsoDate,
  buildSummaryText,
  buildMissWarningText,
  hasFullyAnswered,
  computeWeekSessions,
} from './scheduleModel.js';
import { loadCurrentWeek, setResponse, setDayOff } from './scheduleStore.js';
import { loadAttendance, recordMiss } from './attendanceStore.js';
import { sendSummary, handlePostDeadlineEdit, scheduleUpcomingSessionReminders } from './scheduleNotifications.js';
import { sendTextTo } from './telegram.js';
import { WUVOCHKA_ROSTER } from './wuvochkaModel.js';
import { loadProfile, toggleFavorite, toggleOwned, setAvatar } from './wuvochkaStore.js';

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

function authenticateWuvochka(req, res) {
  const user = verifyInitData(req.body?.initData);
  if (!user) {
    res.status(401).json({ error: 'Не удалось подтвердить, что это ты — открой мини-апп заново из Telegram.' });
    return null;
  }
  const username = (user.username || '').toLowerCase();
  if (!WUVOCHKA_ROSTER.includes(username)) {
    res.status(403).json({ error: 'Доступа нет — обратись к @lzyloyd.' });
    return null;
  }
  return { username, id: user.id };
}

// One row per roster member for the admin's "Явка" block: their all-time
// no-show count, and which of this week's already-started sessions they
// could still be marked absent from (already-marked ones are left out so
// the button for that exact session simply disappears after use).
async function buildAttendanceView(week) {
  const attendance = await loadAttendance();
  const now = new Date();
  const startedSessions = computeWeekSessions(week).filter((s) => s.startsAt <= now);
  return ROSTER.map((username) => {
    const record = attendance[username];
    const markedThisWeek = new Set(
      (record?.history ?? []).filter((h) => h.weekStart === week.weekStart).map((h) => `${h.dayKey}|${h.slot}`),
    );
    const options = startedSessions
      .filter((s) => s.lineup.includes(username) && !markedThisWeek.has(`${s.dayKey}|${s.slot}`))
      .map((s) => ({ dayKey: s.dayKey, dayLabel: s.dayLabel, slot: s.slot, kind: DAYS.find((d) => d.key === s.dayKey).kind }));
    return { username, count: record?.count ?? 0, options };
  });
}

async function weekView(week, auth) {
  const weekStart = weekStartFromIso(week.weekStart);
  const daysOff = week.daysOff ?? [];
  return {
    days: weekDayDates(weekStart),
    quorum: QUORUM,
    roster: ROSTER,
    maxWarnings: MAX_WARNINGS,
    responses: week.responses,
    daysOff,
    edits: auth.isAdmin ? week.edits : [],
    summaryPreview: auth.isAdmin ? buildSummaryText(week) : null,
    attendance: auth.isAdmin ? await buildAttendanceView(week) : null,
    answeredCount: ROSTER.filter((u) => hasFullyAnswered(week.responses, u, daysOff)).length,
    me: { username: auth.username, isAdmin: auth.isAdmin, lastSaved: week.lastSaved?.[auth.username] || null },
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

  // Which bosses are currently in Tower of Adversity / Whimpering Wastes / DPM —
  // refreshed daily by scripts/fetch-boss-modes.mjs (see wuvochka-boss-modes.timer
  // on the VPS) into data/wuvochka-boss-modes.json, since encore.moe's own pages
  // block cross-origin fetch and can't be read straight from the client. Falls
  // back to an empty-but-valid shape before the first scrape has ever run.
  const bossModesPath = path.join(__dirname, '..', 'data', 'wuvochka-boss-modes.json');
  const emptyBossModes = {
    updated: null,
    tower: { label: null, bossIds: [] },
    wastes: { label: null, bossIds: [] },
    dpm: { label: null, bossIds: [] },
  };
  app.get('/wuvochka/boss-modes.json', async (req, res) => {
    try {
      res.type('application/json').send(await fs.readFile(bossModesPath, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('[miniapp] failed to read boss-modes.json:', err);
      res.json(emptyBossModes);
    }
  });

  app.use(express.static(path.join(__dirname, 'miniapp-public'), { etag: false, lastModified: false, cacheControl: false }));

  app.post('/api/state', async (req, res) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    const week = await loadCurrentWeek();
    res.json(await weekView(week, auth));
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
        handlePostDeadlineEdit(week.edits[0]).catch((err) =>
          console.error('[miniapp] failed to handle post-deadline edit:', err),
        );
      }
      res.json(await weekView(week, auth));
    } catch (err) {
      console.error('[miniapp] update failed:', err);
      res.status(500).json({ error: 'Не получилось сохранить, попробуй ещё раз.' });
    }
  });

  app.post('/api/set-day-off', async (req, res) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    if (!auth.isAdmin) {
      res.status(403).json({ error: 'Только админ может отмечать выходные.' });
      return;
    }
    const { day, isOff } = req.body ?? {};
    const dayDef = DAYS.find((d) => d.key === day);
    if (!dayDef || typeof isOff !== 'boolean') {
      res.status(400).json({ error: 'Некорректные данные.' });
      return;
    }
    try {
      const week = await setDayOff(day, isOff);
      scheduleUpcomingSessionReminders().catch((err) =>
        console.error('[miniapp] failed to reschedule session reminders after day-off toggle:', err),
      );
      res.json(await weekView(week, auth));
    } catch (err) {
      console.error('[miniapp] set-day-off failed:', err);
      res.status(500).json({ error: 'Не получилось сохранить, попробуй ещё раз.' });
    }
  });

  app.post('/api/mark-miss', async (req, res) => {
    const auth = authenticate(req, res);
    if (!auth) return;
    if (!auth.isAdmin) {
      res.status(403).json({ error: 'Только админ может отмечать неявки.' });
      return;
    }
    const { username, dayKey, slot } = req.body ?? {};
    if (!ROSTER.includes(username) || !DAYS.some((d) => d.key === dayKey) || typeof slot !== 'string') {
      res.status(400).json({ error: 'Некорректные данные.' });
      return;
    }
    try {
      const week = await loadCurrentWeek();
      const now = new Date();
      const session = computeWeekSessions(week).find(
        (s) => s.dayKey === dayKey && s.slot === slot && s.startsAt <= now && s.lineup.includes(username),
      );
      if (!session) {
        res.status(400).json({ error: 'Эта сессия не найдена, ещё не началась, или игрок не в составе.' });
        return;
      }
      const record = await recordMiss(username, week.weekStart, dayKey, slot, {
        dayLabel: session.dayLabel,
        dateIso: mskIsoDate(session.startsAt),
      });
      if (!record) {
        res.status(409).json({ error: 'Уже отмечено.' });
        return;
      }
      await sendTextTo(config.scheduleChatId, config.scheduleThreadId, buildMissWarningText(username, session, record.count));
      res.json(await weekView(week, auth));
    } catch (err) {
      console.error('[miniapp] mark-miss failed:', err);
      res.status(500).json({ error: 'Не получилось отметить, попробуй ещё раз.' });
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
      await sendSummary();
      res.json({ ok: true });
    } catch (err) {
      console.error('[miniapp] send-summary failed:', err);
      res.status(500).json({ error: 'Не получилось отправить сводку.' });
    }
  });

  app.post('/api/wuvochka/state', async (req, res) => {
    const auth = authenticateWuvochka(req, res);
    if (!auth) return;
    const profile = await loadProfile(auth.id);
    res.json(profile);
  });

  app.post('/api/wuvochka/update', async (req, res) => {
    const auth = authenticateWuvochka(req, res);
    if (!auth) return;
    const { action, charId } = req.body ?? {};
    if (!['favorite', 'owned', 'avatar'].includes(action) || !Number.isInteger(charId)) {
      res.status(400).json({ error: 'Некорректные данные.' });
      return;
    }
    try {
      const profile =
        action === 'favorite'
          ? await toggleFavorite(auth.id, charId)
          : action === 'owned'
            ? await toggleOwned(auth.id, charId)
            : await setAvatar(auth.id, charId);
      res.json(profile);
    } catch (err) {
      console.error('[miniapp] wuvochka update failed:', err);
      res.status(500).json({ error: 'Не получилось сохранить, попробуй ещё раз.' });
    }
  });

  const server = app.listen(config.miniappPort, () => {
    console.log(`[miniapp] listening on :${config.miniappPort}`);
  });
  return server;
}
