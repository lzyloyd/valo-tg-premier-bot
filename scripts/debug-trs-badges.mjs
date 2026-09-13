import { getBrowser, closeBrowser } from '../src/browser.js';

// Pairs each rendered "trn-rating-*" badge image with the nearby text on the
// page, to reverse-engineer which TRS values map to which grade — the API
// gives us the raw score but never the grade itself.
const matchId = process.argv[2];
if (!matchId) {
  console.error('usage: node scripts/debug-trs-badges.mjs <matchId>');
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
  await new Promise((r) => setTimeout(r, 3000));

  const badges = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img[src*="trn-rating"]')];
    return imgs.map((img) => {
      let el = img.parentElement;
      let text = '';
      for (let i = 0; i < 5 && el; i++) {
        text = el.textContent.trim();
        if (text) break;
        el = el.parentElement;
      }
      return { src: img.src.split('/').pop(), nearbyText: text };
    });
  });
  console.log(JSON.stringify(badges, null, 2));
} finally {
  await page.close();
  await closeBrowser();
}
