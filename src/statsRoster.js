// The stats Google Sheet keys each player's row block by whatever Riot ID
// they had when the sheet was set up — three of the seven have since
// changed their tag/name in-game, so a fresh match's platformUserIdentifier
// no longer matches the sheet's label text directly. This maps each
// teammate's CURRENT Riot ID (lowercased) to their (possibly stale) sheet
// label, so lookups by current Riot ID still find the right row.
export const SHEET_PLAYER_LABELS = {
  'space#mench': 'Space#flick',
  'ahotnik#2410': 'toshir0000#6666',
  'mench lamperouge#space': 'Mench#space',
  'antiyou#9265': 'ANTiYou#9265',
  'yozh#anf': 'YozH#anf',
  'ジ lzyloyd#pivo': 'ジ lzyloyd#pivo',
  'mania#uma': 'Mania#uma',
};

export function sheetLabelForRiotId(riotId) {
  return SHEET_PLAYER_LABELS[riotId.toLowerCase()] ?? null;
}

// For matching a player-block anchor row even where the sheet's column Q
// happens to be blank for that row (seen on at least one existing tab) —
// falls back to any cell in the row whose text is one of these labels.
export const KNOWN_SHEET_LABELS_LOWER = new Set(Object.values(SHEET_PLAYER_LABELS).map((s) => s.toLowerCase()));
