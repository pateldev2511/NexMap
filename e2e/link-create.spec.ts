import { test, expect, type Page } from '@playwright/test';

/**
 * Link creation on the flat canvas — direct e2e proof for the link/relink
 * machine migration (M1). Covers both connect flows: click-click via connect
 * mode, and drag from a hover connect-port onto a target device.
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

const linkCount = (page: Page) => page.locator('path[class*="linkHit"]').count();

async function deviceCenter(page: Page, nth: number) {
  const box = (await page
    .locator('g[data-id][role="button"]')
    .nth(nth)
    .locator('rect')
    .first()
    .boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('connect mode: click one device, then another → link created', async ({ page }) => {
  await openBranchOffice(page);
  const before = await linkCount(page);

  await page.keyboard.press('c'); // connect tool
  const a = await deviceCenter(page, 0);
  const b = await deviceCenter(page, 5); // far apart in the template
  await page.mouse.click(a.x, a.y); // arms click-to-connect (pending source)
  await page.mouse.click(b.x, b.y); // completes the link

  await expect(page.locator('path[class*="linkHit"]')).toHaveCount(before + 1);
});

test('hover connect-port: drag from the port onto another device → link created', async ({
  page,
}) => {
  await openBranchOffice(page);
  const before = await linkCount(page);

  const a = await deviceCenter(page, 0);
  await page.mouse.move(a.x, a.y); // hover shows the directional ports
  const port = page.locator('[class*="connectHandle"]').first();
  await expect(port).toBeVisible();
  const pb = (await port.boundingBox())!;

  const b = await deviceCenter(page, 5);
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('path[class*="linkHit"]')).toHaveCount(before + 1);

  // Escape mid-band leaves no residue: start another band, cancel it.
  // (First deselect the new link — hover-ports yield while a link is
  // selected, by design.)
  await page.keyboard.press('Escape');
  await page.mouse.move(a.x, a.y);
  await expect(port).toBeVisible();
  const pb2 = (await port.boundingBox())!;
  await page.mouse.move(pb2.x + pb2.width / 2, pb2.y + pb2.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x - 40, b.y - 40, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('path[class*="linkHit"]')).toHaveCount(before + 1); // unchanged
});
