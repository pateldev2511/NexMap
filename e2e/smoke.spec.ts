import { test, expect } from '@playwright/test';

// Start each test from a clean slate so the first-run start screen appears
// (no recoverable IndexedDB draft).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      indexedDB.deleteDatabase('nexmap');
    } catch {
      /* ignore */
    }
  });
});

test('start screen shows grouped starter templates', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Home & small office')).toBeVisible();
  await expect(page.getByText('Enterprise & data center')).toBeVisible();
  await expect(page.getByRole('button', { name: /Branch office/ })).toBeVisible();
});

test('loading a template populates the canvas and dismisses the start screen', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Branch office/ }).click();
  // Start screen is gone…
  await expect(page.getByText('Home & small office')).toHaveCount(0);
  // …and the canvas has rendered device nodes.
  await expect(page.locator('g[data-id]').first()).toBeVisible();
});

test('command palette opens with Ctrl/Cmd+K and filters', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Blank project/ }).click();
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByPlaceholder('Type a command…').fill('iso');
  await expect(palette.getByText('Toggle 2D / isometric view')).toBeVisible();
});

test('toggles to the isometric view without error', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Branch office/ }).click();
  await page.getByRole('button', { name: 'Toggle isometric view' }).click();
  // The iso scene mounts (upright iso device groups appear).
  await expect(page.locator('[class*="isoNode"]').first()).toBeVisible();
});
