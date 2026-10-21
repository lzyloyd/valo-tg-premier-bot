import { fetchMatch } from '../src/henrikClient.js';
import { buildMatchView } from '../src/matchModel.js';

// Prints what the bot makes of one match (Henrik data -> card/sheet view),
// without rendering or posting anything.
//   node scripts/debug-match.mjs <matchId> [--raw]
const matchId = process.argv[2];
if (!matchId) {
  console.error('usage: node scripts/debug-match.mjs <matchId> [--raw]');
  process.exit(1);
}

const raw = await fetchMatch(matchId);
if (process.argv.includes('--raw')) {
  console.log(JSON.stringify(raw, null, 2));
  process.exit(0);
}
const match = await buildMatchView(raw, { withStandings: true });
console.log(`${match.mapName} · ${match.playlistName} · ${match.dateStarted} · ${match.durationText}`);
console.log(`${match.ourTeamName} ${match.ourScore}:${match.theirScore} ${match.theirTeamName} (won: ${match.won})`);
console.log(`standing: #${match.ourTeamRank} ${match.ourTeamDivision} ${match.ourTeamZone} | logo: ${match.ourTeamLogoUrl}`);
for (const [label, team] of [['ours', match.ourTeam], ['theirs', match.theirTeam]]) {
  console.log(`-- ${label}`);
  console.table(team.map(({ riotId, agentName, rankName, acs, kills, deaths, assists, adr, ddelta, hsAccuracy, kast, firstKills, firstDeaths, multiKills, kdRatio }) => ({
    riotId, agentName, rankName, acs, k: kills, d: deaths, a: assists, adr, ddelta, hs: hsAccuracy, kast, fk: firstKills, fd: firstDeaths, mk: multiKills, kd: kdRatio,
  })));
}
console.log('rounds:', match.rounds.map((r) => `${r.round}${r.won ? 'W' : 'L'}:${r.result[0]}${r.winnerSide[0]}`).join(' '));
console.log('mvp:', match.mvp.riotId);
