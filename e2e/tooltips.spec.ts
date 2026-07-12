import { test, expect } from '@playwright/test';

/**
 * W7: the body-level tooltip singleton shows on hover for any control carrying a
 * title (migrated to data-tip), and is NOT clipped by overflow ancestors.
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
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: /Blank project/ }).click();
});

test('hovering a toolbar control shows the singleton tooltip on document.body', async ({
  page,
}) => {
  const tip = page.locator('#nex-tooltip');
  await expect(tip).toBeAttached();
  await expect(tip).toHaveCSS('opacity', '0'); // hidden at rest

  // The Connect tool has title="Connect (C)"; hover migrates it to the tooltip.
  await page.locator('button[title="Connect (C)"]').hover();
  await expect(tip).toHaveCSS('opacity', '1');
  await expect(tip).toHaveText(/Connect/);

  // It lives on the body (immune to toolbar overflow clipping).
  const parent = await tip.evaluate((el) => el.parentElement?.tagName);
  expect(parent).toBe('BODY');

  // Moving away hides it.
  await page.mouse.move(400, 400);
  await expect(tip).toHaveCSS('opacity', '0');
});
