import { test, expect } from '@playwright/test';

test('rack designer opens into the side-by-side canvas; +Rack in place; hide rear; drill-in', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.getByRole('button', { name: /Rack designer/i }).first().click();

  // empty state → first rack → lands on the multi-rack canvas (not a single-rack view)
  await page.getByRole('button', { name: /New rack/i }).click();
  const row = page.getByRole('img', { name: 'All racks' });
  await expect(row).toBeVisible();

  // +Rack drops another cabinet in place (still the canvas)
  await page.getByRole('button', { name: /^\+ Rack$/ }).click();
  await expect(page.getByText(/2 racks · row view/)).toBeVisible();

  // hide-rear toggle flips the label
  const hideRear = page.getByRole('button', { name: /Hide rear/ });
  await expect(hideRear).toBeVisible();
  await hideRear.click();
  await expect(page.getByRole('button', { name: /Show rear/ })).toBeVisible();
  await page.getByRole('button', { name: /Show rear/ }).click();

  // click a rack → focused editor; back button returns to the canvas
  // (target the rack face directly — the canvas is pan/zoomed, so a fixed pixel
  // position isn't reliable; a stable element hook is.)
  await page.locator('[data-rack-face]').first().click();
  await expect(page.getByTestId('rack-canvas')).toBeVisible();
  await page.getByRole('button', { name: /All racks/ }).click();
  await expect(row).toBeVisible();
});
