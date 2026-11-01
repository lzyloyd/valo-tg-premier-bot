import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']) process.env[key] ||= 'test';
const {
  DAYS, daysForWeek, ROSTER, MAIN_ROSTER, SUB_ROSTER, resolveLineup, currentWeekStart, mskIsoDate, weekDayDates,
  weekDeadline, weekResetInstant, reminderInstant, nextResetInstant,
  nextReminderInstant, nextDeadlineInstant, hasFullyAnswered,
  slotInstant, computeWeekSessions, buildSummaryText,
} = await import('../src/scheduleModel.js');

assert.deepEqual(SUB_ROSTER, ['deadqq', 'men4ikcs', 'mania_boo']);
assert(SUB_ROSTER.every(u => ROSTER.includes(u)) && MAIN_ROSTER.every(u => ROSTER.includes(u)));
for (let mask = 0; mask < 2 ** ROSTER.length; mask++) {
  const available = ROSTER.filter((_, i) => mask & (1 << i));
  const mains = MAIN_ROSTER.filter(u => available.includes(u));
  const subs = SUB_ROSTER.filter(u => available.includes(u));
  const lineup = resolveLineup(available);
  const missing = 5 - mains.length;
  assert.equal(Boolean(lineup), subs.length >= missing);
  if (lineup) assert.deepEqual(lineup, [...mains, ...subs.slice(0, missing)]);
}
assert.deepEqual(resolveLineup([...MAIN_ROSTER.slice(1), ...SUB_ROSTER]), [...MAIN_ROSTER.slice(1), 'deadqq']);
assert.deepEqual(resolveLineup([...MAIN_ROSTER.slice(1), 'men4ikcs', 'mania_boo']), [...MAIN_ROSTER.slice(1), 'men4ikcs']);
assert.deepEqual(resolveLineup([...MAIN_ROSTER.slice(1), 'mania_boo']), [...MAIN_ROSTER.slice(1), 'mania_boo']);
assert.deepEqual(resolveLineup([...MAIN_ROSTER.slice(2), ...SUB_ROSTER]), [...MAIN_ROSTER.slice(2), 'deadqq', 'men4ikcs']);
assert.deepEqual(resolveLineup([...MAIN_ROSTER.slice(3), ...SUB_ROSTER]), [...MAIN_ROSTER.slice(3), ...SUB_ROSTER]);

const now = new Date('2026-10-12T10:00:00Z');
const start = currentWeekStart(now);
assert.equal(mskIsoDate(start), '2026-10-12');
assert.deepEqual(weekDayDates(start).map(d => d.dateIso), [
  '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15',
  '2026-10-16', '2026-10-17', '2026-10-18',
]);
assert.equal(weekDeadline(start).toISOString(), '2026-10-12T11:00:00.000Z'); // Mon 14:00 MSK
assert.equal(reminderInstant(start).toISOString(), '2026-10-12T07:00:00.000Z'); // Mon 10:00 MSK
assert.equal(weekResetInstant(start).toISOString(), '2026-10-18T21:00:00.000Z');
assert.equal(mskIsoDate(currentWeekStart(new Date('2026-10-18T20:59:59Z'))), '2026-10-12');
assert.equal(mskIsoDate(currentWeekStart(new Date('2026-10-18T21:00:00Z'))), '2026-10-19');
assert.equal(nextResetInstant(new Date('2026-10-18T21:00:00Z')).toISOString(), '2026-10-25T21:00:00.000Z');
assert.equal(nextReminderInstant(new Date('2026-10-11T16:59:59Z')).toISOString(), '2026-10-12T07:00:00.000Z');
assert.equal(nextReminderInstant(new Date('2026-10-12T07:00:00Z')).toISOString(), '2026-10-19T07:00:00.000Z');
assert.equal(nextDeadlineInstant(new Date('2026-10-11T17:00:00Z')).toISOString(), '2026-10-12T11:00:00.000Z');
assert.equal(nextDeadlineInstant(new Date('2026-10-12T11:00:00Z')).toISOString(), '2026-10-19T11:00:00.000Z');
assert.equal(slotInstant(start, 'mon', '20:00').toISOString(), '2026-10-12T17:00:00.000Z');
assert.equal(slotInstant(start, 'sat', '23:00').toISOString(), '2026-10-17T20:00:00.000Z');
assert.deepEqual(DAYS.find(d=>d.key==='sat').slots,['21:00','23:00']);

const responses = Object.fromEntries(MAIN_ROSTER.map(u => [u, Object.fromEntries(
  DAYS.filter(d => d.key !== 'mon').map(d => [d.key, { avail: 'yes', slots: d.slots }]),
)]));
assert(!hasFullyAnswered(responses, MAIN_ROSTER[0]));
assert(hasFullyAnswered(responses, MAIN_ROSTER[0], ['mon']));
for (const u of MAIN_ROSTER) responses[u].mon = { avail: 'yes', slots: ['20:00', '22:00'] };
assert(hasFullyAnswered(responses, MAIN_ROSTER[0]));
const week = { weekStart: '2026-10-12', responses, daysOff: [] };
const sessions = computeWeekSessions(week);
assert.equal(sessions.length, 7);
assert.equal(sessions[0].dayKey, 'mon');
assert.equal(sessions[0].slot, '20:00');
assert(buildSummaryText(week).includes('12.10–18.10'));
assert(buildSummaryText(week).includes('Понедельник 12.10'));

