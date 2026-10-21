// The stats Google Sheet keys each player's row block by a Riot ID label —
// players rename in-game, and the sheet's label text may still be an older
// one. So each roster entry has its CURRENT Riot ID (what tracker.gg returns
// for new matches — matching is keyed on it) plus every older label that might
// still appear in the sheet's column Q for that person.
export const ROSTER = [
  { riotId: 'Space Kururugi#mench', sheetLabels: ['Space#flick', 'Space#mench'] },
  { riotId: 'ジ lzyloyd#pivo', sheetLabels: ['ジ lzyloyd#pivo'] },
  { riotId: 'AHotNik#2410', sheetLabels: ['toshir0000#6666'] },
  { riotId: 'Mench Lamperouge#space', sheetLabels: ['Mench#space'] },
  { riotId: 'Mania#uma', sheetLabels: ['Mania#uma'] },
  { riotId: 'Ax1oM#6525', sheetLabels: ['Ax1oM#6525'] },
  { riotId: 'speak with dead#amen', sheetLabels: ['speak with dead#amen'] },
  { riotId: 'MILITANTUM#bonr', sheetLabels: ['MILITANTUM#bonr'] },
];

// Any label text (lowercased) -> the roster's canonical (current) Riot ID (lowercased).
export const LABEL_TO_RIOT_ID = new Map(
  ROSTER.flatMap((r) => [r.riotId, ...r.sheetLabels].map((label) => [label.toLowerCase(), r.riotId.toLowerCase()])),
);
