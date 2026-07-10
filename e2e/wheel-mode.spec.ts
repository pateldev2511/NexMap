import { test, expect, type Page } from '@playwright/test';

/**
 * Wheel contract e2e (pointer-native canvas, M1): plain wheel PANS by
 * default on the flat canvas; the Settings "Scroll wheel" toggle flips it to
 * zoom; ctrl+wheel zooms in both modes; wheel over floating chrome never
 * moves the canvas.
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

const zoomPct = (page: Page) => page.locator('text=/^\\d+%$/').first();

async function nodeScreenY(page: Page): Promise<number> {
  const box = (await page
    .locator('g[data-id][role="button"]')
    .first()
    .locator('rect')
    .first()
    .boundingBox())!;
  return box.y;
}

test('plain wheel pans by default (zoom % unchanged, content shifts)', async ({ page }) => {
  await openBranchOffice(page);
  const pctBefore = await zoomPct(page).textContent();
  const yBefore = await nodeScreenY(page);

  const svg = (await page.locator('svg:has(g[data-id])').first().boundingBox())!;
  await page.mouse.move(svg.x + svg.width / 2, svg.y + svg.height / 2);
  await page.mouse.wheel(0, 120);

  await expect(zoomPct(page)).toHaveText(pctBefore!); // no zoom
  const yAfter = await nodeScreenY(page);
  expect(Math.abs(yAfter - yBefore)).toBeGreaterThan(50); // panned
});

test('ctrl+wheel zooms at the cursor in pan mode', async ({ page }) => {
  await openBranchOffice(page);
  const pctBefore = await zoomPct(page).textContent();
  const svg = (await page.locator('svg:has(g[data-id])').first().boundingBox())!;
  await page.mouse.move(svg.x + svg.width / 2, svg.y + svg.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await expect(zoomPct(page)).not.toHaveText(pctBefore!);
});

test('the Settings toggle flips plain wheel to zoom, and back', async ({ page }) => {
  await openBranchOffice(page);

  // Flip the pref via Settings (More menu → Settings). The More menu is a
  // portaled dropdown; open it if the Settings item isn't already showing.
  if (!(await page.getByRole('button', { name: 'Settings' }).isVisible())) {
    await page.getByRole('button', { name: 'More actions' }).click();
  }
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Scroll wheel behavior').selectOption('zoom');
  await page.getByRole('button', { name: /^Done$/ }).click();

  const pctBefore = await zoomPct(page).textContent();
  const svg = (await page.locator('svg:has(g[data-id])').first().boundingBox())!;
  await page.mouse.move(svg.x + svg.width / 2, svg.y + svg.height / 2);
  await page.mouse.wheel(0, -120);
  await expect(zoomPct(page)).not.toHaveText(pctBefore!); // zoomed

  // And back to pan. Open the More menu again if Settings isn't showing.
  if (!(await page.getByRole('button', { name: 'Settings' }).isVisible())) {
    await page.getByRole('button', { name: 'More actions' }).click();
  }
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Scroll wheel behavior').selectOption('pan');
  await page.getByRole('button', { name: /^Done$/ }).click();
  const pct2 = await zoomPct(page).textContent();
  await page.mouse.move(svg.x + svg.width / 2, svg.y + svg.height / 2);
  await page.mouse.wheel(0, 120);
  await expect(zoomPct(page)).toHaveText(pct2!);
});

test('wheel over floating chrome does not move the canvas', async ({ page }) => {
  await openBranchOffice(page);
  const yBefore = await nodeScreenY(page);
  const pctBefore = await zoomPct(page).textContent();

  const toolbar = (await page
    .getByRole('toolbar', { name: 'Canvas tools' })
    .boundingBox())!;
  await page.mouse.move(toolbar.x + toolbar.width / 2, toolbar.y + toolbar.height / 2);
  await page.mouse.wheel(0, 120);

  expect(await nodeScreenY(page)).toBeCloseTo(yBefore, 0);
  await expect(zoomPct(page)).toHaveText(pctBefore!);
});
