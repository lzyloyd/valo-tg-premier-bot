// tracker.gg's numeric competitive tier scale (0-2 are unranked placeholders,
// 3-27 are the 25 real ranked tiers). Confirmed against live match data:
// tierId 21/22/23 -> Ascendant 1/2/3, tierId 26 -> Immortal 3.
const RANK_NAMES = [
  'Unrated', 'Unrated', 'Unrated',
  'Iron 1', 'Iron 2', 'Iron 3',
  'Bronze 1', 'Bronze 2', 'Bronze 3',
  'Silver 1', 'Silver 2', 'Silver 3',
  'Gold 1', 'Gold 2', 'Gold 3',
  'Platinum 1', 'Platinum 2', 'Platinum 3',
  'Diamond 1', 'Diamond 2', 'Diamond 3',
  'Ascendant 1', 'Ascendant 2', 'Ascendant 3',
  'Immortal 1', 'Immortal 2', 'Immortal 3',
  'Radiant',
];

export function rankName(tierId) {
  return RANK_NAMES[tierId] ?? 'Unrated';
}

export function rankIconUrl(tierId) {
  return `https://trackercdn.com/cdn/tracker.gg/valorant/icons/tiersv2/${tierId ?? 0}.png`;
}

export function averageTierId(tierIds) {
  if (tierIds.length === 0) return 0;
  return Math.round(tierIds.reduce((sum, id) => sum + id, 0) / tierIds.length);
}
