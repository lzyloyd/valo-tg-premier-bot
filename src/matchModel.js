import { findOurTeamId } from './statsRoster.js';
import { rankName, rankIconUrl, averageTierId } from './rankTiers.js';
import { agentAsset, mapImageUrl } from './valorantAssets.js';
import { fetchPremierTeam, fetchPremierTeamV2, fetchPremierTeamByPlayer, fetchCurrentTier } from './henrikClient.js';

// A death counts as traded (the "T" in KAST) if a teammate kills the killer
// within this window — and a "multi-kill" round is one with at least this
// many kills.
const TRADE_WINDOW_MS = 5000;
const MULTI_KILL_MIN = 3;

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}м ${seconds}с`;
}

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

function isCustomQueue(queue) {
  const id = (queue?.id ?? '').toLowerCase();
  return !id || id === 'custom';
}

function playlistLabel(queue) {
  if (isCustomQueue(queue)) return 'Кастомка';
  return QUEUE_LABELS[queue.id.toLowerCase()] ?? queue.name ?? queue.id;
}

// Henrik's round result strings ("Elimination", "Bomb defused", "Bomb
// detonated", "Round timer expired", ...) -> the round-icon keys the card uses.
function roundResultKey(result) {
  const s = (result ?? '').toLowerCase();
  if (s.includes('defus')) return 'Defuse';
  if (s.includes('detonat')) return 'Detonate';
  // An empty result is how Henrik reports a round that ran out the clock.
  if (!s || s.includes('time') || s.includes('expire')) return 'Time';
  return 'Elimination';
}

const riotIdOf = (p) => `${p.name}#${p.tag}`;

/**
 * Per-player stats Henrik doesn't hand over ready-made, derived from the kill
 * feed: first kills/deaths, multi-kill rounds and KAST (rounds with a Kill,
 * Assist, Survived or Traded death). Matches tracker.gg's numbers on a
 * side-by-side check, including that a round with no kills at all (e.g. a
 * surrender) doesn't count as "survived".
 */
function deriveKillStats(match) {
  const killsByRound = new Map();
  for (const k of match.kills) {
    if (!killsByRound.has(k.round)) killsByRound.set(k.round, []);
    killsByRound.get(k.round).push(k);
  }

  const stats = new Map(match.players.map((p) => [p.puuid, { firstKills: 0, firstDeaths: 0, multiKills: 0, kastRounds: 0 }]));
  for (const { id: round } of match.rounds) {
    const kills = [...(killsByRound.get(round) ?? [])].sort((a, b) => a.time_in_round_in_ms - b.time_in_round_in_ms);
    if (kills.length) {
      const first = kills[0];
      if (stats.has(first.killer.puuid)) stats.get(first.killer.puuid).firstKills++;
      if (stats.has(first.victim.puuid)) stats.get(first.victim.puuid).firstDeaths++;
    }
    for (const p of match.players) {
      const s = stats.get(p.puuid);
      const killCount = kills.filter((k) => k.killer.puuid === p.puuid && k.victim.team !== p.team_id).length;
      if (killCount >= MULTI_KILL_MIN) s.multiKills++;
      const assisted = kills.some((k) => k.assistants?.some((a) => a.puuid === p.puuid));
      const death = kills.find((k) => k.victim.puuid === p.puuid);
      const traded =
        death &&
        kills.some(
          (k) =>
            k.victim.puuid === death.killer.puuid &&
            k.killer.team === p.team_id &&
            k.time_in_round_in_ms >= death.time_in_round_in_ms &&
            k.time_in_round_in_ms - death.time_in_round_in_ms <= TRADE_WINDOW_MS,
        );
      const survived = !death && kills.length > 0;
      if (killCount > 0 || assisted || survived || traded) s.kastRounds++;
    }
  }
  return stats;
}

// Which side a team played each round. A plant is always by the attackers
// and a defuse by the defenders; otherwise fall back to the fixed schedule —
// Red attacks rounds 1-12, Blue 13-24, then sides swap every overtime round.
function attackerTeamOf(round, roundNumber) {
  if (round.plant?.player?.team) return round.plant.player.team;
  if (round.defuse?.player?.team) return round.defuse.player.team === 'Red' ? 'Blue' : 'Red';
  if (roundNumber <= 12) return 'Red';
  if (roundNumber <= 24) return 'Blue';
  return (roundNumber - 25) % 2 === 0 ? 'Red' : 'Blue';
}

