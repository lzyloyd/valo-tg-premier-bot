// The stats Google Sheet keys each player's row block by a Riot ID label —
// but which one varies by tab: the Premier tabs were set up earlier and
// still use three players' OLD Riot ID (before they changed their in-game
// tag/name), while at least one Praки tab already got updated to the
// CURRENT id. So each roster entry lists every label text that might appear
// in column Q/the game columns for that person, and matching tries all of
// them rather than assuming one fixed label per player.
export const ROSTER = [
  { riotId: 'Space#mench', sheetLabels: ['Space#flick', 'Space#mench'] },
  { riotId: 'AHotNik#2410', sheetLabels: ['toshir0000#6666', 'AHotNik#2410'] },
  { riotId: 'Mench Lamperouge#space', sheetLabels: ['Mench#space', 'Mench Lamperouge#space'] },
  { riotId: 'ANTiYou#9265', sheetLabels: ['ANTiYou#9265'] },
  { riotId: 'YozH#anf', sheetLabels: ['YozH#anf'] },
  { riotId: 'ジ lzyloyd#pivo', sheetLabels: ['ジ lzyloyd#pivo'] },
  { riotId: 'Mania#uma', sheetLabels: ['Mania#uma'] },
];

// Any label text (lowercased) -> the roster's canonical (current) Riot ID (lowercased).
export const LABEL_TO_RIOT_ID = new Map(
  ROSTER.flatMap((r) => [r.riotId, ...r.sheetLabels].map((label) => [label.toLowerCase(), r.riotId.toLowerCase()])),
);
