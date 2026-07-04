import { test, expect, type Page } from '@playwright/test';

/**
 * Touch/tablet gestures (M4a): tap selects, one-finger drag moves a device,
 * two fingers pinch-zoom and pan — including the escape hatch where a second
 * finger mid-drag CANCELS the drag into a pinch. Two-point sequences are
 * synthesized via CDP Input.dispatchTouchEvent, which Chromium turns into
 * real touch PointerEvents (pointerType 'touch') through the same pipeline
 * users hit.
 */

test.use({ hasTouch: true });

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
  await page.getByRole('button', { name: /Branch office/ }).click();
  await expect(page.locator('g[data-id]').first()).toBeVisible();
});

const zoomPct = (page: Page) => page.locator('text=/^\\d+%$/').first();

async function cdp(page: Page) {
  return page.context().newCDPSession(page);
}

test('tap selects a device; one-finger drag moves it', async ({ page }) => {
  const node = page.locator('g[data-id][role="button"]').first();
  const before = await node.getAttribute('transform');
  const hit = (await node.locator('rect').first().boundingBox())!;
  const x = hit.x + hit.width / 2;
  const y = hit.y + hit.height / 2;

  await page.touchscreen.tap(x, y);
  await expect(node).toHaveAttribute('aria-pressed', 'true');

  const s = await cdp(page);
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 5; i++) {
    await s.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + i * 12, y: y + i * 8 }],
    });
  }
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(node).not.toHaveAttribute('transform', before!);
});

test('two-finger pinch zooms at the centroid; two-finger move pans', async ({ page }) => {
  const svg = (await page.locator('svg:has(g[data-id])').first().boundingBox())!;
  const cx = svg.x + svg.width / 2;
  const cy = svg.y + svg.height / 2;
  const pctBefore = await zoomPct(page).textContent();

  const s = await cdp(page);
  // Pinch OUT from the center of empty canvas: first finger arms a marquee,
  // the second cancels it into the pinch (the machine's escape hatch).
  await s.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: cx - 30, y: cy }],
  });
  await s.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: cx - 30, y: cy },
      { x: cx + 30, y: cy },
    ],
  });
  for (let i = 1; i <= 6; i++) {
    await s.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: cx - 30 - i * 15, y: cy },
        { x: cx + 30 + i * 15, y: cy },
      ],
    });
  }
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(zoomPct(page)).not.toHaveText(pctBefore!); // zoomed

  // Two fingers moving TOGETHER pan without changing zoom.
  const pctAfterZoom = await zoomPct(page).textContent();
  const nodeYBefore = (await page
    .locator('g[data-id][role="button"]')
    .first()
    .locator('rect')
    .first()
    .boundingBox())!.y;
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
  await expect(zoomPct(page)).toHaveText(pctAfterZoom!); // same zoom…
  const nodeYAfter = (await page
    .locator('g[data-id][role="button"]')
    .first()
    .locator('rect')
    .first()
    .boundingBox())!.y;
  expect(Math.abs(nodeYAfter - nodeYBefore)).toBeGreaterThan(30); // …but panned
});

test('second finger mid-drag cancels the drag into a pinch (device reverts)', async ({
  page,
}) => {
  const node = page.locator('g[data-id][role="button"]').first();
  const before = await node.getAttribute('transform');
  const hit = (await node.locator('rect').first().boundingBox())!;
  const x = hit.x + hit.width / 2;
  const y = hit.y + hit.height / 2;

  const s = await cdp(page);
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 4; i++) {
    await s.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + i * 10, y }],
    });
  }
  // Second finger lands: the drag must CANCEL (revert) and become a pinch.
  await s.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: x + 40, y },
      { x: x + 140, y: y + 60 },
    ],
  });
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect(node).toHaveAttribute('transform', before!); // reverted, not moved
});
