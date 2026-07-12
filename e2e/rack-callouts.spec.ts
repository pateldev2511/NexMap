import { test, expect } from '@playwright/test';

/**
 * W3e-2/3: "Annotate all" generates a name callout per mounted device on the rack
 * elevation, each with a leader to its device — rendered on the REAL rack canvas.
 * Idempotent, one undo. Verified end to end, not just the pure store action.
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

const boxes = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="rack-canvas"] [data-callout-id]').count();
const leaders = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="rack-canvas"] [data-leader-for]').count();

test('Annotate all paints a callout + leader per device; idempotent; one undo', async ({
  page,
}) => {
  expect(await boxes(page)).toBe(0);

  await page.getByRole('button', { name: 'Annotate all' }).click();
  const n = await boxes(page);
  expect(n).toBeGreaterThan(0);
  expect(await leaders(page)).toBe(n); // every generated callout is anchored

  // Idempotent — running again adds nothing.
  await page.getByRole('button', { name: 'Annotate all' }).click();
  expect(await boxes(page)).toBe(n);

  // One undo removes the whole batch.
  await page.keyboard.press('ControlOrMeta+z');
  expect(await boxes(page)).toBe(0);
});

test('rack callouts do NOT leak onto the flat network canvas', async ({ page }) => {
  await page.getByRole('button', { name: 'Annotate all' }).click();
  expect(await boxes(page)).toBeGreaterThan(0);

  // Switch to the Network designer; its canvas must not show the rack callouts.
  page.on('dialog', (d) => d.accept()); // the "discard changes?" switch confirm
  await page.getByRole('button', { name: 'Switch designer' }).click();
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await expect(page.getByTestId('rack-canvas')).toHaveCount(0); // left the rack designer
  await expect(page.locator('svg [data-callout-id]')).toHaveCount(0);
});
