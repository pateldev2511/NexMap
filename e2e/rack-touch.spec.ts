import { test, expect, type Page } from '@playwright/test';

/**
 * Touch gestures on the RACK canvases (review follow-up 2026-07-05): the
 * machine's pinch policy was shipped on both rack surfaces with zero e2e —
 * these mirror the flat-canvas touch.spec.ts via CDP touch events.
 */

test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1200 });
  await page.addInitScript(() => {
    try {
      indexedDB.deleteDatabase('nexmap');
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Rack designer/i }).first().click();
  await page.getByRole('button', { name: /Enterprise core \(42U\)/ }).click();
});

const zoomPct = (page: Page) => page.locator('text=/^\\d+%$/').first();

async function cdp(page: Page) {
  return page.context().newCDPSession(page);
}

test('focus editor: two-finger pinch zooms', async ({ page }) => {
  await page.getByRole('button', { name: /^Single rack$/ }).click();
  const canvas = page.getByTestId('rack-canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const pctBefore = await zoomPct(page).textContent();

  const s = await cdp(page);
  await s.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: cx - 40, y: cy }],
  });
  await s.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: cx - 40, y: cy },
      { x: cx + 40, y: cy },
    ],
  });
  for (let i = 1; i <= 6; i++) {
    await s.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: cx - 40 - i * 15, y: cy },
        { x: cx + 40 + i * 15, y: cy },
      ],
    });
  }
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(zoomPct(page)).not.toHaveText(pctBefore!);
});

test('row view: two fingers moving together pan without zooming', async ({ page }) => {
  const row = page.getByRole('img', { name: 'All racks' });
  await expect(row).toBeVisible();
  const box = (await row.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const styleBefore = await row.getAttribute('style');
  const pctBefore = await zoomPct(page).textContent();

  const s = await cdp(page);
  await s.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: cx - 100, y: cy }],
  });
  await s.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: cx - 100, y: cy },
      { x: cx + 100, y: cy },
    ],
  });
  for (let i = 1; i <= 5; i++) {
    await s.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: cx - 100, y: cy + i * 14 },
        { x: cx + 100, y: cy + i * 14 },
      ],
    });
  }
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect(row).not.toHaveAttribute('style', styleBefore!); // panned
  await expect(zoomPct(page)).toHaveText(pctBefore!); // 1% deadband: no zoom creep
});

test('row view: second finger mid-device-drag cancels into pinch (device stays)', async ({
  page,
}) => {
  const row = page.getByRole('img', { name: 'All racks' });
  await expect(row).toBeVisible();
  const dev = page.locator('g[data-rack-face] g[data-dev-id]').first();
  const devId = await dev.getAttribute('data-dev-id');
  const face = page.locator('[data-rack-face]').first();
  const faceAttr = await face.getAttribute('data-rack-face');
  const rackA = faceAttr!.replace(/-(front|rear)$/, '');
  const hit = (await dev.boundingBox())!;
  const x = hit.x + hit.width / 2;
  const y = hit.y + hit.height / 2;

  const s = await cdp(page);
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 4; i++) {
    await s.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + i * 30, y }],
    });
  }
  // Preview may be up; the second finger must cancel the move into a pinch.
  await s.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: x + 120, y },
      { x: x + 260, y: y + 80 },
    ],
  });
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect(page.getByTestId('row-drop-preview')).toHaveCount(0); // drag cancelled
  await expect(
    page.locator(`g[data-rack-face="${rackA}-front"] g[data-dev-id="${devId}"]`),
  ).toBeVisible(); // device never moved racks
});
