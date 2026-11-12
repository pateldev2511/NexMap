import { test, expect } from '@playwright/test';

// A clean slate: no recoverable draft, no remembered designer.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      indexedDB.deleteDatabase('nexmap');
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });
});

test('the start gallery goes away once NexText builds a diagram (#69)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await expect(page.getByText('Home & small office')).toBeVisible();

  await page.getByRole('button', { name: /NexText/ }).click();
  const editor = page.getByLabel('NexText source');
  await editor.fill('router R1\nswitch SW1\nR1 - SW1');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('Applied.')).toBeVisible();
  await page.keyboard.press('Escape');

  // Gallery is gone and the generated devices are on the canvas.
  await expect(page.getByText('Home & small office')).toHaveCount(0);
  await expect(page.locator('g[data-id]')).toHaveCount(2);
});

test('✕ / Escape closes the gallery and keeps a blank project (#69)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await expect(page.getByText('Home & small office')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Home & small office')).toHaveCount(0);
  await expect(page.locator('g[data-id]')).toHaveCount(0);
});
