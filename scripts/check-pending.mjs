import { fetchPremierHistory } from '../src/henrikClient.js';
import { loadSeenMatchIds } from '../src/state.js';

// Read-only dry run of the poller's own new-match check — lists the team's
// Premier matches and which ones the next poll would treat as unseen (the
// poller itself additionally ignores anything older than 3 days). Posts
// nothing, touches no state.
const seen = await loadSeenMatchIds();
const history = await fetchPremierHistory();
console.log(`${history.length} Premier matches in the team's history, ${seen.size} ids marked seen.`);
for (const m of history.slice(-10)) console.log(`  ${seen.has(m.id) ? 'seen' : 'NEW '}  ${m.id}  ${m.startedAt}`);
