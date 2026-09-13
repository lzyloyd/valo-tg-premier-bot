import { getBrowser, closeBrowser } from '../src/browser.js';

// Loads the actual rendered match page (not the JSON API) and lists every
// distinct image src on it, so we can spot the TRS grade-badge asset by eye
// instead of guessing at tracker.gg's undocumented CDN paths.
const matchId = process.argv[2];
if (!matchId) {
  console.error('usage: node scripts/debug-page-icons.mjs <matchId>');
  process.exit(1);
}

const browser = await getBrowser();
const page = await browser.newPage();
try {
  await page.goto(`https://tracker.gg/valorant/match/${matchId}`, {
    waitUntil: 'networkidle2',
    timeout: 60_000,
  });
  await page.waitForFunction(() => window.__INITIAL_STATE__ !== undefined, { timeout: 30_000 });
  // Give the scoreboard a moment to finish painting in.
  await new Promise((r) => setTimeout(r, 3000));

  const srcs = await page.evaluate(() =>
    [...document.querySelectorAll('img')].map((img) => img.src),
  );
  const unique = [...new Set(srcs)].sort();
  console.log(`${unique.length} distinct <img> srcs:`);
  console.log(unique.join('\n'));
} finally {
  await page.close();
  await closeBrowser();
}
