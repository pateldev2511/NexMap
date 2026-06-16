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

test('focus view: marquee-drag on the canvas multi-selects devices and opens the bulk-edit panel', async ({ page }) => {
  // Tall viewport so the full rack SVG is on-screen (a 42U rack is taller than the default 720).
  await page.setViewportSize({ width: 1280, height: 1500 });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.getByRole('button', { name: /Rack designer/i }).first().click();

  // Apply a template so the rack has gear to select.
  await page.getByRole('button', { name: /Enterprise core \(42U\)/ }).click();
  // Drill into the single-rack focus editor.
  await page.getByRole('button', { name: /^Single rack$/ }).click();
  const canvas = page.getByTestId('rack-canvas');
  await expect(canvas).toBeVisible();

  // Rubber-band a large box: start in the empty left rail margin (empty regardless of U
  // occupancy, and a device pointerdown would stopPropagation anyway), drag across the gear.
  const box = (await canvas.boundingBox())!;
  const startX = box.x + 4; // left rail/frame, not a device panel
  const startY = box.y + box.height * 0.15;
  const endX = box.x + box.width * 0.85;
  const endY = box.y + box.height * 0.8;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 6, startY + 8); // cross the marquee threshold
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();

  // The bulk-edit panel appears once the marquee grabbed 2+ devices.
  await expect(page.getByRole('heading', { name: /Bulk edit · \d+ devices/ })).toBeVisible();

  // Arbiter regression guard: a plain click on a single device drops back to single-select
  // (the marquee gesture didn't hijack normal device clicks).
  await page.locator('[role="button"][aria-label*="U"]').first().click();
  await expect(page.getByRole('heading', { name: /^Selected device$/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Bulk edit · \d+ devices/ })).toHaveCount(0);
});

test('hardware tab: upload a device photo via the dropzone, then remove it', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.getByRole('button', { name: /Rack designer/i }).first().click();
  await page.getByRole('button', { name: /Enterprise core \(42U\)/ }).click();
  await page.getByRole('button', { name: /^Single rack$/ }).click();

  // Select a device and open the Hardware tab.
  await page.locator('[role="button"][aria-label*="U"]').first().click();
  await page.getByRole('button', { name: /^hardware$/ }).click();

  // The dropzone is shown when no photo is set.
  await expect(page.getByText(/Drop a photo or click/)).toBeVisible();

  // Upload a tiny valid PNG to the hidden file input.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  // Scope to the dropzone's own input (the toolbar's Open button also has a file input).
  await page.locator('label:has-text("Drop a photo") input[type="file"]').setInputFiles({ name: 'gear.png', mimeType: 'image/png', buffer: png });

  // The thumbnail + Remove replace the dropzone.
  await expect(page.getByRole('img', { name: /photo/ })).toBeVisible();
  const remove = page.getByRole('button', { name: /^Remove$/ });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(page.getByText(/Drop a photo or click/)).toBeVisible();
});
