import { buildScoreboardHtml } from './template.js';

export async function renderScoreboardPng(browser, match) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 780, height: 900, deviceScaleFactor: 2 });
    await page.setContent(buildScoreboardHtml(match), { waitUntil: 'networkidle0' });
    // `networkidle0` fires once no more than 0 connections are open for 500ms —
    // it's a network-level heuristic, not a guarantee that every <img> (avatars,
    // rank emblems, TRS badges — ~30 external requests per card) has actually
    // finished loading. Under load a handful can still be in flight when it
    // fires, so those icons render blank. Wait on the images themselves instead.
    await page.evaluate(() =>
      Promise.all(
        Array.from(document.images)
          .filter((img) => !img.complete)
          .map((img) => new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          })),
      ),
    );
    const card = await page.$('#card');
    return await card.screenshot({ type: 'png' });
  } finally {
    await page.close();
  }
}
