// Happy path: lipstick return → selfie → matches → 3 previews → exchange → photo deleted,
// then the merchant dashboard shows the live exchange. Runs in mock mode with a synthetic
// (non-person) fixture image.
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('../test/fixtures/synthetic-face.jpg', import.meta.url));

test('lipstick return becomes an exchange, and the dashboard shows it live', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('need to return');
  await page.locator('[data-order="HH-10421"]').click();

  await page.getByText("The shade didn't match").click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: /better match on you/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /continue to refund/i })).toBeVisible();
  await page.getByRole('button', { name: 'Show me my match' }).click();

  await expect(page.getByText('Deleted when this return ends')).toBeVisible();
  await page.getByRole('button', { name: /I agree/ }).click();

  await page.locator('#file-input').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Use this photo' }).click();

  await expect(page.getByText('Your skin tone')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.tryon')).toHaveCount(3);
  await expect(page.locator('.tryon img')).toHaveCount(3, { timeout: 20000 });
  await expect(page.locator('.label-vp').first()).toContainText('Visual preview, not a guarantee');
  // Refund is still one tap away next to the exchange.
  await expect(page.locator('#sticky').getByRole('button', { name: 'Continue to refund' })).toBeVisible();

  // Choose the second pick, then exchange.
  const second = page.locator('.tryon button.select').nth(1);
  const name = await second.locator('.name').innerText();
  await second.click();
  await expect(page.locator('#sticky [data-action="exchange"]')).toContainText(name);
  await page.locator('#sticky [data-action="exchange"]').click();

  await expect(page.getByRole('heading', { name: /ships today/ })).toBeVisible();
  await expect(page.getByText('Your photo has been deleted.')).toBeVisible();

  const dash = await context.newPage();
  await dash.goto('/merchant');
  await expect(dash.locator('#kpis')).toContainText('Exchanges accepted');
  await expect(dash.locator('#kpis .kpi').nth(2).locator('.value')).toHaveText('1');
  await expect(dash.locator('#feed')).toContainText('Exchange created');
  await expect(dash.getByText('Synthetic demo data').first()).toBeVisible();
});

test('damaged items skip SecondTry and refund in one step', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-order="HH-10388"]').click();
  await page.getByText('It arrived damaged').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: /Refund \$36/ })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm refund' }).click();
  await expect(page.getByRole('heading', { name: 'Refund on its way' })).toBeVisible();
});
