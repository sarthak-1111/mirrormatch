// Workspace: the autopilot plays a whole lipstick return in the phone frame (mock mode), the
// agent console follows it live, Stop hands control back, and merchant suggestions can be
// approved (logged only). The "sample model" is served from the synthetic, non-person test
// fixture, so the test needs no local photo and no network.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('../test/fixtures/synthetic-face.jpg', import.meta.url));

test.use({ viewport: { width: 1400, height: 900 }, isMobile: false, hasTouch: false });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/samples/*', (route) => route.fulfill({ path: fixture, contentType: 'image/jpeg' }));
});

test('Stop hands control back to the person', async ({ page }) => {
  await page.goto('/workspace.html');
  const app = page.frameLocator('#app-frame');
  await expect(app.getByRole('heading', { level: 1 })).toContainText('need to return');
  await page.getByRole('button', { name: 'Dress' }).click();
  await expect(app.getByRole('heading', { name: /better match on you/ })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('#ap-caption')).toContainText('Stopped');
  await page.waitForTimeout(2500);
  // Nothing moved on by itself, and the shopper's own buttons work.
  await expect(app.getByRole('heading', { name: /better match on you/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dress' })).toBeEnabled();
  await app.getByRole('button', { name: 'Show me my match' }).click();
  await expect(app.getByText('Deleted when this return ends')).toBeVisible();
});

test('merchant suggestions: drafted proposals, synthetic notes labelled, approve only logs', async ({ page }) => {
  await page.goto('/merchant#suggestions');
  // The hash opens the Suggestions tab; the other tabs stay out of the way.
  await expect(page.getByRole('tab', { name: /Suggestions/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#overview')).toBeHidden();
  const sec = page.locator('#suggestions');
  await expect(sec.getByRole('heading', { name: 'What the agent suggests' })).toBeVisible();
  const shade = sec.locator('article.sugg.shade').first();
  await expect(shade).toContainText('Fill the gap: a proposed new shade');
  await expect(shade).toContainText(/#[0-9A-F]{6}/);
  await expect(shade.getByRole('button', { name: 'Preview on the sample model' })).toBeVisible();
  await expect(sec.locator('article.sugg.note.synth').first()).toContainText('Synthetic demo data');
  await shade.getByRole('button', { name: 'Approve' }).click();
  await expect(shade).toContainText('logged as an event only');
  await expect(page.locator('#feed')).toContainText('Suggestion approved', { timeout: 10000 });
});

// Last in this file: the happy-path spec (another worker, same server) asserts exactly one
// exchange early on, and this test creates its exchange about 20 s after it starts.
test('autopilot (lipstick) reaches the exchange while the agent console follows it', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/workspace.html');
  // One thing at a time: the first tab is only the picker and the phone.
  await expect(page.getByRole('heading', { name: 'Watch a return become an exchange' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Watch a return' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-agent')).toBeHidden();
  await expect(page.locator('#panel-store')).toBeHidden();
  await expect(page.locator('#ws-env')).toContainText('Mock');
  await expect(page.locator('#ws-env')).toContainText('/api/integrations/return-started');
  const app = page.frameLocator('#app-frame');
  await expect(app.getByRole('heading', { level: 1 })).toContainText('need to return');

  await page.getByRole('button', { name: 'Lipstick' }).click();
  await expect(app.locator('.ap-badge')).toContainText('Autopilot demo: choosing the top match');
  await expect(page.locator('#run-step')).toContainText('Step');
  await expect(page.locator('#meter')).not.toHaveAttribute('aria-valuenow', '0');
  // The refund stays one tap away while the autopilot runs.
  await expect(app.getByRole('heading', { name: /better match on you/ })).toBeVisible({ timeout: 20000 });
  await expect(app.getByRole('button', { name: /continue to refund/i }).first()).toBeVisible();
  // The sample photo goes through the real photo step.
  await expect(app.locator('#capture-box img.preview')).toHaveAttribute('alt', "YouCam's sample model photo", { timeout: 30000 });
  // Matches and previews on the same photo, labelled.
  await expect(app.locator('.tryon img')).toHaveCount(3, { timeout: 45000 });
  await expect(app.locator('.label-vp').first()).toContainText('Visual preview, not a guarantee');

  await expect(app.getByRole('heading', { name: /ships today/ })).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#ap-caption')).toContainText('Done: exchanged for');
  await expect(page.getByRole('button', { name: 'Lipstick' })).toBeEnabled();

  // The latest steps show beside the phone in plain words.
  await expect(page.locator('#recent')).toContainText('Created the exchange');

  // The Agent steps tab followed the session (and counted what was new while it was hidden).
  await expect(page.locator('#count-agent')).toBeVisible();
  await page.getByRole('tab', { name: /Agent steps/ }).click();
  await expect(page.locator('#panel-agent')).toBeVisible();
  await expect(page.locator('#panel-try')).toBeHidden();
  await expect(page.locator('#count-agent')).toBeHidden();
  const consoleList = page.locator('#console-list');
  await expect(consoleList).toContainText('analyze_skin_tone');
  await expect(consoleList).toContainText('Measured skin tone with YouCam');
  await expect(consoleList).toContainText('render_tryon');
  await expect(consoleList).toContainText('create_exchange');
  await expect(page.locator('#ws-session')).toContainText('exchanged');
  // Arrow keys move between tabs; the Store view saw the exchange live.
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Store view/ })).toBeFocused();
  await expect(page.locator('#panel-store')).toBeVisible();
  await expect(page.locator('#ws-feed')).toContainText('Exchange created', { timeout: 10000 });
  await expect(page).toHaveURL(/#store$/);
});
