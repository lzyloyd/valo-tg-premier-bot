import { fetchPremierHistory } from '../src/henrikClient.js';
import { loadSeenMatchIds, saveSeenMatchIds } from '../src/state.js';

// Marks every Premier match in the team's history as already-posted, so the
// next scheduled poll only reacts to genuinely new matches.
const seen = await loadSeenMatchIds();
const history = await fetchPremierHistory();
for (const m of history) seen.add(m.id);
await saveSeenMatchIds(seen);
console.log(`Seeded ${history.length} match ids as already-seen (${seen.size} total).`);
