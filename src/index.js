import { teams, withTeam } from './scheduleTeams.js';
import { runPollCycle, runTeamPollCycle } from './poller.js';
import { statsTeams, withStatsTeam } from './statsTeams.js';
import { scheduleNext, scheduleWeeklyReset, scheduleDeadlineReminder, scheduleAutoSummary } from './scheduler.js';
import { runTelegramListener } from './telegramListener.js';
import { closeBrowser } from './browser.js';
import { startMiniAppServer } from './miniappServer.js';
import { resetWeekAndAnnounce, sendDeadlineReminder, sendAutoSummary, scheduleUpcomingSessionReminders } from './scheduleNotifications.js';
import { config } from './config.js';

const once = process.argv.includes('--once');

if (once) {
  await runPollCycle();
  await closeBrowser();
  process.exit(0);
} else {
  console.log('[index] tg-results-bot started. Scheduling Premier results per team.');
  for (const team of statsTeams.filter(t => t.autoReports && t.reportChatId)) {
    scheduleNext(() => withStatsTeam(team, runTeamPollCycle), team.reportTriggersUTC, team.name);
  }
  if (config.scheduleChatId && config.scheduleThreadId) {
    for (const team of teams.filter(t => t.enabled)) withTeam(team, () => {
      scheduleWeeklyReset(resetWeekAndAnnounce);
      scheduleDeadlineReminder(sendDeadlineReminder);
      scheduleAutoSummary(sendAutoSummary);
      // Recomputes from scratch on every boot — a mid-week restart would
      // otherwise silently lose the rest of that week's session reminders,
      // since they're plain in-memory timers, not persisted anywhere.
      scheduleUpcomingSessionReminders().catch((err) => console.error('[index] scheduling session reminders failed:', err));
    });
  }
  startMiniAppServer();
  runTelegramListener().catch((err) => {
    console.error('[index] Telegram listener crashed:', err);
    process.exit(1);
  });

  // Close Chromium cleanly on shutdown — otherwise systemd killing the whole
  // process tree can leave the profile directory's lock file behind for the
  // next start to trip over.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      console.log(`[index] received ${signal}, shutting down...`);
      await closeBrowser();
      process.exit(0);
    });
  }
}
