// The stats Google Sheet keys each player's row block by a label in column Q
// — players rename in-game, and the sheet's label text may still be an older
// one. So each roster entry has its CURRENT Riot ID (what tracker.gg returns
// for new matches — matching is keyed on it) plus every older label that might
// still appear in the sheet for that person. Order = row order in the sheet:
// starters (any order), then substitutes in priority order — keep it in step
// with MAIN_ROSTER / SUB_ROSTER in scheduleModel.js.
export const ROSTER = [
  // Starters
  { riotId: 'Space Kururugi#mench', sheetLabels: ['Space#flick', 'Space#mench'] }, // @Qu1ly
  { riotId: 'ジ lzyloyd#pivo', sheetLabels: [] }, // @lzyloyd
  { riotId: 'AHotNik#2410', sheetLabels: ['toshir0000#6666'] }, // @toshir0000
  { riotId: 'Ax1oM#6525', sheetLabels: [] }, // @KitKatFN
  { riotId: 'MILITANTUM#bonr', sheetLabels: [] }, // @Bonrik1
  // Substitutes, by priority
  { riotId: 'speak with dead#amen', sheetLabels: [] }, // @deadqq
  { riotId: 'Mench Lamperouge#space', sheetLabels: ['Mench#space'] }, // @Men4ikcs
  { riotId: 'Mania#uma', sheetLabels: [] }, // @mania_boo
];

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
export const LABEL_TO_RIOT_ID = new Map(
  ROSTER.flatMap((r) =>
    [r.riotId, ...r.sheetLabels]
      .flatMap((label) => [label, displayName(label)])
      .map((label) => [label.toLowerCase(), r.riotId.toLowerCase()]),
  ),
);

/** The teamId of the side any of our roster members played on, or null. Players: [{ riotId, teamId }]. */
export function findOurTeamId(players) {
  const ours = new Set(TEAM_RIOT_IDS.map((id) => id.toLowerCase()));
  return players.find((p) => ours.has(p.riotId.toLowerCase()))?.teamId ?? null;
}
