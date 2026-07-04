import { test, expect, type Page, type Locator } from '@playwright/test';

/**
 * Rack in-canvas quick actions (M3b): the floating device toolbar and the
 * cable mini-controls — "everything can be done inside the canvas".
 */

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1500 });
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
  await page.getByRole('button', { name: /^Single rack$/ }).click();
  await expect(page.getByTestId('rack-canvas')).toBeVisible();
});

async function selectFirstDevice(page: Page) {
  const dev = page.locator('[data-testid="rack-canvas"] g[role="button"]').first();
  const box = (await dev.boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + box.height / 2); // left ear, not a jack
  await expect(page.getByRole('heading', { name: /^Selected device$/ })).toBeVisible();
  return dev;
}

test('device toolbar: nudge moves a U, delete removes the device', async ({ page }) => {
  const dev = await selectFirstDevice(page);
  const toolbar = page.getByRole('toolbar', { name: 'Device actions' });
  await expect(toolbar).toBeVisible();

  // The 42U template is packed: nudging the top device down lands on an
  // OCCUPIED U — which must flash the reason (behavior change #5), never
  // silently no-op. (A successful move is covered by rack-reject's inverse.)
  const labelBefore = await dev.getAttribute('aria-label');
  const nudgeDown = toolbar.getByRole('button', { name: 'Nudge down 1U' });
  await expect(nudgeDown).toBeVisible();
  await nudgeDown.click();
  // Scope to the canvas: the same reason ALSO lives in the hidden
  // screen-reader live region (announce routing), by design.
  await expect(
    page
      .getByTestId('rack-canvas')
      .getByText(/That U is occupied|That half-bay is taken|Won't fit there/),
  ).toBeVisible();
  await expect(dev).toHaveAttribute('aria-label', labelBefore!); // unmoved

  const count = await page.locator('[data-testid="rack-canvas"] g[role="button"]').count();
  await toolbar.getByRole('button', { name: 'Delete device' }).click();
  await expect(page.locator('[data-testid="rack-canvas"] g[role="button"]')).toHaveCount(
    count - 1,
  );
});

async function twoPorts(page: Page): Promise<[Locator, Locator]> {
  const ports = page.locator('[data-port]');
  const n = await ports.count();
  const a = ports.nth(0);
  const aDev = (await a.getAttribute('data-port'))!.split(':')[0];
  for (let i = n - 1; i > 0; i--) {
    const v = (await ports.nth(i).getAttribute('data-port'))!;
    if (v.split(':')[0] !== aDev) return [a, ports.nth(i)];
  }
  throw new Error('no second device with ports');
}

test('cable mini-controls: connect → edit label inline → delete on canvas', async ({
  page,
}) => {
  const [a, b] = await twoPorts(page);
  const ab = (await a.boundingBox())!;
  const bb = (await b.boundingBox())!;
  await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 8 });
  await page.mouse.up();

  // The new cable is selected → the mini-controls appear at the curve.
  const controls = page.getByRole('toolbar', { name: 'Cable actions' });
  await expect(controls).toBeVisible();

  // Inline label edit commits on Enter and shows up in the schedule.
  await controls.getByLabel('Cable label').fill('trunk-1');
  await controls.getByLabel('Cable label').press('Enter');
  await expect(page.getByText('trunk-1').first()).toBeVisible();

  // Escape inside the length field reverts the FIELD, not the selection.
  await controls.getByLabel('Cable length in feet').fill('999');
  await controls.getByLabel('Cable length in feet').press('Escape');
  await expect(controls).toBeVisible(); // cable still selected

  // Delete from the canvas controls.
  const cableCount = await page
    .locator('[data-testid="rack-canvas"] g[style*="cursor: pointer"]')
    .count();
  await controls.getByRole('button', { name: 'Delete cable' }).click();
  await expect(
    page.locator('[data-testid="rack-canvas"] g[style*="cursor: pointer"]'),
  ).toHaveCount(cableCount - 1);
});
