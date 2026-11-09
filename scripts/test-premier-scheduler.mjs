import assert from 'node:assert/strict';
process.env.TELEGRAM_BOT_TOKEN ||= 'test';
process.env.TELEGRAM_CHAT_ID ||= '-1';
const { nextTriggerAt } = await import('../src/scheduler.js');
const cases = [
  ['2026-11-07T18:59:59Z', '2026-11-07T19:00:00.000Z'],
  ['2026-11-07T19:00:00Z', '2026-11-07T21:00:00.000Z'],
  ['2026-11-07T20:59:59Z', '2026-11-07T21:00:00.000Z'],
  ['2026-11-07T21:00:00Z', '2026-11-14T19:00:00.000Z'],
  ['2026-11-08T00:00:00Z', '2026-11-14T19:00:00.000Z'],
  ['2026-12-31T23:59:59Z', '2027-01-02T19:00:00.000Z'],
];
for (const [now, expected] of cases) assert.equal(nextTriggerAt(new Date(now)).toISOString(), expected);
const { statsTeams } = await import('../src/statsTeams.js');
const clarity = statsTeams.find(t => t.id === 'clarity');
const clarityCases = [
  ['2026-11-09T08:00:00Z', '2026-11-12T19:00:00.000Z'],
  ['2026-11-12T19:00:00Z', '2026-11-12T20:00:00.000Z'],
  ['2026-11-12T20:00:00Z', '2026-11-14T20:00:00.000Z'],
  ['2026-11-14T20:00:00Z', '2026-11-14T21:00:00.000Z'],
  ['2026-11-14T21:00:00Z', '2026-11-15T19:00:00.000Z'],
  ['2026-11-15T19:00:00Z', '2026-11-15T20:00:00.000Z'],
  ['2026-11-15T20:00:00Z', '2026-11-19T19:00:00.000Z'],
];
for (const [now, expected] of clarityCases) assert.equal(nextTriggerAt(new Date(now), clarity.reportTriggersUTC).toISOString(), expected);
assert.equal(clarity.reportThreadId, '1583');
assert.equal(clarity.threadId, '763');
console.log('PASS: Premier checks at Saturday 22:00 and 24:00 MSK, exact boundaries, Sunday and year rollover.');
console.log('PASS: Clarity checks Thu/Sun 22:00 and 23:00, Sat 23:00 and 00:00 MSK, separate results topic.');
