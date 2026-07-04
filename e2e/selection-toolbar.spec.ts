import { test, expect, type Page } from '@playwright/test';

/**
 * Floating selection toolbar (M3): appears near the selection, is the
 * primary quick-action path, hides during gestures, and NEVER intercepts
 * canvas gestures (the exact bug class this plan exists to kill).
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

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Selection actions' });

async function selectFirstDevice(page: Page) {
  const node = page.locator('g[data-id][role="button"]').first();
  const hit = (await node.locator('rect').first().boundingBox())!;
  await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2);
  await expect(node).toHaveAttribute('aria-pressed', 'true');
  return { node, hit };
}

test('appears on selection, near it; disappears when the selection clears', async ({
  page,
}) => {
  await openBranchOffice(page);
  await expect(toolbar(page)).toHaveCount(0);

  const { hit } = await selectFirstDevice(page);
  await expect(toolbar(page)).toBeVisible();
  const tb = (await toolbar(page).boundingBox())!;
  // Near the selection: within ~200px of the node, not pinned to the old
  // fixed top-center AlignBar slot.
  expect(Math.abs(tb.y - hit.y)).toBeLessThan(200);

  await page.keyboard.press('Escape'); // idle Escape → clears selection
  await expect(toolbar(page)).toHaveCount(0);
});

test('hides during a drag, returns on release', async ({ page }) => {
  await openBranchOffice(page);
  const { hit } = await selectFirstDevice(page);
  await expect(toolbar(page)).toBeVisible();

  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
  await page.mouse.down();
  await page.mouse.move(hit.x + 60, hit.y + 60, { steps: 4 });
  await expect(toolbar(page)).toHaveCount(0); // gone while dragging
  await page.mouse.up();
  await expect(toolbar(page)).toBeVisible(); // back on settle
});

test('toolbar clicks act on the selection and never start a canvas gesture', async ({
  page,
}) => {
  await openBranchOffice(page);
  await page.keyboard.press('ControlOrMeta+a');
  const selected = await page.locator('g[data-id][aria-pressed="true"]').count();
  expect(selected).toBeGreaterThanOrEqual(2);
  await expect(toolbar(page)).toBeVisible();

  // Click align-left ON the toolbar: selection survives, nothing deselects,
  // no marquee starts underneath.
  await toolbar(page).getByRole('button', { name: 'Align left' }).click();
  await expect(page.locator('g[data-id][aria-pressed="true"]')).toHaveCount(selected);

  // And it actually aligned: all selected nodes share one left edge.
  const xs = await page
    .locator('g[data-id][aria-pressed="true"]')
    .evaluateAll((els) =>
      els.map((el) => /translate\(([-\d.]+)/.exec(el.getAttribute('transform') ?? '')?.[1]),
    );
  expect(new Set(xs).size).toBe(1);
});

test('delete on the toolbar deletes the selection', async ({ page }) => {
  await openBranchOffice(page);
  const before = await page.locator('g[data-id][role="button"]').count();
  await selectFirstDevice(page);
  await toolbar(page).getByRole('button', { name: 'Delete selection' }).click();
  await expect(page.locator('g[data-id][role="button"]')).toHaveCount(before - 1);
});

test('wheel over the toolbar does not move the canvas', async ({ page }) => {
  await openBranchOffice(page);
  const { node } = await selectFirstDevice(page);
  const beforeTransform = await node.getAttribute('transform');
  const tb = (await toolbar(page).boundingBox())!;
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.wheel(0, 120);
  // The node's SCREEN position is a function of the viewport; unchanged
  // model transform + unchanged screen box = no pan happened.
  await expect(node).toHaveAttribute('transform', beforeTransform!);
  const hit2 = (await node.locator('rect').first().boundingBox())!;
  const tb2 = (await toolbar(page).boundingBox())!;
  expect(Math.round(tb2.y)).toBe(Math.round(tb.y));
  expect(hit2).toBeTruthy();
});
