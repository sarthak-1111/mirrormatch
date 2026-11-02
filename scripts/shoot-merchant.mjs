// Screenshot the merchant dashboard (desktop).
// Usage: node scripts/shoot-merchant.mjs --base URL --out FILE [--full]
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
await page.goto(`${arg('base', 'http://localhost:3000')}/merchant`);
await page.waitForSelector('table.heat');
await page.waitForTimeout(800);
const section = arg('section');
if (section) await page.locator(section).scrollIntoViewIfNeeded();
await page.screenshot({ path: arg('out', 'docs/screenshots/merchant.png'), fullPage: args.includes('--full') });
console.log('saved');
await browser.close();
