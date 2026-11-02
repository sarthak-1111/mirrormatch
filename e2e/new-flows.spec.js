// New flows in mock mode (no units): hair-colour return, "complete the look" on a dress return
// (lips on the new dress, opt-in priced add-on) and the skincare return. Synthetic (non-person)
// fixture image.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('../test/fixtures/synthetic-face.jpg', import.meta.url));

async function startReturn(page, order, reason) {
  await page.goto('/#/orders');
  await page.locator(`[data-order="${order}"]`).click();
  await page.getByRole('radio', { name: reason }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function toResults(page) {
  await page.getByRole('button', { name: /Show me my match|Find the texture/ }).click();
  await page.getByRole('button', { name: /I agree/ }).click();
  await page.locator('#file-input').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Use this photo' }).click();
}

test('hair colour return: shades on your own hair, then an exchange', async ({ page }) => {
  await startReturn(page, 'HH-10455', "The shade didn't match");
  await expect(page.getByRole('heading', { name: /better match on you/ })).toBeVisible();
  await toResults(page);
  await expect(page.getByText('Your skin tone')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.tryon')).toHaveCount(3);
  await expect(page.locator('.tryon img')).toHaveCount(3, { timeout: 20000 });
  await expect(page.locator('.tryon').first()).toContainText('Ash Blonde');
  await expect(page.locator('.label-vp').first()).toContainText('Visual preview, not a guarantee');
  await expect(page.locator('#reasons .reason').first()).toContainText(/natural/);
  await expect(page.locator('#sticky').getByRole('button', { name: 'Continue to refund' })).toBeVisible();
  await page.locator('#sticky [data-action="exchange"]').click();
  await expect(page.getByRole('heading', { name: /new shade ships today/ })).toBeVisible();
  await expect(page.getByText('Gloss Hair Colour ·').first()).toBeVisible();
});

test('dress return: complete the look with lips, add-on is opt-in and priced', async ({ page }) => {
  await startReturn(page, 'HH-10307', "The colour didn't suit me");
  await toResults(page);
  await expect(page.locator('.tryon img')).toHaveCount(3, { timeout: 20000 });
  const look = page.locator('#look-card');
  await expect(look).toContainText('Optional · complete the look');
  const dress = (await page.locator('.tryon button.select').first().locator('.name').innerText()).trim();
  await look.getByRole('button', { name: `Complete the look: lips for ${dress}` }).click();
  await expect(look.locator('.look-img img')).toBeVisible({ timeout: 20000 });
  await expect(look.locator('.label-vp')).toContainText('Visual preview, not a guarantee');
  await expect(look.locator('.reason')).toContainText(dress);
  // Never pre-selected; the exchange and the refund are untouched until the shopper opts in.
  const addon = page.getByRole('checkbox', { name: /Add .* to my order/ });
  await expect(addon).not.toBeChecked();
  await expect(page.locator('#sticky [data-action="exchange"]')).not.toContainText('lipstick');
  await expect(page.locator('#sticky').getByRole('button', { name: 'Continue to refund' })).toBeVisible();
  await addon.check();
  await expect(page.locator('#sticky [data-action="exchange"]')).toContainText(/\+ .* lipstick \$22\.00/);
  await page.locator('#sticky [data-action="exchange"]').click();
  await expect(page.getByRole('heading', { name: /new colour ships today/ })).toBeVisible();
  await expect(page.getByText(/charged separately/)).toBeVisible();
});

// The blush preview and the foundation "Your skin today" card are covered by the agent unit tests
// (test/looks.test.js): the shared e2e server rate-limits API calls per IP, so this file stays lean.

test('skincare return: "It didn\'t suit my skin" reads the skin and offers a texture exchange', async ({ page }) => {
  await page.goto('/#/orders');
  // The skincare reason is not offered for colour products.
  await page.locator('[data-order="HH-10421"]').click();
  await expect(page.getByRole('radio', { name: "The shade didn't match" })).toBeVisible();
  await expect(page.getByRole('radio', { name: "It didn't suit my skin" })).toHaveCount(0);
  await page.goto('/#/orders');
  await page.locator('[data-order="HH-10462"]').click();
  // Colour reasons don't apply to skincare; the skin reason doesn't apply to colour products.
  await expect(page.getByRole('radio', { name: "The shade didn't match" })).toHaveCount(0);
  await page.getByRole('radio', { name: "It didn't suit my skin" }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: /texture that suits your skin/ })).toBeVisible();
  await toResults(page);
  await expect(page.getByRole('heading', { name: 'A better texture for your skin' })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#skin-card')).toContainText('Your skin today');
  await expect(page.locator('.tryon img[src*="/render/"]')).toHaveCount(0);
  await expect(page.locator('.texture-list .tryon').first()).toContainText('Light gel');
  await expect(page.locator('#sticky').getByRole('button', { name: 'Continue to refund' })).toBeVisible();
  await page.locator('#sticky [data-action="exchange"]').click();
  await expect(page.getByRole('heading', { name: /new texture ships today/ })).toBeVisible();
});
