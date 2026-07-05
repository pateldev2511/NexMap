import { test, expect, type Page } from '@playwright/test';

/**
 * Cross-rack pointer drag in the row view (M4d): grab a device, drag it over
 * another cabinet, see a live U-span drop preview, release to move. Replaces
 * the old HTML5 drag-and-drop path. Escape mid-drag cancels cleanly.
 */

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1500 });
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
  // Row view + a second, EMPTY cabinet as the move target.
  await page.getByRole('button', { name: /^\+ Rack$/ }).click();
  await expect(page.getByRole('img', { name: 'All racks' })).toBeVisible();
});

/** Rack ids in column order, parsed from the face markers. */
async function rackIds(page: Page): Promise<string[]> {
  const attrs = await page
    .locator('[data-rack-face]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-rack-face')!));
  const ids: string[] = [];
  for (const a of attrs) {
    const id = a.replace(/-(front|rear)$/, '');
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

const inFace = (page: Page, rackId: string) =>
  page.locator(`g[data-rack-face="${rackId}-front"] g[data-dev-id]`);

test('drag a device onto another rack: live drop preview, released device moves', async ({ page }) => {
  const [rackA, rackB] = await rackIds(page);
  const srcCount = await inFace(page, rackA!).count();
  expect(srcCount).toBeGreaterThan(0);
  await expect(inFace(page, rackB!)).toHaveCount(0);

  const dev = inFace(page, rackA!).first();
  const devId = await dev.getAttribute('data-dev-id');
  const from = (await dev.boundingBox())!;
  const targetFace = page.locator(`g[data-rack-face="${rackB}-front"]`);
  const to = (await targetFace.boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  // Live preview: green span outline in the empty target rack.
  await expect(page.getByTestId('row-drop-preview')).toBeVisible();
  await page.mouse.up();

  await expect(page.locator(`g[data-rack-face="${rackB}-front"] g[data-dev-id="${devId}"]`)).toBeVisible();
  await expect(inFace(page, rackA!)).toHaveCount(srcCount - 1);
});

test('Escape mid-drag cancels: preview disappears, device stays put', async ({ page }) => {
  const [rackA, rackB] = await rackIds(page);
  const srcCount = await inFace(page, rackA!).count();
  const dev = inFace(page, rackA!).first();
  const from = (await dev.boundingBox())!;
  const to = (await page.locator(`g[data-rack-face="${rackB}-front"]`).boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await expect(page.getByTestId('row-drop-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('row-drop-preview')).toHaveCount(0);
  await page.mouse.up();

  await expect(inFace(page, rackA!)).toHaveCount(srcCount);
  await expect(inFace(page, rackB!)).toHaveCount(0);
});

test('device click (below threshold) still selects and drills into its rack', async ({ page }) => {
  const [rackA] = await rackIds(page);
  const dev = inFace(page, rackA!).first();
  const box = (await dev.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // Click resolves through the machine: select + focus the device's rack.
  await expect(page.getByTestId('rack-canvas')).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Selected device$/ })).toBeVisible();
});
