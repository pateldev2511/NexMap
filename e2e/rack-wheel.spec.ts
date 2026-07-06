import { test, expect, type Page } from '@playwright/test';

/**
 * Rack wheel contract (M2): the rack canvases now share the flat canvas's
 * wheel semantics — plain wheel PANS (it used to zoom), ctrl/pinch zooms at
 * the cursor, and the Settings wheelAction pref flips plain wheel to zoom.
 * This is intentional behavior change #1 of the pointer-native plan.
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

async function openRackTemplate(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Rack designer/i }).first().click();
  await page.getByRole('button', { name: /Enterprise core \(42U\)/ }).click();
}

const zoomPct = (page: Page) => page.locator('[class*="zoomControls"] span').first();

test('focus editor: plain wheel pans (scale unchanged), ctrl+wheel zooms', async ({
  page,
}) => {
  await openRackTemplate(page);
  await page.getByRole('button', { name: /^Single rack$/ }).click();
  const svg = page.getByTestId('rack-canvas');
  await expect(svg).toBeVisible();

  const styleBefore = await svg.getAttribute('style');
  const pctBefore = await zoomPct(page).textContent();

  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);

  await expect(zoomPct(page)).toHaveText(pctBefore!); // no zoom…
  await expect(svg).not.toHaveAttribute('style', styleBefore!); // …but it moved

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await expect(zoomPct(page)).not.toHaveText(pctBefore!); // ctrl = zoom
});

test('row view: plain wheel pans, scale readout unchanged', async ({ page }) => {
  await openRackTemplate(page);
  const row = page.getByRole('img', { name: 'All racks' });
  await expect(row).toBeVisible();

  const styleBefore = await row.getAttribute('style');
  const pctBefore = await zoomPct(page).textContent();

  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.wheel(0, 120);

  await expect(zoomPct(page)).toHaveText(pctBefore!);
  await expect(row).not.toHaveAttribute('style', styleBefore!);
});

test('the wheelAction=zoom pref applies to the ROW view too (separate wheel path)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nexmap.wheelAction', 'zoom'));
  await openRackTemplate(page);
  const row = page.getByRole('img', { name: 'All racks' });
  await expect(row).toBeVisible();
  const pctBefore = await zoomPct(page).textContent();

  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -120);

  await expect(zoomPct(page)).not.toHaveText(pctBefore!); // plain wheel zooms
});

test('the wheelAction=zoom pref applies to the rack canvas too', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nexmap.wheelAction', 'zoom'));
  await openRackTemplate(page);
  await page.getByRole('button', { name: /^Single rack$/ }).click();
  const pctBefore = await zoomPct(page).textContent();

  const svg = page.getByTestId('rack-canvas');
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -120);

  await expect(zoomPct(page)).not.toHaveText(pctBefore!); // plain wheel zooms
});
