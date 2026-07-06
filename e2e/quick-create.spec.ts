import { test, expect, type Page } from '@playwright/test';

/**
 * Quick-create (M4b + M4c): double-click empty canvas → device picker at the
 * point; drop a link on empty space → pick creates AND connects in one
 * motion; rack empty-bay double-click repeats the last-used preset.
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

const deviceCount = (page: Page) => page.locator('g[data-id][role="button"]').count();
const linkCount = (page: Page) => page.locator('path[class*="linkHit"]').count();

test('double-click empty canvas → picker → device created and selected (M4c)', async ({
  page,
}) => {
  await openBranchOffice(page);
  const before = await deviceCount(page);
  const svg = (await page.locator('svg:has(g[data-id])').first().boundingBox())!;

  await page.mouse.dblclick(svg.x + 40, svg.y + 40); // empty corner
  const menu = page.getByRole('menu', { name: 'Add device' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Switch' }).click();

  await expect(page.locator('g[data-id][role="button"]')).toHaveCount(before + 1);
  await expect(page.locator('g[data-id][aria-pressed="true"]')).toHaveCount(1);
});

test('Escape closes the picker without creating anything', async ({ page }) => {
  await openBranchOffice(page);
  const before = await deviceCount(page);
  const svg = (await page.locator('svg:has(g[data-id])').first().boundingBox())!;
  await page.mouse.dblclick(svg.x + 40, svg.y + 40);
  await expect(page.getByRole('menu', { name: 'Add device' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Add device' })).toHaveCount(0);
  expect(await deviceCount(page)).toBe(before);
});

test('drop a link on empty canvas → pick → created, CONNECTED, selected (M4b)', async ({
  page,
}) => {
  await openBranchOffice(page);
  const devBefore = await deviceCount(page);
  const lnkBefore = await linkCount(page);

  // Hover the first device → drag from its connect-port onto empty space.
  const hit = (await page
    .locator('g[data-id][role="button"]')
    .first()
    .locator('rect')
    .first()
    .boundingBox())!;
  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
  const port = page.locator('[class*="connectHandle"]').first();
  await expect(port).toBeVisible();
  const pb = (await port.boundingBox())!;
  const svg = (await page.locator('svg:has(g[data-id])').first().boundingBox())!;

  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.mouse.down();
  await page.mouse.move(svg.x + svg.width - 60, svg.y + 60, { steps: 8 }); // empty area
  await page.mouse.up();

  const menu = page.getByRole('menu', { name: 'Connect to new…' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Router' }).click();

  await expect(page.locator('g[data-id][role="button"]')).toHaveCount(devBefore + 1);
  await expect(page.locator('path[class*="linkHit"]')).toHaveCount(lnkBefore + 1);
});

test('rack: double-click an empty bay repeats the last-used preset (M4c)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1500 });
  await page.goto('/');
  await page.getByRole('button', { name: /Rack designer/i }).first().click();
  await page.getByRole('button', { name: /New rack/i }).click();
  await page.locator('[data-rack-face]').first().click(); // drill into focus view
  const canvas = page.getByTestId('rack-canvas');
  await expect(canvas).toBeVisible();

  // Arm a library preset and click-place it once.
  await page.getByRole('button', { name: /8-port switch/ }).first().click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4);
  await expect(page.locator('[data-testid="rack-canvas"] g[role="button"]')).toHaveCount(1);

  // Double-click another empty bay → same preset placed again.
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height * 0.7);
  await expect(page.locator('[data-testid="rack-canvas"] g[role="button"]')).toHaveCount(2);
});

test('keys do not leak past the open picker (Delete must not touch the canvas)', async ({ page }) => {
  await openBranchOffice(page);
  // Select a device so a leaked Delete would have something to destroy.
  const dev = page.locator('g[data-id][role="button"]').first();
  const hit = (await dev.locator('rect').first().boundingBox())!;
  await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2);
  await expect(dev).toHaveAttribute('aria-pressed', 'true');
  const count = await deviceCount(page);

  const svg = (await page.locator('svg:has(g[data-id])').first().boundingBox())!;
  await page.mouse.dblclick(svg.x + 40, svg.y + 40);
  await expect(page.getByRole('menu', { name: 'Add device' })).toBeVisible();

  await page.keyboard.press('Delete'); // router overlay swallows this
  await expect(page.getByRole('menu', { name: 'Add device' })).toBeVisible();
  expect(await deviceCount(page)).toBe(count); // selection survived

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Add device' })).toHaveCount(0);
});

test('quick-create with connection is ONE undo entry (no orphan device)', async ({ page }) => {
  await openBranchOffice(page);
  const devBefore = await deviceCount(page);
  const lnkBefore = await linkCount(page);

  const hit = (await page
    .locator('g[data-id][role="button"]')
    .first()
    .locator('rect')
    .first()
    .boundingBox())!;
  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
  const port = page.locator('[class*="connectHandle"]').first();
  await expect(port).toBeVisible();
  const pb = (await port.boundingBox())!;
  const svg = (await page.locator('svg:has(g[data-id])').first().boundingBox())!;

  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.mouse.down();
  await page.mouse.move(svg.x + svg.width - 60, svg.y + 60, { steps: 8 });
  await page.mouse.up();
  await page
    .getByRole('menu', { name: 'Connect to new…' })
    .getByRole('menuitem', { name: 'Router' })
    .click();
  await expect(page.locator('g[data-id][role="button"]')).toHaveCount(devBefore + 1);
  await expect(page.locator('path[class*="linkHit"]')).toHaveCount(lnkBefore + 1);

  await page.keyboard.press('ControlOrMeta+z'); // ONE undo removes device AND link
  await expect(page.locator('g[data-id][role="button"]')).toHaveCount(devBefore);
  await expect(page.locator('path[class*="linkHit"]')).toHaveCount(lnkBefore);
});
