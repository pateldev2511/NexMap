import { test, expect, type Page } from '@playwright/test';

/**
 * The top-bar "More" dropdown (W1a). Regression net for the v0.6.2 CI failure
 * where `.topbarActions` became an overflow-x:auto scroll container and clipped
 * the absolutely-positioned `<details>` panel — the menu opened invisibly and
 * its items were unclickable. The panel now portals to <body>, so it must open
 * fully on-screen and be clickable at BOTH default and narrow widths.
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
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible();
});

const moreButton = (page: Page) => page.getByRole('button', { name: 'More actions' });
const menu = (page: Page) => page.getByRole('menu');

test('More menu opens on-screen and its items are clickable (default width)', async ({
  page,
}) => {
  await moreButton(page).click();
  const panel = menu(page);
  await expect(panel).toBeVisible();
  // The item is the real hit target — Playwright refuses to click an occluded
  // element, which is exactly how CI caught the original clip bug.
  await panel.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: /Settings/i })).toBeVisible();
});

test('More menu works at a narrow width (the width CI failed at)', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await moreButton(page).click();
  const panel = menu(page);
  await expect(panel).toBeVisible();
  // Fully within the viewport — no horizontal clip.
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1100);
  await panel.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await expect(page.getByRole('heading', { name: /shortcuts/i })).toBeVisible();
});

test('Escape and outside-click close the menu', async ({ page }) => {
  await moreButton(page).click();
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);

  await moreButton(page).click();
  await expect(menu(page)).toBeVisible();
  // Click far away on the canvas.
  await page.mouse.click(400, 400);
  await expect(menu(page)).toHaveCount(0);
});
