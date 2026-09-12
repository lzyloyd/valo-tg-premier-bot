import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { config } from './config.js';

puppeteer.use(StealthPlugin());

let browserPromise = null;

/**
 * A persistent user-data-dir keeps tracker.gg's Cloudflare cf_clearance cookie
 * (and its trust in this browser fingerprint) across runs, so most polls don't
 * have to solve the "Just a moment..." challenge from scratch.
 */
export async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: config.headless ? 'new' : false,
      userDataDir: config.browserProfileDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}