// Premier's division ladder: 1-5 Open, 6-10 Intermediate, 11-15 Advanced,
// 16-20 Elite (each tier numbered 1-5), then Contender and Invite.
function divisionName(division) {
  if (!division) return null;
  if (division >= 22) return 'Invite';
  if (division === 21) return 'Contender';
  const tiers = ['Open', 'Intermediate', 'Advanced', 'Elite'];
  return `${tiers[Math.floor((division - 1) / 5)]} ${((division - 1) % 5) + 1}`;
}

// "EU_DACH" -> "DACH", "EU_FRANCE" -> "France": short codes are acronyms.
function conferenceName(conference) {
  if (!conference) return null;
  const part = conference.replace(/^[A-Z]+_/, '');
  if (part.length <= 4) return part;
  return part.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');
}

// A side's Premier team, by majority: the team at least two of its players
// are on (one sub on another team, or on none, shouldn't decide it).
async function findPremierTeamByPlayers(players) {
  const votes = new Map();
  for (const p of players) {
    const team = await fetchPremierTeamByPlayer(p.puuid);
    if (!team) continue;
    const entry = votes.get(team.id) ?? { team, count: 0 };
    entry.count++;
    votes.set(team.id, entry);
    if (entry.count >= 2) return team;
  }
  return null;
}

// The current season's placement. A team that hasn't played the season yet
// only has a provisional one: its division matches what the game shows, but
// its conference doesn't (e.g. EU_EAST for a team the game lists in France),
// so the conference is dropped then. (v2's "enrolled" flag isn't usable —
// it's false even for teams that did play.)
function currentSeasonPlacement(teamV2) {
  const placement = teamV2?.current_season?.placement;
  if (!placement?.division) return null;
  return placement.is_provisional ? { division: placement.division, conference: null } : placement;
}

/**
 * Name, crest and standing ("#51 · Contender · DACH", the place only once the
 * team has played this season) of one side. A Premier
 * match carries its rosters; a custom one doesn't, so with `withStandings`
 * the team is found through its players instead.
 */
async function premierTeamInfo(players, roster, withStandings) {
  if (!withStandings) return roster ? { name: roster.name.trim(), logoUrl: roster.customization?.image ?? null } : null;

  const byPlayers = roster ? null : await findPremierTeamByPlayers(players);
  const id = roster?.id ?? byPlayers?.id;
  if (!id) return null;
  // v2 describes the current season (division, conference, matches played);
  // v1 has the league place but no season marker — it can still report last
  // season's — so its place only counts once the team has played this one.
  const teamV2 = byPlayers ?? (await fetchPremierTeamV2(id));
  const playedThisSeason = (teamV2?.current_season?.stats?.matches ?? 0) > 0;
  const standing = playedThisSeason || !teamV2 ? await fetchPremierTeam(id) : null;
  const placement = currentSeasonPlacement(teamV2) ?? standing?.placement;
  return {
    name: (roster?.name ?? teamV2?.name ?? standing?.name ?? '').trim() || null,
    logoUrl: roster?.customization?.image ?? teamV2?.customization?.image ?? standing?.customization?.image ?? null,
    rank: playedThisSeason ? standing?.placement?.place ?? null : null,
    divisionName: divisionName(placement?.division),
    zoneName: conferenceName(placement?.conference),
  };
}

/**
 * Turns a Henrik v4 match into the shape the scoreboard card and the stats
 * sheet use. "Our team" is whichever side any roster member (statsRoster.js)
 * played on; with none of us in the match it's a neutral team1-vs-team2 view
 * — unless `requireOurTeam` is set, which throws instead. `withStandings`
 * also looks up each Premier team's current placement (one extra API call
 * per team); `fillRanks` looks up the current rank of any player the match
 * itself left unranked (custom games carry no ranks).
 */
