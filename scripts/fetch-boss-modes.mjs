// Scrapes encore.moe for the bosses currently featured in Tower of Adversity /
// Whimpering Wastes / Doubled Pawn Matrix and writes data/wuvochka-boss-modes.json.
//
// Why a real browser: a plain fetch of encore.moe's pages returns a server-rendered
// shell with no floor/boss data — that part is fetched and rendered client-side
// after hydration, confirmed by diffing a raw `curl`-equivalent fetch against the
// same page's rendered DOM. So this needs Puppeteer, not just an HTTP request.
//
// Why match by boss name instead of scraping structure: encore.moe's markup for
// these pages isn't meant to be scraped and can change layout without notice.
// Checking which of our own 43 known boss names literally appear in the rendered
// page text is far more robust than depending on specific selectors/classes.
//
// Run manually: node scripts/fetch-boss-modes.mjs
// Runs daily at 00:00 UTC via the wuvochka-boss-modes.timer systemd unit on the VPS.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { scrapeModeDetails, writeModeDetails } from './fetch-mode-details.mjs';

puppeteer.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOSSES_PATH = path.join(__dirname, '..', 'src', 'miniapp-public', 'wuvochka', 'bosses.json');
const OUT_PATH = path.join(__dirname, '..', 'data', 'wuvochka-boss-modes.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const MIN_TEXT_LENGTH = 300;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Finds which of our known bosses are named in `text`. Guards against a base
// name (e.g. "Mourning Aix") false-matching inside a longer nightmare/phantom
// variant name (e.g. "Nightmare: Mourning Aix") that happens to contain it.
function findBossMatches(text, bosses) {
  const found = [];
  for (const b of bosses) {
    const re = new RegExp(`(?<!Nightmare: )(?<!Phantom: )${escapeRegExp(b.name)}(?!\\w)`);
    if (re.test(text)) found.push(b.id);
  }
  return found;
}

async function currentNumber(page, listUrl, pattern) {
  await page.goto(listUrl, { waitUntil: 'networkidle2', timeout: 45000 });
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
  const nums = hrefs.map((h) => (h ? h.match(pattern) : null)).filter(Boolean).map((m) => Number(m[1]));
  if (!nums.length) throw new Error(`no numbered links found at ${listUrl}`);
  return Math.max(...nums);
}

async function renderedText(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((resolve) => setTimeout(resolve, 2000)); // let the client-side data fetch + render settle
  let text = await page.evaluate(() => document.body.innerText);
  if (text.length < MIN_TEXT_LENGTH) throw new Error(`page too short (${text.length} chars) at ${url} — looks unrendered`);
  // DPM pages (and possibly others) have a "Character Buffs" section listing
  // playable Resonators by name below the boss list — several share a name
  // with an unrelated boss (e.g. the Resonator "Denia" vs the weekly boss
  // "Denia"), which would false-match below. Everything we care about always
  // comes before this section, so just cut it off.
  text = text.split('Character Buffs')[0];
  return text;
}

async function main() {
  const bossesRaw = JSON.parse(await fs.readFile(BOSSES_PATH, 'utf8'));
  const bosses = Object.entries(bossesRaw)
    .map(([id, b]) => ({ id: Number(id), name: b.name }))
    .sort((a, b) => b.name.length - a.name.length);
  const previous = await fs
    .readFile(OUT_PATH, 'utf8')
    .then(JSON.parse)
    .catch(() => null);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(UA);

  try {
    const result = {
      updated: new Date().toISOString().slice(0, 10),
      tower: { label: null, bossIds: [] },
      wastes: { label: null, bossIds: [] },
      dpm: { label: null, bossIds: [] },
    };

    // Tower of Adversity — 3 zones, each its own ?area= query on the same season.
    const towerSeason = await currentNumber(page, 'https://encore.moe/toa', /\/toa\/(\d+)/);
    const towerIds = new Set();
    for (const area of [1, 2, 3]) {
      const text = await renderedText(page, `https://encore.moe/toa/${towerSeason}?area=${area}`);
      findBossMatches(text, bosses).forEach((id) => towerIds.add(id));
    }
    result.tower = { label: `Season ${towerSeason}`, bossIds: [...towerIds] };

    // Whimpering Wastes — one page per season, no area split. Often has no real
    // bosses at all (just regular/elite waves) — an empty list here is normal.
    const wastesSeason = await currentNumber(page, 'https://encore.moe/whiwa', /\/whiwa\/(\d+)/);
    const wastesText = await renderedText(page, `https://encore.moe/whiwa/${wastesSeason}`);
    result.wastes = { label: `Season ${wastesSeason}`, bossIds: findBossMatches(wastesText, bosses) };

    // Doubled Pawn Matrix ("Endstate Matrix" on encore.moe) — highest numbered
    // phase id is current; its own page title doubles as the display label.
    const dpmId = await currentNumber(page, 'https://encore.moe/dpmatrix', /\/dpmatrix\/(\d+)/);
    const dpmText = await renderedText(page, `https://encore.moe/dpmatrix/${dpmId}`);
    const dpmLabel = (await page.title()).split('|')[0].trim();
    result.dpm = { label: dpmLabel, bossIds: findBossMatches(dpmText, bosses) };

    await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
    await fs.writeFile(OUT_PATH, JSON.stringify(result, null, 1));
    console.log('[fetch-boss-modes] wrote', OUT_PATH);
    console.log(JSON.stringify(result, null, 1));

    // The full mode-details scrape (buffs/targets/floor-by-floor enemies for
    // all three modes) is much heavier than this boss-presence check — dozens
    // of extra tab switches — so only pay for it on days the season/phase
    // actually rotated (or there's no mode-details file yet at all).
    const rotated =
      !previous ||
      previous.tower?.label !== result.tower.label ||
      previous.wastes?.label !== result.wastes.label ||
      previous.dpm?.label !== result.dpm.label;
    if (rotated) {
      console.log('[fetch-boss-modes] season/phase changed — refreshing mode-details.json too');
      try {
        const details = await scrapeModeDetails(page, { towerSeason, wastesSeason, dpmId });
        await writeModeDetails(details);
      } catch (err) {
        // boss-modes.json above already wrote successfully — don't let a
        // mode-details hiccup mask that or exit non-zero over it.
        console.error('[fetch-boss-modes] mode-details refresh failed, leaving previous mode-details.json untouched:', err);
      }
    } else {
      console.log('[fetch-boss-modes] no season/phase change — mode-details.json left as-is');
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[fetch-boss-modes] failed, leaving previous data/wuvochka-boss-modes.json untouched:', err);
  process.exit(1);
});
