import { test, expect, type Page } from '@playwright/test';

/**
 * The entry chooser must route to the designer you actually pick, and switching
 * designers must return you to the chooser (not silently keep the old editor).
 *
 * Regression context: a lingering autosave draft used to make App bypass the
 * chooser whenever `mode === null` and fall through to `isRack = false`,
 * silently rendering the Network Designer — so picking Rack after a switch
 * landed you in Network. The fix: the chooser owns the mode===null state
 * unconditionally, and switch-designer discards the stale draft. (The
 * draft-present precondition is verified manually in-browser; headless
 * IndexedDB timing makes an autosave-across-reload fixture flaky, so these
 * pin the routing that the fix guarantees.)
 */

const inNetwork = (page: Page) =>
  page.getByPlaceholder('Search components').isVisible().catch(() => false);
const inRack = (page: Page) =>
  page.getByRole('button', { name: /New rack/i }).isVisible().catch(() => false);

test('Rack card opens the Rack designer (not Network)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Rack Designer/ }).click();
  expect(await inRack(page)).toBe(true);
  expect(await inNetwork(page)).toBe(false);
});

test('Network card opens the Network designer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  expect(await inNetwork(page)).toBe(true);
  expect(await inRack(page)).toBe(false);
});

test('switch-designer returns to the chooser, and each pick routes correctly', async ({
  page,
}) => {
  await page.goto('/');
  // Start in Network, put content on the canvas (so switch confirms + discards).
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: /Branch office/ }).click();
  await expect(page.locator('g[data-id]').first()).toBeVisible();

  page.on('dialog', (d) => d.accept()); // "Discard unsaved changes and switch?"
  await page.getByRole('button', { name: 'Switch designer' }).click();

  // The chooser reappears — the switch did not silently keep an editor.
  await expect(page.getByRole('dialog', { name: 'Choose a designer' })).toBeVisible();

  // Picking Rack from that chooser lands in Rack, not Network.
  await page.getByRole('button', { name: /Rack Designer/ }).click();
  expect(await inRack(page)).toBe(true);
  expect(await inNetwork(page)).toBe(false);
});
