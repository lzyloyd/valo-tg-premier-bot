import { config } from './config.js';
import { rankName, rankIconUrl, averageTierId } from './rankTiers.js';

function riotName(identifier) {
  return identifier.split('#')[0];
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}м ${seconds}с`;
}

// tracker.gg's queueId is a lowercase internal slug, not a display name.
const QUEUE_LABELS = {
  competitive: 'Competitive',
  unrated: 'Unrated',
  premier: 'Premier',
  spikerush: 'Spike Rush',
  deathmatch: 'Deathmatch',
  swiftplay: 'Swiftplay',
  hurm: 'Team Deathmatch',
  onefa: 'Escalation',
  snowball: 'Snowball Fight',
};

function playlistLabel(queueId) {
  if (!queueId) return 'Матч';
  return QUEUE_LABELS[queueId.toLowerCase()] ?? queueId;
}

/**
 * Turns the raw tracker.gg match payload (data.segments is a flat bag of
 * team-summary / player-summary / round-summary / loadout-* entries) into
 * the shape the scoreboard template wants.
 *
 * `trackedRiotId` anchors which side is "our team" — defaults to the
 * configured tracked player and throws if they're not in this match
 * (existing behavior, relied on by the scheduled poller and the Premier
 * match command). Passing `trackedRiotId: null, requireTracked: false`
 * (the generic "покажи матч" command) skips that search entirely and just
 * treats whichever team appears first as "our" side — a neutral team1-vs-
 * team2 view instead of throwing.
 */
export function buildMatchView(raw, teamsInfo = {}, { trackedRiotId = config.trackedRiotId, requireTracked = true } = {}) {
  const teamSummaries = raw.segments.filter((s) => s.type === 'team-summary');
  const playerSummaries = raw.segments.filter((s) => s.type === 'player-summary');
  const roundSummaries = raw.segments.filter((s) => s.type === 'round-summary');

  const tracked = trackedRiotId
    ? playerSummaries.find((p) => p.attributes.platformUserIdentifier.toLowerCase() === trackedRiotId.toLowerCase())
    : null;
  if (requireTracked && !tracked) {
    throw new Error(`Tracked player ${trackedRiotId} not found in match ${raw.attributes.id}`);
  }
  const ourTeamId = tracked ? tracked.metadata.teamId : teamSummaries[0]?.attributes.teamId;
  const otherTeamId = teamSummaries.map((t) => t.attributes.teamId).find((id) => id !== ourTeamId);

  const toPlayer = (p) => ({
    name: riotName(p.attributes.platformUserIdentifier),
    agentName: p.metadata.agentName,
    agentColor: p.metadata.agentColor,
    agentImageUrl: p.metadata.agentImageUrl,
    rankTierId: p.stats.rank?.metadata?.tierId ?? 0,
    rankName: rankName(p.stats.rank?.metadata?.tierId ?? 0),
    rankIconUrl: rankIconUrl(p.stats.rank?.metadata?.tierId ?? 0),
    acs: Math.round(p.stats.scorePerRound?.value ?? 0),
    kills: p.stats.kills?.value ?? 0,
    deaths: p.stats.deaths?.value ?? 0,
    assists: p.stats.assists?.value ?? 0,
    plusMinus: (p.stats.kills?.value ?? 0) - (p.stats.deaths?.value ?? 0),
    adr: Math.round(p.stats.damagePerRound?.value ?? 0),
    ddelta: Math.round(p.stats.damageDeltaPerRound?.value ?? 0),
    hsAccuracy: Math.round(p.stats.hsAccuracy?.value ?? 0),
    kast: Math.round(p.stats.kast?.value ?? 0),
    firstKills: p.stats.firstKills?.value ?? 0,
    firstDeaths: p.stats.firstDeaths?.value ?? 0,
    trs: Math.round(p.stats.trnPerformanceScore?.value ?? 0),
  });

  const buildTeam = (teamId) => {
    const summary = teamSummaries.find((t) => t.attributes.teamId === teamId);
    const players = playerSummaries
      .filter((p) => p.metadata.teamId === teamId)
      .map(toPlayer)
      .sort((a, b) => b.acs - a.acs);
    return {
      roundsWon: summary?.stats.roundsWon?.value ?? 0,
      hasWon: summary?.metadata.hasWon ?? false,
      players,
    };
  };

  const ourTeam = buildTeam(ourTeamId);
  const theirTeam = buildTeam(otherTeamId);

  const mvp = [...ourTeam.players].sort((a, b) => b.trs - a.trs)[0];
  const ourAvgRankTierId = averageTierId(ourTeam.players.map((p) => p.rankTierId));
  const theirAvgRankTierId = averageTierId(theirTeam.players.map((p) => p.rankTierId));

  // tracker.gg's round-summary segments don't say which side a team played —
  // that only shows up per-player, on the "player-round" segments (one per
  // player per round, metadata.teamSide: 'attacker' | 'defender'). Any player
  // on our team gives the same answer, so this doesn't depend on a specific
  // tracked player being present.
  const ourSideByRound = new Map();
  for (const s of raw.segments) {
    if (s.type !== 'player-round') continue;
    if (s.metadata.teamId === ourTeamId) {
      ourSideByRound.set(s.attributes.round, s.metadata.teamSide);
    }
  }
  const oppositeSide = (side) => (side === 'attacker' ? 'defender' : 'attacker');

  const rounds = roundSummaries
    .map((r) => {
      const won = r.stats.winningTeam?.value === ourTeamId;
      const ourSide = ourSideByRound.get(r.attributes.round) ?? 'attacker';
      return {
        round: r.attributes.round,
        won,
        result: r.stats.roundResult?.value ?? 'Elimination',
        // Side of whichever team actually won this round — that's the row
        // the timeline renders an icon into.
        winnerSide: won ? ourSide : oppositeSide(ourSide),
      };
    })
    .sort((a, b) => a.round - b.round);

  return {
    matchId: raw.attributes.id,
    playlistName: playlistLabel(raw.metadata.queueId),
    mapName: raw.metadata.mapName,
    mapImageUrl: raw.metadata.mapImageUrl,
    dateStarted: raw.metadata.dateStarted,
    durationText: formatDuration(Math.round(raw.metadata.duration / 1000)),
    won: ourTeam.hasWon,
    ourScore: ourTeam.roundsWon,
    theirScore: theirTeam.roundsWon,
    ourTeam: ourTeam.players,
    ourTeamAvgRankName: rankName(ourAvgRankTierId),
    ourTeamAvgRankIconUrl: rankIconUrl(ourAvgRankTierId),
    ourTeamName: teamsInfo.ourTeam?.name ?? 'Команда A',
    ourTeamLogoUrl: teamsInfo.ourTeam?.logoUrl ?? null,
    ourTeamRank: teamsInfo.ourTeam?.rank ?? null,
    ourTeamDivision: teamsInfo.ourTeam?.divisionName ?? null,
    theirTeam: theirTeam.players,
    theirTeamAvgRankName: rankName(theirAvgRankTierId),
    theirTeamAvgRankIconUrl: rankIconUrl(theirAvgRankTierId),
    theirTeamName: teamsInfo.theirTeam?.name ?? 'Команда B',
    theirTeamLogoUrl: teamsInfo.theirTeam?.logoUrl ?? null,
    theirTeamRank: teamsInfo.theirTeam?.rank ?? null,
    theirTeamDivision: teamsInfo.theirTeam?.divisionName ?? null,
    rounds,
    mvp,
  };
}
