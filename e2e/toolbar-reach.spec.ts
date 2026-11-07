import { test, expect, type Page } from '@playwright/test';

/**
 * Every primary toolbar action stays reachable at phone, tablet and desktop widths.
 * `click({ trial: true })` scrolls the button into view and fails if anything else
 * would receive the click there, so this checks real hit targets, not DOM presence.
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

const ACTIONS = ['New', 'Open', 'Save', 'Export', 'Switch designer'];

async function openBranchOffice(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: /Branch office/ }).click();
  await expect(page.locator('g[data-id][role="button"]').first()).toBeVisible();
}

const strip = (page: Page) => page.locator('header [class*="topbarActions"]');

for (const [width, height] of [
  [390, 844],
  [768, 1024],
  [1280, 800],
  [1440, 900],
] as const) {
  test(`toolbar actions are reachable by pointer and keyboard at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openBranchOffice(page);

    for (const name of ACTIONS) {
      // Exact, short names at every width: hidden labels still name the button.
      const button = strip(page).getByRole('button', { name, exact: true });
      await button.click({ trial: true });
      await button.focus();
      await expect(button).toBeInViewport();
    }

    // The canvas toolbar too: every tool, first to last, can be reached.
    const tools = page.getByRole('toolbar', { name: 'Canvas tools' }).getByRole('button');
    for (const i of [0, (await tools.count()) - 1]) await tools.nth(i).click({ trial: true });

    // The panel toggles beside the strip are never covered by it.
    for (const name of ['Library', 'Inspector']) {
      await page.getByRole('button', { name, exact: true }).click({ trial: true });
    }

    // On a desktop the whole strip fits (icons only if need be): nothing to scroll to.
    if (width >= 1280) {
      const { scroll, client } = await strip(page).evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }));
      expect(scroll).toBeLessThanOrEqual(client + 1);
    }

    // The More menu opens (it closes on scroll, so a strip that scrolls on focus broke it).
    await strip(page).getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('button', { name: 'Presentation' })).toBeVisible();
    await page.keyboard.press('Escape');

    // The canvas keeps most of the screen.
    const canvas = await page.locator('main, [class*="canvas"]').first().boundingBox();
    expect(canvas!.height).toBeGreaterThan(height * 0.5);
  });
}

test.describe('touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('toolbar actions can be tapped on a phone', async ({ page }) => {
    await openBranchOffice(page);
    for (const name of ACTIONS) {
      await strip(page).getByRole('button', { name, exact: true }).tap({ trial: true });
    }
  });
});
