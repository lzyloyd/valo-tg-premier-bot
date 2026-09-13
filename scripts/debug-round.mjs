import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getBrowser, closeBrowser } from '../src/browser.js';
import { gotoTrackerProfile, fetchMatchDetail } from '../src/trackerClient.js';
import { config } from '../src/config.js';

// Dumps the full raw match payload to disk, plus a de-duplicated list of
// every key name (grouped by segment type) that mentions side/attack/defense
// — the terminal-scrollback-friendly way to find an undocumented field.
const matchId = process.argv[2];
if (!matchId) {
  console.error('usage: node scripts/debug-round.mjs <matchId>');
  process.exit(1);
}

function collectKeys(node, path, into) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectKeys(item, path, into));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      into.add(`${path}.${key}`);
      collectKeys(value, `${path}.${key}`, into);
    }
  }
}

const browser = await getBrowser();
const page = await browser.newPage();
try {
  await gotoTrackerProfile(page);
  const raw = await fetchMatchDetail(page, matchId);
  const outPath = path.join(config.dataDir, 'debug-raw-match.json');
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(raw, null, 2));
  console.log(`wrote ${outPath}`);

  const playerRounds = raw.segments.filter((s) => s.type === 'player-round');
  const sampleIdentifier = playerRounds[0]?.attributes?.platformUserIdentifier;
  console.log(`\n--- player-round samples for ${sampleIdentifier}, first 6 rounds ---`);
  console.log(
    playerRounds
      .filter((s) => s.attributes.platformUserIdentifier === sampleIdentifier)
      .slice(0, 6)
      .map((s) => JSON.stringify({ attributes: s.attributes, metadata: s.metadata }))
      .join('\n'),
  );

  const bySegmentType = new Map();
  for (const segment of raw.segments) {
    const keys = bySegmentType.get(segment.type) ?? new Set();
    collectKeys(segment, segment.type, keys);
    bySegmentType.set(segment.type, keys);
  }

  const pattern = /side|attack|defen/i;
  for (const [type, keys] of bySegmentType) {
    const matches = [...keys].filter((k) => pattern.test(k));
    if (matches.length) {
      console.log(`\n--- ${type} ---`);
      console.log([...new Set(matches.map((k) => k.replace(/^[^.]+\./, '')))].sort().join('\n'));
    }
  }
} finally {
  await page.close();
  await closeBrowser();
}
