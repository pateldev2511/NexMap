import { test, expect } from '@playwright/test';

/**
 * Blueprint view (Pillar C): a third view style beside 2D / ISO. The toolbar
 * toggle swaps every device to the traced line art on the drafting sheet and
 * back, without touching the model.
 */

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

test('the blueprint toggle redraws the diagram as a drafting sheet, and back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: /Branch office/ }).click();
  const devices = page.locator('g[data-id][role="button"]');
  await expect(devices.first()).toBeVisible();
  const count = await devices.count();

  const toggle = page.getByRole('button', { name: 'Toggle blueprint view' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-skin="blueprint"]')).toBeVisible();
  await expect(page.locator('[data-canvas-surface] [data-blueprint-icon]')).toHaveCount(count);
  await expect(page.locator('[data-canvas-surface] [data-flat-icon]')).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-skin]')).toHaveCount(0);
  await expect(page.locator('[data-canvas-surface] [data-flat-icon]')).toHaveCount(count);
  await expect(devices).toHaveCount(count);
});
