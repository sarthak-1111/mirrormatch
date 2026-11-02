// Captures the 5 README screenshots from a running server (live mode + DEMO_CACHE=1 recommended,
// so re-runs reuse cached renders and spend 0 units). Photos must be your own or YouCam samples.
// Usage: node scripts/screenshots.mjs --base http://localhost:3000 --selfie <face.jpg> --waist <waist-up.jpg>
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const base = arg('base', 'http://localhost:3000');
const out = arg('out', 'docs/screenshots');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));

async function runReturn(page, { order, reason, photo }) {
  await page.goto(base);
  await page.locator(`[data-order="${order}"]`).click();
  await page.getByRole('radio', { name: reason }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Show me my match/ }).waitFor();
}
async function toMatches(page, photo) {
  await page.getByRole('button', { name: /Show me my match/ }).click();
  await page.getByRole('button', { name: /I agree/ }).click();
  await page.locator('#file-input').setInputFiles(photo);
  await page.getByRole('button', { name: 'Use this photo' }).click();
  await page.locator('#tryon-grid').waitFor({ timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector('#tryon-grid .skeleton'), null, { timeout: 180000 });
  await page.waitForTimeout(1500);
}

// 1 + 2: mobile, lipstick return: offer screen, then matches + try-on
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await runReturn(page, { order: 'HH-10421', reason: "The shade didn't match" });
  await page.screenshot({ path: `${out}/01-return-offer.png` });
  await toMatches(page, arg('selfie'));
  await page.evaluate(() => {
    const el = document.querySelector('#tryon-grid');
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 150);
  });
  await page.screenshot({ path: `${out}/02-lipstick-tryon.png` });
  await ctx.close();
}
// 3: mobile, dress return with clothes try-on
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await runReturn(page, { order: 'HH-10307', reason: "The colour didn't suit me" });
  await toMatches(page, arg('waist'));
  await page.evaluate(() => {
    const el = document.querySelector('#tryon-grid');
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 150);
  });
  await page.screenshot({ path: `${out}/03-dress-tryon.png` });
  await ctx.close();
}
// 4: desktop, shopper flow with the agent trace panel (foundation return)
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await runReturn(page, { order: 'HH-10388', reason: "The shade didn't match" });
  await toMatches(page, arg('selfie'));
  await page.waitForTimeout(3500); // let the LLM wording + trace settle
  await page.screenshot({ path: `${out}/04-agent-trace.png` });
  await ctx.close();
}
// 5: desktop, merchant dashboard
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await page.goto(`${base}/merchant`);
  await page.waitForSelector('table.heat');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/05-merchant-dashboard.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
console.log('screenshots saved to', out);
