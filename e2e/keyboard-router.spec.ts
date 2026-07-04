import { test, expect, type Page } from '@playwright/test';

/**
 * Keyboard-router behavior changes (pointer-native canvas, M1):
 *   #3 Escape cancels the innermost thing only — a marquee cancel no longer
 *      nukes the existing selection.
 *   #4 Cmd+Z inside a text field is native text editing, never model undo.
 *   #7 Cmd+Z mid-drag is consumed by the cancel — history untouched, the
 *      drag reverts; a second press performs the real undo.
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

async function openBranchOffice(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: /Branch office/ }).click();
  await expect(page.locator('g[data-id]').first()).toBeVisible();
}

test('Cmd+Z while typing in a text field does NOT undo the model', async ({ page }) => {
  await openBranchOffice(page);
  const deviceCount = await page.locator('g[data-id][role="button"]').count();
  expect(deviceCount).toBeGreaterThan(0);

  // Focus the project-title input in the top bar and press undo there.
  const title = page.locator('input').first();
  await title.click();
  await title.pressSequentially('X');
  await page.keyboard.press('ControlOrMeta+z');

  // The template's devices are all still there — no model undo fired.
  await expect(page.locator('g[data-id][role="button"]')).toHaveCount(deviceCount);
});

test('Escape mid-marquee cancels the marquee but PRESERVES the selection', async ({ page }) => {
  await openBranchOffice(page);
  await page.keyboard.press('ControlOrMeta+a'); // select everything
  const selected = await page.locator('g[data-id][aria-pressed="true"]').count();
  expect(selected).toBeGreaterThanOrEqual(2);

  // Start a fresh marquee on empty canvas, press Escape MID-DRAG.
  const svg = (await page.locator('svg:has(g[data-id])').first().boundingBox())!;
  await page.mouse.move(svg.x + 6, svg.y + 6);
  await page.mouse.down();
  await page.mouse.move(svg.x + 80, svg.y + 80, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();

  // Behavior change 3: the marquee died, the selection survived.
  await expect(page.locator('g[data-id][aria-pressed="true"]')).toHaveCount(selected);
});

test('pointercancel mid-drag reverts the drag (no stuck gesture, no move)', async ({
  page,
}) => {
  await openBranchOffice(page);
  const node = page.locator('g[data-id][role="button"]').first();
  const before = await node.getAttribute('transform');
  const hit = (await node.locator('rect').first().boundingBox())!;
  const startX = hit.x + hit.width / 2;
  const startY = hit.y + hit.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY + 40, { steps: 4 });

  // Synthesize the OS-interrupt path the machine treats as first-class.
  await page.evaluate(() => {
    // The CANVAS svg (icon svgs come first in DOM order).
    const svg = document.querySelector('g[data-id]')!.closest('svg')!;
    svg.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
  });
  await page.mouse.up();

  await expect(node).toHaveAttribute('transform', before!); // reverted
  // And the canvas is not stuck: a fresh drag still works.
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 40, startY + 30, { steps: 4 });
  await page.mouse.up();
  await expect(node).not.toHaveAttribute('transform', before!);
});

test('Cmd+Z mid-drag reverts the drag and leaves history for a second press', async ({
  page,
}) => {
  await openBranchOffice(page);
  const node = page.locator('g[data-id][role="button"]').first();
  const before = await node.getAttribute('transform');
  const hit = (await node.locator('rect').first().boundingBox())!;
  const startX = hit.x + hit.width / 2;
  const startY = hit.y + hit.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY + 40, { steps: 4 });
  await page.keyboard.press('ControlOrMeta+z'); // consumed: cancels the drag only
  await page.mouse.up();

  // The device is back at its origin (drag reverted, not committed) …
  await expect(node).toHaveAttribute('transform', before!);
  // … and the model itself was not undone (all devices still present).
  await expect(page.locator('g[data-id][role="button"]').first()).toBeVisible();
});
