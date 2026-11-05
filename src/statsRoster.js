import { currentStatsTeam, statsTeams } from './statsTeams.js';
// The stats Google Sheet keys each player's row block by a label in column Q
// — players rename in-game, and the sheet's label text may still be an older
// one. So each roster entry has its CURRENT Riot ID (what tracker.gg returns
// for new matches — matching is keyed on it) plus every older label that might
// still appear in the sheet for that person. Order = row order in the sheet:
// starters (any order), then substitutes in priority order — keep it in step
// with MAIN_ROSTER / SUB_ROSTER in scheduleModel.js.
export const ROSTER = statsTeams[0].roster;

// The team's current Riot IDs — the one source of truth for "which side is
// ours" in a match.
export const TEAM_RIOT_IDS = ROSTER.map((r) => r.riotId);

/** "Name#tag" -> "Name" — how players are labelled in the sheet. */
export function displayName(riotId) {
  return riotId.split('#')[0];
}

export function trackerProfileUrl(riotId) {
  return `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(riotId)}?playlist=premier&force-defaults`;
}

// Any label text (lowercased) -> the roster's canonical (current) Riot ID
// (lowercased). Sheet labels are shown without the tag, so each Riot ID and
// old label is registered both with and without it.
export function currentLabelMap() { return new Map(
  currentStatsTeam().roster.flatMap((r) =>
    [r.riotId, ...r.sheetLabels]
      .flatMap((label) => [label, displayName(label)])
      .map((label) => [label.toLowerCase(), r.riotId.toLowerCase()]),
  ),
); }
export const LABEL_TO_RIOT_ID = currentLabelMap();

/** The teamId of the side any of our roster members played on, or null. Players: [{ riotId, teamId }]. */
export function findOurTeamId(players) {
  const ours = new Set(currentStatsTeam().roster.map(r=>r.riotId).map((id) => id.toLowerCase()));
  const counts = new Map();
  for(const player of players) if(ours.has(player.riotId.toLowerCase())) counts.set(player.teamId,(counts.get(player.teamId)||0)+1);
  const ranked = [...counts].sort((a,b)=>b[1]-a[1]);
  return ranked.length && (ranked.length===1 || ranked[0][1]>ranked[1][1]) ? ranked[0][0] : null;
}
