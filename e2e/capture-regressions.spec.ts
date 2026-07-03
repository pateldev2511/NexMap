import { test, expect, type Page } from '@playwright/test';

/**
 * Capture-regression pins — the FIRST commit of the pointer-native canvas work
 * (docs/designs/pointer-native-canvas.md, M1).
 *
 * Two pointer-capture bugs have shipped from this layer already:
 *   - Phase 8: gestures captured the wrong element (parent div instead of the
 *     svg), silently breaking drag-pan, marquee, lasso, resize, and link
 *     rubber-banding.
 *   - v0.6.1: rack row pan captured too eagerly and stole the click that
 *     should drill into a rack.
 *
 * These specs pin the CURRENT (correct) behavior before the input-core
 * refactor touches any of it. If a migration commit breaks capture semantics,
 * these fail — not a user three weeks later.
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

async function openBranchOffice(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: /Branch office/ }).click();
  await expect(page.locator('g[data-id]').first()).toBeVisible();
}

test('flat canvas: device drag keeps tracking outside the svg and commits on release there', async ({
  page,
}) => {
  await openBranchOffice(page);

  const node = page.locator('g[data-id][role="button"]').first();
  const before = await node.getAttribute('transform');
  // The g's own bbox is inflated by the hover info-card overlay; the first
  // rect child is the device's true hit-area footprint — press its center.
  const nodeBox = (await node.locator('rect').first().boundingBox())!;
  const svgBox = (await page.locator('svg:has(g[data-id])').first().boundingBox())!;

  // Press on the device, cross the 4px drag threshold, then leave the svg
  // entirely (over the right-hand panel) and release THERE.
  const startX = nodeBox.x + nodeBox.width / 2;
  const startY = nodeBox.y + nodeBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Press selects immediately (minimal change so a drag moves the right thing).
  await expect(node).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(startX + 8, startY + 8);
  await page.mouse.move(svgBox.x + svgBox.width + 60, startY + 40, { steps: 8 });
  await page.mouse.up();

  // Pointer capture on the svg means the move+release outside the element
  // still belonged to the drag: the device moved (transform changed).
  await expect(node).not.toHaveAttribute('transform', before!);
});

test('flat canvas: marquee started on canvas commits a selection when released outside the svg', async ({
  page,
}) => {
  await openBranchOffice(page);

  const svgBox = (await page.locator('svg:has(g[data-id])').first().boundingBox())!;

  // Start in the top-left corner of the canvas (empty), sweep across the
  // diagram, and release beyond the svg's right edge.
  const startX = svgBox.x + 6;
  const startY = svgBox.y + 6;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 10, startY + 10); // cross threshold
  await page.mouse.move(svgBox.x + svgBox.width + 80, svgBox.y + svgBox.height - 10, {
    steps: 10,
  });
  await page.mouse.up();

  // The rubber-band rect covered the whole diagram; releasing outside the
  // element must still commit it (capture, not hover, owns the gesture).
  const selected = page.locator('g[data-id][aria-pressed="true"]');
  await expect(selected.first()).toBeVisible();
  expect(await selected.count()).toBeGreaterThanOrEqual(2);
});

test('rack row view: a left-drag pan does not steal the next click (drill-in still works)', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Rack designer/i }).first().click();
  await page.getByRole('button', { name: /New rack/i }).click();
  await page.getByRole('button', { name: /^\+ Rack$/ }).click();
  const row = page.getByRole('img', { name: 'All racks' });
  await expect(row).toBeVisible();

  // Real pan: press on empty row background, drag well past the 4px
  // threshold, release. (v0.6.1 bug class: eager capture here used to
  // swallow the click that follows.)
  const rowBox = (await row.boundingBox())!;
  const panX = rowBox.x + rowBox.width * 0.5;
  const panY = rowBox.y + 12; // above the cabinets, empty background
  await page.mouse.move(panX, panY);
  await page.mouse.down();
  await page.mouse.move(panX + 80, panY + 10, { steps: 5 });
  await page.mouse.up();

  // Still in row view — the pan itself must not drill in…
  await expect(row).toBeVisible();

  // …and a plain click on a rack face right after the pan drills in normally.
  await page.locator('[data-rack-face]').first().click();
  await expect(page.getByTestId('rack-canvas')).toBeVisible();
  await page.getByRole('button', { name: /All racks/ }).click();
  await expect(row).toBeVisible();
});
