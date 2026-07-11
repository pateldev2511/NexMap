import { test, expect } from '@playwright/test';

/**
 * W3e: the per-rack "Hide names" toggle suppresses device NAME labels on the
 * faceplates (both photo-skin and parametric-chassis devices carry
 * data-facelabel) so names read from the callout column instead. Verified on the
 * REAL rack canvas, not just the pure art function.
 */

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1500 });
  await page.addInitScript(() => {
    try {
      indexedDB.deleteDatabase('nexmap');
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Rack designer/i }).first().click();
  await page.getByRole('button', { name: /Enterprise core \(42U\)/ }).click();
  await page.getByRole('button', { name: /^Single rack$/ }).click();
  await expect(page.getByTestId('rack-canvas')).toBeVisible();
});

const labelCount = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="rack-canvas"] [data-facelabel]').count();

test('Hide names removes faceplate name labels from the live rack canvas; Show names restores', async ({
  page,
}) => {
  // The populated template shows plenty of device name labels.
  expect(await labelCount(page)).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Hide names' }).click();
  await expect(page.getByRole('button', { name: 'Show names' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await labelCount(page)).toBe(0);

  // Faceplate art itself is intact — devices still render (mounted panels present).
  expect(
    await page.locator('[data-testid="rack-canvas"] g[role="button"]').count(),
  ).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Show names' }).click();
  expect(await labelCount(page)).toBeGreaterThan(0);
});