// Sunday gatherings can run after the old 20:00 rollover.
assert.equal(mskIsoDate(currentWeekStart(new Date('2026-10-18T19:30:00Z'))), '2026-10-12');
const lateWeek = structuredClone(week);
lateWeek.customSlots = {sun:['22:30']};
for (const u of MAIN_ROSTER) lateWeek.responses[u].sun = {avail:'yes',slots:['22:30']};
const lateSession = computeWeekSessions(lateWeek).find(s => s.dayKey === 'sun');
assert.equal(lateSession.slot, '22:30');
assert.equal(lateSession.startsAt.toISOString(), '2026-10-18T19:30:00.000Z');
assert(buildSummaryText(lateWeek).includes('22:30'));
assert(buildSummaryText(week).includes('☀️ выходной'));

const namedWeek = structuredClone(week);
namedWeek.customSlots = {mon:['19:00'],sat:['19:30'],sun:['18:00']};
namedWeek.customSlotNames = {mon:{'19:00':'Турнир'},sat:{'19:30':'Разбор'},sun:{'18:00':'МСК турнир'}};
for (const u of MAIN_ROSTER) namedWeek.responses[u].mon.slots.push('19:00');
assert.equal(daysForWeek(namedWeek)[0].kind,'Праки · Турнир');
assert.equal(daysForWeek(namedWeek)[5].kind,'Премьер · Разбор');
assert.equal(daysForWeek(namedWeek)[6].kind,'МСК турнир');
assert.deepEqual(computeWeekSessions(namedWeek).filter(s=>s.dayKey==='mon').map(s=>[s.slot,s.kind]),[['19:00','Турнир'],['20:00','Праки']]);
assert(buildSummaryText(namedWeek).includes('Праки · Турнир'));

// Use an isolated directory: this test never touches real schedule data.
for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']) {
  process.env[key] ||= 'test';
}
const { config } = await import('../src/config.js');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'schedule-test-'));
const oldPaths = { dataDir: config.dataDir, scheduleDataPath: config.scheduleDataPath, attendanceDataPath: config.attendanceDataPath };
Object.assign(config, { dataDir: dir, scheduleDataPath: path.join(dir, 'schedule.json'), attendanceDataPath: path.join(dir, 'attendance.json') });
try {
  const { loadCurrentWeek, setResponse } = await import('../src/scheduleStore.js');
  const { recordMiss } = await import('../src/attendanceStore.js');
  await fs.writeFile(config.scheduleDataPath, JSON.stringify({ ...week, weekStart: '2026-10-13', edits: [], summaryMessageId: 123 }));
  const migrated = await loadCurrentWeek(now);
  assert.equal(migrated.weekStart, '2026-10-12');
  assert.deepEqual(migrated.responses, responses);
  assert.equal(migrated.summaryMessageId, 123);
  assert(!(await setResponse(MAIN_ROSTER[1], 'mon', 'no', [], new Date('2026-10-12T10:59:00Z'))).isPostDeadlineEdit); // Mon 13:59 MSK
  const result = await setResponse(MAIN_ROSTER[0], 'mon', 'no', [], new Date('2026-10-12T11:01:00Z')); // Mon 14:01 MSK
  assert(result.isPostDeadlineEdit);
  await fs.writeFile(config.attendanceDataPath, JSON.stringify({ qu1ly: { count: 1, history: [{ weekStart: '2026-10-13', dayKey: 'tue', slot: '20:00', dateIso: '2026-10-13' }] } }));
  assert.equal(await recordMiss('qu1ly', '2026-10-12', 'tue', '20:00', { dateIso: '2026-10-13' }), null);
  const oldPremierWeek = structuredClone(week);
  oldPremierWeek.responses[MAIN_ROSTER[0]].sat = {avail:'yes',slots:['20:00','22:00']};
  await fs.writeFile(config.scheduleDataPath,JSON.stringify(oldPremierWeek));
  const updatedPremier = await loadCurrentWeek(now);
  assert.equal(updatedPremier.responses[MAIN_ROSTER[0]].sat,undefined);
  assert.deepEqual(updatedPremier.responses[MAIN_ROSTER[0]].mon,week.responses[MAIN_ROSTER[0]].mon);
  assert.equal(updatedPremier.premierTimesVersion,2);
  const fresh = await loadCurrentWeek(new Date('2026-10-18T21:00:00Z'));
  assert.equal(fresh.weekStart, '2026-10-19');
  assert.deepEqual(fresh.responses, {});
} finally {
  Object.assign(config, oldPaths);
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('PASS: Monday sessions, 7-day calendar, Monday 14:00 deadline, Monday rollover, preserved answers, attendance deduplication.');
