import { test, expect } from '@playwright/test';

/**
 * Zero silent failures (behavior change #5): dragging a rack device onto an
 * occupied slot flashes the target red WITH a human-readable reason. This
 * path used to discard the FitResult and do nothing.
 */

test('drag-move onto an occupied U flashes the reason instead of silently no-oping', async ({
  page,
}) => {
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

  // Two mounted devices; drag the first onto the second's slot.
  const devices = page.locator('[data-testid="rack-canvas"] g[role="button"]');
  expect(await devices.count()).toBeGreaterThanOrEqual(2);
  const a = (await devices.nth(0).boundingBox())!;
  const b = (await devices.nth(1).boundingBox())!;

  // Press near the panel's left ear — the center of a switch faceplate is a
  // port field, and a press on a jack arms a CABLE drag, not a device move.
  await page.mouse.move(a.x + 8, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 8, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();

  // The rejection is VISIBLE: red slot + reason text (and a pulse at the
  // nearest free U). Never a silent no-op. Scoped to the canvas — the same
  // reason also lives in the hidden screen-reader live region, by design.
  await expect(
    page
      .getByTestId('rack-canvas')
      .getByText(/That U is occupied|That half-bay is taken|Won't fit there/),
  ).toBeVisible();
});
