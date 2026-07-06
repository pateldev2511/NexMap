import { test, expect, type Page } from '@playwright/test';

/**
 * M3c — earned-quiet demotion + panel persistence.
 *   - Chrome NEVER dims before the first completed gesture (earned quiet).
 *   - After a gesture + 4s idle, chrome drops to 60% (active tool exempt).
 *   - Hover restores full opacity.
 *   - Panel collapse survives a reload.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      // First document load only — a reload must KEEP storage, since panel
      // persistence across reloads is exactly what this file tests.
      if (!sessionStorage.getItem('e2e-wiped')) {
        indexedDB.deleteDatabase('nexmap');
        localStorage.clear();
        sessionStorage.setItem('e2e-wiped', '1');
      }
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

const zoomBarOpacity = (page: Page) =>
  page
    .locator('[data-demote="chrome"]')
    .first()
    .evaluate((el) => Number(getComputedStyle(el).opacity));

async function dragFirstDevice(page: Page) {
  const node = page.locator('g[data-id][role="button"]').first();
  const hit = (await node.locator('rect').first().boundingBox())!;
  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
  await page.mouse.down();
  await page.mouse.move(hit.x + 40, hit.y + 30, { steps: 4 });
  await page.mouse.up();
}

test('chrome does not dim before quiet is EARNED, dims after gesture + 4s, hover restores', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openBranchOffice(page);

  // Fresh session, no gesture yet: park the pointer over the canvas and wait
  // out the timer — chrome must stay at full opacity (reading time is sacred).
  const svg = (await page.locator('svg:has(g[data-id])').first().boundingBox())!;
  await page.mouse.move(svg.x + svg.width / 2, svg.y + 40);
  await page.waitForTimeout(4600);
  expect(await zoomBarOpacity(page)).toBe(1);

  // Complete a real gesture → quiet is earned → 4s idle → 60%.
  await dragFirstDevice(page);
  await page.mouse.move(svg.x + svg.width / 2, svg.y + 40); // stay over canvas
  await expect
    .poll(() => zoomBarOpacity(page), { timeout: 7000 })
    .toBeLessThan(0.95);
  // 0.8 floor (a11y review 2026-07-05): quiet must stay readable, not just calm.
  expect(await zoomBarOpacity(page)).toBeCloseTo(0.8, 1);

  // The ACTIVE tool button never dims; its idle siblings do.
  const activeOpacity = await page
    .locator('[role="toolbar"][aria-label="Canvas tools"] button[aria-pressed="true"]')
    .first()
    .evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(activeOpacity).toBe(1);

  // Hover the zoom bar → instant full opacity (CSS, no JS roundtrip needed).
  const zb = (await page.locator('[data-demote="chrome"]').first().boundingBox())!;
  await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2);
  await expect.poll(() => zoomBarOpacity(page), { timeout: 2000 }).toBe(1);
});

test('inspector collapse and bottom-panel state survive a reload', async ({ page }) => {
  await openBranchOffice(page);

  // Collapse the Inspector via the topbar toggle (accessible name is the
  // label text; the title attribute is just the tooltip).
  const inspectorToggle = page.getByRole('button', { name: 'Inspector', exact: true });
  await expect(inspectorToggle).toHaveAttribute('aria-pressed', 'true');
  await inspectorToggle.click();
  await expect(inspectorToggle).toHaveAttribute('aria-pressed', 'false');
  // Open the bottom panel's Validation tab.
  await page.getByRole('button', { name: /Validation/ }).first().click();
  await expect(page.getByRole('button', { name: 'Collapse panel' })).toBeVisible();

  await page.reload();
  // The autosaved draft triggers the recovery prompt — take the recovery.
  // The dialog rides an async IndexedDB read — a one-shot isVisible() races
  // it on slow CI; wait briefly, then dismiss if it appeared.
  const recover = page.getByRole('dialog').getByRole('button').first();
  const dialogShown = await page
    .getByText('Recover your work?')
    .waitFor({ timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (dialogShown) await recover.click();
  await expect(page.getByRole('button', { name: 'Inspector', exact: true })).toBeVisible();

  // Inspector stayed collapsed…
  await expect(
    page.getByRole('button', { name: 'Inspector', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  // …and the bottom panel stayed open.
  await expect(page.getByRole('button', { name: 'Collapse panel' })).toBeVisible();
});
