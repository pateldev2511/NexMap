import { test, expect } from '@playwright/test';

test('multi-rack row view', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.getByRole('button', { name: /Rack designer/i }).first().click();

  // rack 1 from the empty state, place a switch
  await page.getByRole('button', { name: /New rack/i }).click();
  const canvas = page.getByTestId('rack-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.getByRole('button', { name: /^8-port switch/ }).first().click();
  await canvas.click({ position: { x: box.width / 2, y: 80 } });

  // rack 2 via toolbar, place a router
  await page.getByRole('button', { name: /^\+ Rack$/ }).click();
  await page.getByRole('button', { name: /Router/i }).first().click();
  const c2 = await canvas.boundingBox();
  await canvas.click({ position: { x: c2!.width / 2, y: 80 } });

  // switch to Row view
  await page.getByRole('button', { name: /^Row/ }).click();
  await page.waitForTimeout(300);

  // both cabinets render in the row SVG
  const row = page.getByRole('img', { name: 'All racks' });
  await expect(row).toBeVisible();
  // export-mode select exists
  await expect(page.getByRole('combobox').filter({ hasText: /Diagram/ })).toBeVisible();
});
