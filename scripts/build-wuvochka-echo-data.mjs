// One-time (re-runnable) build step: pulls the curated echo data hand-built
// this session — via prydwen.gg scraping, since Encore's own echo API has no
// cost/class/set-membership info at all — out of the Claude Artifact
// prototype (scratch/wuvochka-concept.html) and turns it into a static JSON
// file the real mini-app serves directly, no scraping at runtime.
//
// It also resolves a real per-echo icon for each of the 181 individual
// echoes by matching its name against wuwa-assets/echoes/index.json (the
// same Encore-sourced icon set already committed for the "Резалтик,
// вувочка" mini-app) — the Artifact prototype had to share one "flagship"
// image across every echo in a set because of its 256-file cap; the real
// app has no such limit, so every echo gets its own icon where Encore has
// a name match, falling back to the set's own badge otherwise.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTOTYPE_PATH = path.join(__dirname, '..', 'scratch', 'wuvochka-concept.html');
const ECHOES_INDEX_PATH = path.join(__dirname, '..', 'src', 'miniapp-public', 'wuwa-assets', 'echoes', 'index.json');
const OUT_PATH = path.join(__dirname, '..', 'src', 'miniapp-public', 'wuvochka', 'echo-data.json');

function extractConst(source, name) {
  const re = new RegExp(`^const ${name} = (.+);$`, 'm');
  const match = source.match(re);
  if (!match) throw new Error(`Could not find "const ${name} = ...;" in ${PROTOTYPE_PATH}`);
  // These are JS object/array literals (some use bare keys like {n:2,t:"..."}),
  // not strict JSON — safe to eval here since it's our own trusted local file.
  return new Function(`return (${match[1]});`)();
}

async function main() {
  const source = await fs.readFile(PROTOTYPE_PATH, 'utf8');
  const echoSets = extractConst(source, 'ECHOES'); // the 34 sonata sets
  const echoItems = extractConst(source, 'ECHO_ITEMS'); // the 181 individual echoes
  const echoFacts = extractConst(source, 'ECHO_FACTS'); // 2/5-piece bonus text per set
  const classRu = extractConst(source, 'CLASS_RU');

  const encoreEchoes = JSON.parse(await fs.readFile(ECHOES_INDEX_PATH, 'utf8'));
  const encoreByName = new Map(encoreEchoes.map((e) => [e.name.toLowerCase(), e]));

  let matched = 0;
  const items = echoItems.map((it) => {
    const encoreMatch = encoreByName.get(it.n.toLowerCase());
    if (encoreMatch) matched++;
    return {
      name: it.n,
      class: it.cl,
      classRu: it.cl ? (classRu[it.cl] || it.cl) : null,
      cost: it.co,
      element: it.e,
      sets: it.s,
      icon: encoreMatch ? `/wuwa-assets/echoes/${encoreMatch.file}` : null,
    };
  });

  const sets = echoSets.map((s) => ({
    name: s.name,
    element: s.element,
    badge: `/wuwa-assets/echo-sets/${s.icon}.webp`,
    bonuses: echoFacts[s.name]?.bonuses || null,
  }));

  const withIcon = items.filter((it) => it.icon).length;
  console.log(`[build-wuvochka-echo-data] ${sets.length} sets, ${items.length} echoes, ${withIcon}/${items.length} matched a real Encore icon by name`);
  if (withIcon < items.length) {
    console.log('  (no match — will fall back to the item\'s first set\'s badge on the frontend):');
    for (const it of items) if (!it.icon) console.log(`    - ${it.name}`);
  }

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify({ sets, items }, null, 2));
  console.log(`[build-wuvochka-echo-data] wrote ${OUT_PATH}`);
}

await main();
