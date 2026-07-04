import { test, expect, type Page, type Locator } from '@playwright/test';

/**
 * Drag-port cabling e2e — possible now that jacks carry stable [data-port]
 * markers (the old "tiny raw rects with no stable selectors" exemption is
 * retired). Also proves Escape cancels a mid-flight cable drag (the audited
 * dashed-line-chases-the-cursor-forever bug).
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

const cableCount = (page: Page) =>
  page.locator('[data-testid="rack-canvas"] g[style*="cursor: pointer"]').count();

/** First port, and a port on a DIFFERENT device. */
async function twoPorts(page: Page): Promise<[Locator, Locator]> {
  const ports = page.locator('[data-port]');
  const n = await ports.count();
  expect(n).toBeGreaterThan(2);
  const a = ports.nth(0);
  const aDev = (await a.getAttribute('data-port'))!.split(':')[0];
  for (let i = n - 1; i > 0; i--) {
    const v = (await ports.nth(i).getAttribute('data-port'))!;
    if (v.split(':')[0] !== aDev) return [a, ports.nth(i)];
  }
  throw new Error('no second device with ports');
}

test('dragging port to port creates a cable', async ({ page }) => {
  const before = await cableCount(page);
  const [a, b] = await twoPorts(page);
  const ab = (await a.boundingBox())!;
  const bb = (await b.boundingBox())!;

  await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 8 });
  // The live cable rubber-band is visible mid-drag.
  await expect(
    page.locator('[data-testid="rack-canvas"] line[stroke-dasharray="5 3"]'),
  ).toBeVisible();
  await page.mouse.up();

  expect(await cableCount(page)).toBe(before + 1);
});

test('Escape mid-cable-drag kills the rubber band, creates nothing, and does not stick', async ({
  page,
}) => {
  const before = await cableCount(page);
  const [a, b] = await twoPorts(page);
  const ab = (await a.boundingBox())!;
  const bb = (await b.boundingBox())!;

  await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2);
  await page.mouse.down();
  await page.mouse.move(ab.x + 40, ab.y + 40, { steps: 4 });
  await expect(
    page.locator('[data-testid="rack-canvas"] line[stroke-dasharray="5 3"]'),
  ).toBeVisible();

  await page.keyboard.press('Escape'); // router → gesture-cancel → machine
  await expect(
    page.locator('[data-testid="rack-canvas"] line[stroke-dasharray="5 3"]'),
  ).toHaveCount(0);
  await page.mouse.up();
  expect(await cableCount(page)).toBe(before);

  // Not stuck: the same drag performed again still connects.
  await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await cableCount(page)).toBe(before + 1);
});

test('a tap on a jack (below threshold) selects the device, no cable', async ({ page }) => {
  const before = await cableCount(page);
  const [a] = await twoPorts(page);
  const ab = (await a.boundingBox())!;
  const dev = (await a.getAttribute('data-port'))!.split(':')[0];

  await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2);
  await page.mouse.down();
  await page.mouse.move(ab.x + ab.width / 2 + 2, ab.y + ab.height / 2 + 1); // < 4px
  await page.mouse.up();

  expect(await cableCount(page)).toBe(before);
  // The owning device is selected (its accent outline is rendered).
  await expect(page.getByRole('heading', { name: /^Selected device$/ })).toBeVisible();
  expect(dev).toBeTruthy();
});
