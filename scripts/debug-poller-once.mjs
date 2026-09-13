import { getBrowser, closeBrowser } from '../src/browser.js';
import { gotoTrackerProfile, fetchMatchDetail, fetchTeamStandings } from '../src/trackerClient.js';
import { buildMatchView } from '../src/matchModel.js';
import { renderScoreboardPng } from '../src/render/renderCard.js';
import { config } from '../src/config.js';
import fs from 'node:fs';

// Exercises the exact same code path as poller.js's runPollCycle (matchModel's
// tracked-player branch), but renders to a local file instead of posting to
// the team chat — for verifying the poller still works after a matchModel.js
// change, without spamming the group.
const matchId = process.argv[2];
if (!matchId) {
  console.error('usage: node scripts/debug-poller-once.mjs <matchId>');
  process.exit(1);
}

const browser = await getBrowser();
const page = await browser.newPage();
try {
  await gotoTrackerProfile(page);
  const raw = await fetchMatchDetail(page, matchId);
  const teamsInfo = await fetchTeamStandings(page, raw, config.trackedRiotId);
  const match = buildMatchView(raw, teamsInfo);
  match.playlistName = 'Premier';
  console.log('ourTeamName:', match.ourTeamName, '| theirTeamName:', match.theirTeamName);
  console.log('score:', match.ourScore, '-', match.theirScore, '| won:', match.won);
  const png = await renderScoreboardPng(browser, match);
  fs.writeFileSync('/tmp/debug-poller-once.png', png);
  console.log('OK — rendered to /tmp/debug-poller-once.png');
} finally {
  await page.close();
  await closeBrowser();
}