export async function buildMatchView(match, { requireOurTeam = false, withStandings = false, fillRanks = false } = {}) {
  const { metadata } = match;
  const roundCount = match.rounds.length;
  const isCustom = isCustomQueue(metadata.queue);

  const rosterTeamId = findOurTeamId(match.players.map((p) => ({ riotId: riotIdOf(p), teamId: p.team_id })));
  if (requireOurTeam && !rosterTeamId) {
    throw new Error('в матче нет никого из нашего состава');
  }
  const ourTeamId = rosterTeamId ?? match.teams[0]?.team_id;
  const otherTeamId = match.teams.map((t) => t.team_id).find((id) => id !== ourTeamId);

  const killStats = deriveKillStats(match);
  const perRound = (value) => (roundCount ? value / roundCount : 0);

  const toPlayer = async (p) => {
    const s = p.stats;
    const shots = s.headshots + s.bodyshots + s.legshots;
    const ks = killStats.get(p.puuid);
    const agent = await agentAsset(p.agent.id);
    const tierId = p.tier?.id || (fillRanks ? await fetchCurrentTier(p.puuid) : 0);
    return {
      name: p.name,
      riotId: riotIdOf(p),
      agentName: p.agent.name,
      agentColor: agent.color,
      agentImageUrl: agent.imageUrl,
      rankTierId: tierId,
      rankName: rankName(tierId),
      rankIconUrl: rankIconUrl(tierId),
      acs: Math.round(perRound(s.score)),
      kills: s.kills,
      deaths: s.deaths,
      assists: s.assists,
      plusMinus: s.kills - s.deaths,
      adr: Math.round(perRound(s.damage.dealt)),
      ddelta: Math.round(perRound(s.damage.dealt - s.damage.received)),
      hsAccuracy: shots ? Math.round((100 * s.headshots) / shots) : 0,
      kast: Math.round(100 * perRound(ks.kastRounds)),
      firstKills: ks.firstKills,
      firstDeaths: ks.firstDeaths,
      multiKills: ks.multiKills,
      kdRatio: Math.round((s.deaths ? s.kills / s.deaths : s.kills) * 100) / 100,
      trs: null, // tracker.gg's own score — not available outside tracker.gg
    };
  };

  const buildTeam = async (teamId) => {
    const team = match.teams.find((t) => t.team_id === teamId);
    const players = (await Promise.all(match.players.filter((p) => p.team_id === teamId).map(toPlayer))).sort(
      (a, b) => b.acs - a.acs,
    );
    return {
      roundsWon: team?.rounds?.won ?? 0,
      hasWon: team?.won ?? false,
      players,
      info: await premierTeamInfo(match.players.filter((p) => p.team_id === teamId), team?.premier_roster, withStandings),
    };
  };

  const [ourTeam, theirTeam] = await Promise.all([buildTeam(ourTeamId), buildTeam(otherTeamId)]);
  const mvp = [...ourTeam.players].sort((a, b) => b.acs - a.acs)[0];
  const ourAvgRankTierId = averageTierId(ourTeam.players.map((p) => p.rankTierId));
  const theirAvgRankTierId = averageTierId(theirTeam.players.map((p) => p.rankTierId));

  const rounds = [...match.rounds]
    .sort((a, b) => a.id - b.id)
    .map((r, i) => {
      const roundNumber = i + 1;
      const won = r.winning_team === ourTeamId;
      const winnerIsAttacker = attackerTeamOf(r, roundNumber) === r.winning_team;
      return {
        round: roundNumber,
        won,
        result: roundResultKey(r.result),
        // Side of whichever team actually won this round — that's the row
        // the timeline renders an icon into.
        winnerSide: winnerIsAttacker ? 'attacker' : 'defender',
      };
    });

  return {
    matchId: metadata.match_id,
    playlistName: playlistLabel(metadata.queue),
    isCustom,
    hasTrs: false,
    mapName: metadata.map.name,
    mapImageUrl: await mapImageUrl(metadata.map.id),
    dateStarted: metadata.started_at,
    durationText: formatDuration(Math.round(metadata.game_length_in_ms / 1000)),
    won: ourTeam.hasWon,
    ourScore: ourTeam.roundsWon,
    theirScore: theirTeam.roundsWon,
    ourTeam: ourTeam.players,
    ourTeamAvgRankName: rankName(ourAvgRankTierId),
    ourTeamAvgRankIconUrl: rankIconUrl(ourAvgRankTierId),
    ourTeamName: ourTeam.info?.name ?? 'Команда A',
    ourTeamLogoUrl: ourTeam.info?.logoUrl ?? null,
    ourTeamRank: ourTeam.info?.rank ?? null,
    ourTeamDivision: ourTeam.info?.divisionName ?? null,
    ourTeamZone: ourTeam.info?.zoneName ?? null,
    theirTeam: theirTeam.players,
    theirTeamAvgRankName: rankName(theirAvgRankTierId),
    theirTeamAvgRankIconUrl: rankIconUrl(theirAvgRankTierId),
    theirTeamName: theirTeam.info?.name ?? 'Команда B',
    theirTeamLogoUrl: theirTeam.info?.logoUrl ?? null,
    theirTeamRank: theirTeam.info?.rank ?? null,
    theirTeamDivision: theirTeam.info?.divisionName ?? null,
    theirTeamZone: theirTeam.info?.zoneName ?? null,
    rounds,
    mvp,
  };
}
