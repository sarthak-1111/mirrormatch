// Drives the shopper flow in a real browser (Playwright) and saves screenshots.
// Usage: node scripts/shoot.mjs --base http://localhost:3000 --photo <selfie.jpg> [--order HH-10421] [--out docs/screenshots] [--prefix lip]
// Used for README screenshots and as a manual smoke test. The photo must be the operator's own
// or a YouCam official sample.
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const base = arg('base', 'http://localhost:3000');
const photo = arg('photo');
const order = arg('order', 'HH-10421');
const reason = arg('reason', order === 'HH-10307' ? 'colour_didnt_suit' : 'wrong_shade');
const out = arg('out', 'docs/screenshots');
const prefix = arg('prefix', 'flow');
const desktop = args.includes('--desktop');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const ctx = await browser.newContext(desktop ? { viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 } : { ...devices['iPhone 13'], deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
const shot = async (name) => {
  // Full-page captures would paint the fixed bottom bar mid-page; pin it to the end instead.
  await page.addStyleTag({ content: '.sticky-cta{position:static!important} .topbar{position:static!important}' });
  await page.screenshot({ path: `${out}/${prefix}-${name}.png`, fullPage: true });
  console.log('saved', `${out}/${prefix}-${name}.png`);
};

await page.goto(base);
await page.getByRole('heading', { level: 1 }).waitFor();
await shot('01-orders');
await page.locator(`[data-order="${order}"]`).click();
await page.getByRole('button', { name: 'Continue' }).waitFor();
await page.locator(`input[value="${reason}"]`).check({ force: true });
await shot('02-reason');
await page.getByRole('button', { name: 'Continue' }).click();
await page.getByRole('button', { name: /Show me my match/ }).waitFor();
await shot('03-offer');
await page.getByRole('button', { name: /Show me my match/ }).click();
await page.getByRole('button', { name: /I agree/ }).click();
await page.locator('#file-input').waitFor({ state: 'attached' });
if (!photo) {
  console.log('no --photo given; stopping at capture');
  await browser.close();
  process.exit(0);
}
await page.locator('#file-input').setInputFiles(photo);
await page.getByRole('button', { name: 'Use this photo' }).click();
await page.locator('#tryon-grid, .banner.warn, h1:has-text("rather not guess")').first().waitFor({ timeout: 120000 });
if (await page.locator('.banner.warn').count()) {
  await shot('04-retake');
  console.log('retake requested:', await page.locator('.banner.warn').innerText());
  await browser.close();
  process.exit(0);
}
await page.waitForFunction(() => !document.querySelector('#tryon-grid .skeleton'), null, { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(600);
await shot('04-matches');
if (await page.locator('[data-action="exchange"]').count()) {
  await page.locator('[data-action="exchange"]').click();
  await page.getByRole('heading', { name: /ships today/ }).waitFor({ timeout: 30000 });
  await shot('05-exchanged');
}
await browser.close();
