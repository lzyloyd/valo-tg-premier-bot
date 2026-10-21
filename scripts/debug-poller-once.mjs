import fs from 'node:fs';
import { getBrowser, closeBrowser } from '../src/browser.js';
import { fetchMatch } from '../src/henrikClient.js';
import { buildMatchView } from '../src/matchModel.js';
import { renderScoreboardPng } from '../src/render/renderCard.js';

// Same path as poller.js's runPollCycle, but renders to a local file instead
// of posting to the team chat.
//   node scripts/debug-poller-once.mjs <matchId> [out.png]
const matchId = process.argv[2];
const outPath = process.argv[3] || '/tmp/debug-poller-once.png';
if (!matchId) {
  console.error('usage: node scripts/debug-poller-once.mjs <matchId> [out.png]');
  process.exit(1);
}

try {
  const match = await buildMatchView(await fetchMatch(matchId), { withStandings: true, fillRanks: true });
  match.playlistName = 'Premier';
  console.log('ourTeamName:', match.ourTeamName, '| theirTeamName:', match.theirTeamName);
  console.log('score:', match.ourScore, '-', match.theirScore, '| won:', match.won);
  fs.writeFileSync(outPath, await renderScoreboardPng(await getBrowser(), match));
  console.log(`OK — rendered to ${outPath}`);
} finally {
  await closeBrowser();
}
