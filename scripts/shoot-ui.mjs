// Screenshots of the tabbed workspace, the merchant dashboard tabs, the story page and the shopper
// app, from a running server. With live mode + DEMO_CACHE=1, the sample-model autopilot replays
// cached results and spends 0 units; mock mode works too (placeholder previews).
// Usage: node scripts/shoot-ui.mjs --base http://127.0.0.1:3000 [--out docs/screenshots] [--prefix ui] [--flow lipstick] [--only ws,merchant,story,shop]
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const base = arg('base', 'http://127.0.0.1:3000');
const out = arg('out', 'docs/screenshots');
const prefix = arg('prefix', 'ui');
const flow = arg('flow', 'lipstick');
const only = arg('only');
const want = (k) => !only || only.split(',').includes(k);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const desk = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 };
const save = async (page, name, opts = {}) => {
  await page.screenshot({ path: `${out}/${prefix}-${name}.png`, ...opts });
  console.log('saved', `${out}/${prefix}-${name}.png`);
};

if (want('ws')) {
  const ctx = await browser.newContext(desk);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
  await page.goto(`${base}/workspace.html`);
  const app = page.frameLocator('#app-frame');
  await app.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForTimeout(800);
  await save(page, 'ws-1-try');
  await page.locator(`[data-flow="${flow}"]`).click();
  // Mid-run: the before / after step.
  await page.waitForFunction(() => /Step (9|10|11)/.test(document.getElementById('run-step')?.textContent || ''), null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  await save(page, 'ws-2-running');
  await page.waitForFunction(() => document.getElementById('run')?.dataset.state === 'done', null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  await save(page, 'ws-3-done');
  for (const [tab, name] of [['Agent steps', 'ws-4-agent'], ['Store view', 'ws-5-store'], ['Setup', 'ws-6-setup']]) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click();
    await page.waitForTimeout(700);
    await save(page, name);
  }
  await ctx.close();
}

if (want('merchant')) {
  const ctx = await browser.newContext(desk);
  const page = await ctx.newPage();
  for (const tab of ['overview', 'fit', 'suggestions', 'history', 'log']) {
    await page.goto(`${base}/merchant#${tab}`);
    await page.waitForTimeout(1500);
    await save(page, `m-${tab}`);
  }
  await ctx.close();
}

if (want('story')) {
  const ctx = await browser.newContext(desk);
  const page = await ctx.newPage();
  await page.goto(`${base}/story.html`);
  await page.waitForTimeout(800);
  await save(page, 'story');
  await ctx.close();
}

if (want('shop')) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForTimeout(600);
  await save(page, 'shop-orders');
  await ctx.close();
}

// Phone close-ups of the newer flows, played by the autopilot (/?autoplay=<flow>) on the sample model.
if (want('phone')) {
  const shots = [
    ['hair', '#compare-card', 'phone-hair'],
    ['dress', '#look-card .look-result img', 'phone-lips-on-dress', '#look-card'],
    ['foundation', '#skin-card', 'phone-skin'],
  ];
  // --tall: a full 390×844 phone screen (for the video's end card) instead of the browser viewport.
  const phone = args.includes('--tall')
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent }
    : { ...devices['iPhone 13'], deviceScaleFactor: 2 };
  for (const [f, waitSel, name, frameSel] of shots) {
    if (only && arg('flows') && !arg('flows').split(',').includes(f)) continue;
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    await page.goto(`${base}/?autoplay=${f}`);
    await page.locator(waitSel).first().waitFor({ state: 'visible', timeout: 240000 });
    await page.waitForTimeout(f === 'hair' ? 600 : 2500);
    // Pause the autopilot where it is, hide its overlay, and frame the card.
    await page.evaluate(() => document.querySelector('[data-ap="stop"]')?.click());
    await page.addStyleTag({ content: '.ap-bar{display:none!important} html.autopilot .layout{padding-top:20px!important}' });
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 76);
    }, frameSel || waitSel);
    await page.waitForTimeout(1800);
    await save(page, name);
    await ctx.close();
  }
}

await browser.close();
