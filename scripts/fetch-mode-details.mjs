// Scrapes encore.moe for the FULL rules of the current Tower of Adversity /
// Whimpering Wastes / Doubled Pawn Matrix rotation (buffs, target scores,
// floor/stage enemy lists, per-boss notes, character buffs) and writes
// data/wuvochka-mode-details.json. This is straight game data (not editorial
// prose), so it's carried over close to verbatim rather than rephrased.
//
// Parsing approach: encore.moe's markup is plain Tailwind utility classes with
// no semantic hooks, so instead of depending on that structure this reads the
// rendered page's plain text (like fetch-boss-modes.mjs does for boss
// presence) and splits it on the game's own stable UI strings ("Tower Buffs",
// "Targets", "Cost: N", "Stage N", "Suggested Buff", ...). The one thing that
// genuinely requires DOM access is switching between the area/level/variant
// tabs, which are client-side state, not separate URLs (Tower's 3 zones are
// the exception — those ARE a ?area= query param). Two Tailwind class
// combinations reliably identify the two tab-row levels across all three page
// types: `div.inline-flex.rounded-xl` (top-level: Tower zone / Wastes area /
// DPM variant) and `div.inline-flex.rounded-lg` (second-level: Wastes
// difficulty number). If encore.moe ever reworks its frontend these selectors
// break — same risk the existing boss-mode scraper already accepts.
//
// Run manually: node scripts/fetch-mode-details.mjs
// Normally only runs when scripts/fetch-boss-modes.mjs's daily 00:00 UTC scrape
// sees the season/phase label change (see the call from there) — this scrape
// is much heavier (dozens of tab switches) so it's skipped on days nothing
// actually rotated.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'data', 'wuvochka-mode-details.json');
const ICON_DIR = path.join(__dirname, '..', 'data', 'wuvochka-enemy-icons');
const MONSTER_API = 'https://api-v2.encore.moe/api/en/monster';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function lines(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

function toNumber(line) {
  return Number(line.replace(/[^\d]/g, ''));
}

async function mainText(page) {
  return page.evaluate(() => document.querySelector('main')?.innerText || '');
}

async function topTabLabels(page) {
  return page.$$eval('main div.inline-flex.rounded-xl button', (btns) => btns.map((b) => b.textContent.trim()));
}

async function subTabLabels(page) {
  return page.$$eval('main div.inline-flex.rounded-lg button', (btns) => btns.map((b) => b.textContent.trim()));
}

async function clickTab(page, containerSelector, label) {
  await page.evaluate(
    (containerSelector, label) => {
      const btns = Array.from(document.querySelectorAll('main ' + containerSelector + ' button'));
      const btn = btns.find((b) => b.textContent.trim() === label);
      if (btn) btn.click();
    },
    containerSelector,
    label,
  );
  await new Promise((resolve) => setTimeout(resolve, 800));
}

async function currentNumber(page, listUrl, pattern) {
  await page.goto(listUrl, { waitUntil: 'networkidle2', timeout: 45000 });
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
  const nums = hrefs.map((h) => (h ? h.match(pattern) : null)).filter(Boolean).map((m) => Number(m[1]));
  if (!nums.length) throw new Error(`no numbered links found at ${listUrl}`);
  return Math.max(...nums);
}

// ---------- Tower of Adversity ----------

function parseFloorGroups(L, start, end) {
  const groups = [];
  let current = null;
  for (let i = start; i < end; i++) {
    const m = L[i].match(/^Floors: (.+)$/);
    if (m) {
      current = { floors: m[1], lines: [] };
      groups.push(current);
    } else if (current) {
      current.lines.push(L[i]);
    }
  }
  return groups;
}

function parseTowerArea(text) {
  const L = lines(text);
  const buffsIdx = L.indexOf('Tower Buffs');
  const targetsIdx = L.indexOf('Targets', buffsIdx + 1);
  const buffs = buffsIdx >= 0 && targetsIdx > buffsIdx ? parseFloorGroups(L, buffsIdx + 1, targetsIdx) : [];
  let costStart = targetsIdx >= 0 ? targetsIdx + 1 : L.length;
  while (costStart < L.length && !/^Cost: \d+$/.test(L[costStart])) costStart++;
  const targets = targetsIdx >= 0 ? parseFloorGroups(L, targetsIdx + 1, costStart) : [];

  const floors = [];
  let i = costStart;
  while (i < L.length) {
    const costMatch = L[i].match(/^Cost: (\d+)$/);
    if (!costMatch) break;
    const cost = Number(costMatch[1]);
    i++;
    const floorMatch = L[i] ? L[i].match(/^Floor (\d+)$/) : null;
    const floor = floorMatch ? Number(floorMatch[1]) : null;
    if (floorMatch) i++;
    const enemies = [];
    while (i < L.length && !/^Cost: \d+$/.test(L[i])) {
      enemies.push(L[i]);
      i++;
    }
    floors.push({ floor, cost, enemies });
  }
  return { buffs, targets, floors };
}

async function scrapeTower(page, season) {
  const zoneDefs = [
    { key: 'resonant', area: 1 },
    { key: 'hazard', area: 2 },
    { key: 'echoing', area: 3 },
  ];
  const areas = [];
  for (const def of zoneDefs) {
    await page.goto(`https://encore.moe/toa/${season}?area=${def.area}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const labels = await topTabLabels(page);
    const title = labels[def.area - 1] || def.key;
    const parsed = parseTowerArea(await mainText(page));
    areas.push({ key: def.key, title, ...parsed });
  }
  return { label: `Season ${season}`, areas };
}

// ---------- Whimpering Wastes ----------

function parseWastesLevel(text, skipLabels) {
  const L = lines(text);
  const seasonIdx = L.findIndex((l) => /^Season \d+$/.test(l));
  let i = seasonIdx >= 0 ? seasonIdx + 1 : 0;
  while (i < L.length && skipLabels.has(L[i])) i++;

  const mechanicName = L[i] || null;
  i++;
  const mechanicLines = [];
  while (i < L.length && L[i] !== 'Tokens' && L[i] !== 'Target Scores') {
    mechanicLines.push(L[i]);
    i++;
  }
  const tokens = [];
  if (L[i] === 'Tokens') {
    i++;
    while (i < L.length && L[i] !== 'Target Scores') {
      tokens.push(L[i]);
      i++;
    }
  }
  const targetScores = [];
  if (L[i] === 'Target Scores') {
    i++;
    while (i < L.length && /^[\d\s.,]+$/.test(L[i]) && !/^Stage \d+$/.test(L[i])) {
      targetScores.push(toNumber(L[i]));
      i++;
    }
  }
  const stages = [];
  while (i < L.length) {
    const m = L[i].match(/^Stage (\d+)$/);
    if (!m) break;
    const stage = Number(m[1]);
    i++;
    let note = null;
    if (L[i] && L[i].startsWith('When ')) {
      note = L[i];
      i++;
    }
    // Some stages call out a recommended damage type just above the enemy
    // grid, rendered as a lone "<Element> RES" line (e.g. "Fusion RES") —
    // that's the stage's weakness hint, not an enemy name.
    let weakness = null;
    if (L[i] && /^[A-Za-z]+ RES$/.test(L[i])) {
      weakness = L[i];
      i++;
    }
    const enemies = [];
    while (i < L.length && !/^Stage \d+$/.test(L[i])) {
      enemies.push(L[i]);
      i++;
    }
    stages.push({ stage, note, weakness, enemies });
  }
  return { mechanicName, mechanicLines, tokens, targetScores, stages };
}

async function scrapeWastes(page, season) {
  await page.goto(`https://encore.moe/whiwa/${season}`, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const areaLabels = await topTabLabels(page);
  const effectiveAreas = areaLabels.length ? areaLabels : [null];

  const areas = [];
  for (const areaLabel of effectiveAreas) {
    if (areaLabel) await clickTab(page, 'div.inline-flex.rounded-xl', areaLabel);
    const levelLabels = await subTabLabels(page);
    const effectiveLevels = levelLabels.length ? levelLabels : [null];
    const skipLabels = new Set([...areaLabels, ...levelLabels]);

    const levels = [];
    for (const levelLabel of effectiveLevels) {
      if (levelLabel) await clickTab(page, 'div.inline-flex.rounded-lg', levelLabel);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const parsed = parseWastesLevel(await mainText(page), skipLabels);
      levels.push({ level: levelLabel ? Number(levelLabel) || levelLabel : null, ...parsed });
    }
    areas.push({ title: areaLabel, levels });
  }
  return { label: `Season ${season}`, areas };
}

// ---------- Doubled Pawn Matrix ----------

function parseTitledBlocks(L, start, end) {
  const blocks = [];
  let current = null;
  for (let i = start; i < end; i++) {
    if (!L[i].endsWith('.')) {
      current = { title: L[i], lines: [] };
      blocks.push(current);
    } else if (current) {
      current.lines.push(L[i]);
    }
  }
  return blocks;
}

function parseDpmVariant(text) {
  const L = lines(text);
  const endsLine = L.find((l) => /^Ends: /.test(l));
  const ends = endsLine ? endsLine.replace(/^Ends: /, '') : null;

  const buffsIdx = L.indexOf('Buffs');
  const scoresIdx = L.indexOf('Target Scores', buffsIdx + 1);
  const buffs = buffsIdx >= 0 && scoresIdx > buffsIdx ? parseTitledBlocks(L, buffsIdx + 1, scoresIdx) : [];

  let i = scoresIdx >= 0 ? scoresIdx + 1 : L.length;
  const targetScores = [];
  while (i < L.length && /^[\d\s.,]+$/.test(L[i])) {
    targetScores.push(toNumber(L[i]));
    i++;
  }
  if (L[i] === 'Info') i++;
  while (i < L.length && /^Round \d+$/.test(L[i])) i++;

  const charBuffsIdx = L.indexOf('Character Buffs', i);
  const bossesEnd = charBuffsIdx >= 0 ? charBuffsIdx : L.length;
  const bosses = [];
  let j = i;
  while (j < bossesEnd) {
    const name = L[j];
    j++;
    const tags = [];
    while (j < bossesEnd && L[j] !== 'Suggested Buff') {
      tags.push(L[j]);
      j++;
    }
    j++; // skip 'Suggested Buff' label
    let resistantTo = null;
    if (tags.length && / RES$/.test(tags[0])) resistantTo = tags.shift();
    let suggestedBuff = null;
    const notes = [];
    if (j < bossesEnd) {
      if (L[j].endsWith(':')) {
        notes.push(L[j]);
        j++;
        while (j < bossesEnd && L[j].startsWith('-')) {
          notes.push(L[j]);
          j++;
        }
      } else {
        suggestedBuff = L[j];
        j++;
      }
    }
    bosses.push({ name, resistantTo, tags, suggestedBuff, notes });
  }

  const characterBuffs =
    charBuffsIdx >= 0
      ? parseTitledBlocks(L, charBuffsIdx + 1, L.length).map((b) => ({ name: b.title, text: b.lines.join(' ') }))
      : [];

  return { ends, buffs, targetScores, bosses, characterBuffs };
}

async function scrapeDpm(page, dpmId) {
  await page.goto(`https://encore.moe/dpmatrix/${dpmId}`, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const label = (await page.title()).split('|')[0].trim();
  const variantLabels = await topTabLabels(page);
  const effectiveVariants = variantLabels.length ? variantLabels : [null];

  const variants = [];
  for (const variantLabel of effectiveVariants) {
    if (variantLabel) await clickTab(page, 'div.inline-flex.rounded-xl', variantLabel);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const parsed = parseDpmVariant(await mainText(page));
    variants.push({ title: variantLabel, ...parsed });
  }
  return { label, variants };
}

// ---------- Enemy/boss head icons ----------
//
// api-v2.encore.moe/api/en/monster's own `Icon` field points at a dead host
// (`api.encore.moe`, .png) — the site's own rendered <img> tags resolve to
// `api-v2.encore.moe`, .webp instead (found by inspecting encore.moe/monster
// live rather than trusting the API field literally). Same monster id, just
// a different host+extension, confirmed working for several samples.
function toIconUrl(rawIcon) {
  return rawIcon.replace('api.encore.moe', 'api-v2.encore.moe').replace(/\.png$/, '.webp');
}

async function fetchMonsterIndex() {
  const res = await fetch(MONSTER_API);
  const data = await res.json();
  const index = new Map();
  for (const m of data.monsterList || []) {
    index.set(m.Name, { id: m.Id, iconUrl: toIconUrl(m.Icon) });
  }
  return index;
}

async function downloadIcon(id, iconUrl) {
  const dest = path.join(ICON_DIR, `${id}.webp`);
  const exists = await fs.access(dest).then(() => true).catch(() => false);
  if (exists) return;
  const res = await fetch(iconUrl);
  if (!res.ok) return;
  await fs.mkdir(ICON_DIR, { recursive: true });
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

// Replaces bare enemy-name strings with `{name, id}` (id: null when the name
// isn't a known monster) throughout the tower/wastes trees, and adds an `id`
// field onto each DPM boss — then downloads any not-yet-cached icon for every
// id referenced, so the frontend can just point an <img> at
// /wuvochka/enemy-icons/<id>.webp.
async function attachEnemyIcons(result, monsterIndex) {
  const withId = (name) => ({ name, id: monsterIndex.get(name)?.id ?? null });

  for (const area of result.tower.areas) {
    for (const floor of area.floors) floor.enemies = floor.enemies.map(withId);
  }
  for (const area of result.wastes.areas) {
    for (const level of area.levels) {
      for (const stage of level.stages) stage.enemies = stage.enemies.map(withId);
    }
  }
  for (const variant of result.dpm.variants) {
    for (const boss of variant.bosses) boss.id = monsterIndex.get(boss.name)?.id ?? null;
  }

  const ids = new Map();
  for (const [name, info] of monsterIndex) ids.set(info.id, info.iconUrl);
  const referenced = new Set();
  const collect = (obj) => {
    if (typeof obj.id === 'number') referenced.add(obj.id);
  };
  result.tower.areas.forEach((a) => a.floors.forEach((f) => f.enemies.forEach(collect)));
  result.wastes.areas.forEach((a) => a.levels.forEach((l) => l.stages.forEach((s) => s.enemies.forEach(collect))));
  result.dpm.variants.forEach((v) => v.bosses.forEach(collect));

  for (const id of referenced) {
    const iconUrl = ids.get(id);
    if (iconUrl) await downloadIcon(id, iconUrl);
  }
}

// ---------- Entry points ----------

export async function scrapeModeDetails(page, { towerSeason, wastesSeason, dpmId }) {
  const tower = await scrapeTower(page, towerSeason);
  const wastes = await scrapeWastes(page, wastesSeason);
  const dpm = await scrapeDpm(page, dpmId);
  const result = { updated: new Date().toISOString().slice(0, 10), tower, wastes, dpm };
  try {
    const monsterIndex = await fetchMonsterIndex();
    await attachEnemyIcons(result, monsterIndex);
  } catch (err) {
    // Icons are a nice-to-have on top of the text data above, which is
    // already complete and correct at this point — don't lose that over an
    // icon-fetch hiccup.
    console.error('[fetch-mode-details] enemy icon fetch failed, continuing without icons:', err);
  }
  return result;
}

export async function writeModeDetails(result) {
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(result, null, 1));
  console.log('[fetch-mode-details] wrote', OUT_PATH);
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  try {
    const towerSeason = await currentNumber(page, 'https://encore.moe/toa', /\/toa\/(\d+)/);
    const wastesSeason = await currentNumber(page, 'https://encore.moe/whiwa', /\/whiwa\/(\d+)/);
    const dpmId = await currentNumber(page, 'https://encore.moe/dpmatrix', /\/dpmatrix\/(\d+)/);
    const result = await scrapeModeDetails(page, { towerSeason, wastesSeason, dpmId });
    await writeModeDetails(result);
  } finally {
    await browser.close();
  }
}

// Only auto-run when invoked directly (`node scripts/fetch-mode-details.mjs`),
// not when fetch-boss-modes.mjs imports scrapeModeDetails from this file.
if (path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error('[fetch-mode-details] failed, leaving previous data/wuvochka-mode-details.json untouched:', err);
    process.exit(1);
  });
}
