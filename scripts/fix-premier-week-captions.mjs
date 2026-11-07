import assert from 'node:assert/strict';
import { currentStatsTeam } from '../src/statsTeams.js';
import { mapWeekCaption } from '../src/sheetsAnnounce.js';
import { editMessageCaption } from '../src/telegram.js';
import { getSpreadsheetMeta } from '../src/sheetsClient.js';

// Message IDs supplied by the manager; edit these existing photos only.
const team = currentStatsTeam();
assert.equal(String(team.chatId), '-1002839191830');
assert.equal(team.spreadsheetId, '1mFUXQPeRIdtSuRKhYUXvqG1W0dLj-NzIc7Q76SMC-wg');
const sheets = await getSpreadsheetMeta(team.spreadsheetId);
const plan = [];
for (const [messageId, tabTitle, week] of [[32317, 'Bind - Premier', 1], [32321, 'Corrode - Premier', 2]]) {
  const sheet = sheets.find(s => s.title === tabTitle);
  assert(sheet, tabTitle);
  const caption = await mapWeekCaption({ spreadsheetId: team.spreadsheetId, sheetId: sheet.sheetId, tabTitle });
  assert(caption.startsWith(`${week} неделя `));
  plan.push({ messageId, tabTitle, caption });
}
if (!process.argv.includes('--apply')) console.log(JSON.stringify(plan, null, 2));
else for (const p of plan) {
  const edited = await editMessageCaption(team.chatId, p.messageId, p.caption);
  if (edited) {
    assert.equal(edited.message_id, p.messageId);
    assert.equal(String(edited.chat.id), String(team.chatId));
    assert.equal(edited.message_thread_id, 3240);
    assert(edited.photo?.length > 0);
    // Telegram returns plain caption text after parsing HTML entities.
    assert.equal(edited.caption.split('\n')[0], p.caption.split('\n')[0]);
  }
  console.log(`Verified caption: ${p.messageId} ${p.tabTitle}`);
}
