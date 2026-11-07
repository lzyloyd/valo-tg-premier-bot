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
console.log('PASS: Premier checks at Saturday 22:00 and 24:00 MSK, exact boundaries, Sunday and year rollover.');
