import { test, expect, type Page, type Locator } from '@playwright/test';

/**
 * Inline port cabling in the UNIFIED ROW canvas (W6b) — the drill-in-free path.
 *
 * Layer 3 of the proof harness in docs/designs/pointer-native-canvas.md: the pure
 * machine is proven headless, `resolvePress`/`resolveDrop` are proven by unit test,
 * and the REAL drag — pointer capture, hit-testing against live layout, Escape
 * routing — is proven here in chromium. jsdom cannot do this: it has no
 * PointerEvent, so `e.button` arrives undefined and no gesture ever arms.
 *
 * Also covers the zoom-tier gate (E20): jacks must be neither drawn NOR hittable
 * until the near tier, so a device drag at low zoom can never become a stray cable.
 */

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
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
  // Stay in the ROW view — the whole point of W6 is not needing the drill-in.
  await page.getByRole('button', { name: /^Row view$/ }).click();
});

const surface = (page: Page) => page.locator('[data-canvas-surface]').first();
const jacks = (page: Page) => page.locator('[data-canvas-surface] [data-port]');
const rubberBand = (page: Page) => page.getByTestId('row-cable-drag');

const cableCount = (page: Page) =>
  page.locator('[data-canvas-surface] g[data-cable-id]').count();

/** Zoom in until the near tier draws jacks, or fail loudly. */
async function zoomToPorts(page: Page): Promise<void> {
  const zin = page.getByRole('button', { name: 'Zoom in' });
  for (let i = 0; i < 14; i++) {
    if ((await jacks(page).count()) > 0) return;
    await zin.click();
  }
  throw new Error('never reached the near tier — no jacks drawn');
}

/** A jack on one device and a jack on a DIFFERENT device. */
async function twoPorts(page: Page): Promise<[Locator, Locator]> {
  const all = jacks(page);
  const n = await all.count();
  expect(n).toBeGreaterThan(2);
  const a = all.nth(0);
  const aDev = (await a.getAttribute('data-port'))!.split(':')[0];
  for (let i = n - 1; i > 0; i--) {
    const v = (await all.nth(i).getAttribute('data-port'))!;
    if (v.split(':')[0] !== aDev) return [a, all.nth(i)];
  }
  throw new Error('no second device with ports');
}

const centre = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test('E20: jacks are neither drawn nor hittable before the near tier', async ({ page }) => {
  // Fit-to-screen on a 42U row starts well below the near threshold.
  await expect(jacks(page)).toHaveCount(0);

  // Learn where a jack WILL be, then zoom back out and press exactly there.
  await zoomToPorts(page);
  const [a] = await twoPorts(page);
  const at = await centre(a);
  const zout = page.getByRole('button', { name: 'Zoom out' });
  for (let i = 0; i < 4; i++) await zout.click();
  await expect(jacks(page)).toHaveCount(0);

  const before = await cableCount(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 60, at.y + 60, { steps: 6 });
  // No rubber-band: the press resolved to the device, not a port.
  await expect(rubberBand(page)).toHaveCount(0);
  await page.mouse.up();
  expect(await cableCount(page)).toBe(before);
});

test('dragging jack → jack in the row view creates a cable, no drill-in', async ({ page }) => {
  await zoomToPorts(page);
  const before = await cableCount(page);
  const [a, b] = await twoPorts(page);
  const from = await centre(a);
  const to = await centre(b);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await expect(rubberBand(page)).toBeVisible();
  await page.mouse.up();

  expect(await cableCount(page)).toBe(before + 1);
  await expect(rubberBand(page)).toHaveCount(0);
});

test('Escape mid-drag cancels, creates nothing, and does not stick', async ({ page }) => {
  await zoomToPorts(page);
  const before = await cableCount(page);
  const [a, b] = await twoPorts(page);
  const from = await centre(a);
  const to = await centre(b);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 40, { steps: 4 });
  await expect(rubberBand(page)).toBeVisible();

  await page.keyboard.press('Escape'); // router → gesture-cancel → machine
  await expect(rubberBand(page)).toHaveCount(0);
  await page.mouse.up();
  expect(await cableCount(page)).toBe(before);

  // Not stuck (the 2-for-2 shipped-regression class): the same drag still works.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  expect(await cableCount(page)).toBe(before + 1);
});

test('dropping in the aisle creates nothing — a changed mind, not an error', async ({ page }) => {
  await zoomToPorts(page);
  const before = await cableCount(page);
  const [a] = await twoPorts(page);
  const from = await centre(a);
  const box = (await surface(page).boundingBox())!;

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Bottom-left of the surface: below the bays, not on any jack.
  await page.mouse.move(box.x + 8, box.y + box.height - 8, { steps: 10 });
  await page.mouse.up();
  expect(await cableCount(page)).toBe(before);
});

test('a drag that starts outside the pointer element still commits (capture holds)', async ({
  page,
}) => {
  // The historically buggy layer: capture must keep tracking once the pointer
  // leaves the originating element.
  await zoomToPorts(page);
  const before = await cableCount(page);
  const [a, b] = await twoPorts(page);
  const from = await centre(a);
  const to = await centre(b);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Detour far outside the canvas, then come back and drop on the target.
  await page.mouse.move(from.x, 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  expect(await cableCount(page)).toBe(before + 1);
});

test('panning still works at the near tier — cabling did not steal the background press', async ({
  page,
}) => {
  await zoomToPorts(page);
  const svg = page.locator('[data-canvas-surface] svg').first();
  const styleBefore = await svg.getAttribute('style');
  const box = (await surface(page).boundingBox())!;

  // Press the aisle (not a jack) and drag: that is a pan.
  await page.mouse.move(box.x + 6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  expect(await svg.getAttribute('style')).not.toBe(styleBefore);
});
