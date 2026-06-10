import { test, expect, type Page } from '@playwright/test';

// Start each test from a clean slate so the entry chooser appears (no recoverable
// IndexedDB draft, no persisted designer-mode in localStorage).
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

/** Pick the Network designer from the entry chooser, landing on the template screen. */
async function chooseNetwork(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
}

test('entry chooser offers both designers', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Network Designer/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Rack Designer/ })).toBeVisible();
});

test('Rack Designer entry shows the rack empty state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Rack Designer/ }).click();
  await expect(page.getByText('No racks yet')).toBeVisible();
  await expect(page.getByRole('button', { name: /New rack/ })).toBeVisible();
});

test('Network Designer shows grouped starter templates', async ({ page }) => {
  await chooseNetwork(page);
  await expect(page.getByText('Home & small office')).toBeVisible();
  await expect(page.getByText('Enterprise & data center')).toBeVisible();
  await expect(page.getByRole('button', { name: /Branch office/ })).toBeVisible();
});

test('loading a template populates the canvas and dismisses the start screen', async ({
  page,
}) => {
  await chooseNetwork(page);
  await page.getByRole('button', { name: /Branch office/ }).click();
  // Start screen is gone…
  await expect(page.getByText('Home & small office')).toHaveCount(0);
  // …and the canvas has rendered device nodes.
  await expect(page.locator('g[data-id]').first()).toBeVisible();
});

test('command palette opens with Ctrl/Cmd+K and filters', async ({ page }) => {
  await chooseNetwork(page);
  await page.getByRole('button', { name: /Blank project/ }).click();
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByPlaceholder('Type a command…').fill('iso');
  await expect(palette.getByText('Toggle 2D / isometric view')).toBeVisible();
});

test('keyboard: a device node is focusable and selectable with Enter', async ({ page }) => {
  await chooseNetwork(page);
  await page.getByRole('button', { name: /Branch office/ }).click();
  const node = page.locator('g[data-id][role="button"]').first();
  await expect(node).toBeVisible();
  // It exposes an accessible name for screen readers.
  await expect(node).toHaveAttribute('aria-label', /.+/);
  await node.focus();
  await page.keyboard.press('Enter');
  // Exactly the focused device becomes selected (aria-pressed reflects it).
  await expect(page.locator('g[data-id][aria-pressed="true"]')).toHaveCount(1);
});

test('toggles to the isometric view without error', async ({ page }) => {
  await chooseNetwork(page);
  await page.getByRole('button', { name: /Branch office/ }).click();
  await page.getByRole('button', { name: 'Toggle isometric view' }).click();
  // The iso scene mounts (upright iso device groups appear).
  await expect(page.locator('[class*="isoNode"]').first()).toBeVisible();
});
