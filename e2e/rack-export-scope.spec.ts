import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/**
 * Export handoff scope (#39): a focused rack's artifacts hold that rack — its local runs
 * plus its cross-rack runs with the far rack named — under that rack's filenames; the
 * fleet is its own named export; and a render that fails says why and offers Retry.
 */

interface Store {
  racksAll(): { id: string; name: string }[];
  devicesAll(): { id: string; rackId?: string; type: string; interfaces?: { id: string }[] }[];
  mountPartsList(rackId: string, text: string): void;
  updateRack(id: string, before: { name?: string }, after: { name?: string }): void;
  connectRackCable(a: { deviceId: string; ifaceId: string }, b: { deviceId: string; ifaceId: string }, color: string, label?: string): string | null;
}
type W = Window & { __nexmap: { getState(): Store } };

/** Two racks, each with a local run, and one run between them (drawn from B's side). */
async function twoRacks(page: Page): Promise<{ a: string; b: string }> {
  await page.getByRole('button', { name: /New rack/i }).click();
  await page.getByRole('button', { name: /^\+ Rack$/ }).click();
  await expect(page.getByText(/2 racks · row view/)).toBeVisible();
  return page.evaluate(() => {
    const s = (window as unknown as W).__nexmap.getState();
    const [ra, rb] = s.racksAll();
    s.updateRack(ra!.id, { name: ra!.name }, { name: 'Rack A' });
    s.updateRack(rb!.id, { name: rb!.name }, { name: 'Rack B' });
    s.mountPartsList(ra!.id, '2x 24 port switch');
    s.mountPartsList(rb!.id, '2x 24 port switch');
    const sw = (rackId: string) => s.devicesAll().filter((d) => d.rackId === rackId && d.type === 'switch');
    const [a1, a2] = sw(ra!.id);
    const [b1, b2] = sw(rb!.id);
    const end = (d: typeof a1, i: number) => ({ deviceId: d!.id, ifaceId: d!.interfaces![i]!.id });
    s.connectRackCable(end(a1, 0), end(a2, 0), '#2563eb', 'A-LOCAL');
    s.connectRackCable(end(b1, 1), end(a1, 1), '#2563eb', 'X-RUN');
    s.connectRackCable(end(b1, 0), end(b2, 0), '#2563eb', 'B-LOCAL');
    return { a: 'Rack A', b: 'Rack B' };
  });
}

/** Drill into rack A (the first face in the row) and open the drawer from there. */
async function openFromRackA(page: Page) {
  await page.locator('[data-rack-face]').first().click();
  await expect(page.getByTestId('rack-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Export handoff' }).first().click();
  return page.getByRole('dialog', { name: 'Export handoff' });
}

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
  await page.getByRole('button', { name: /Rack designer/i }).first().click();
});

test('a focused rack exports its own runs and names the far rack; the fleet is its own export', async ({ page }) => {
  const { a, b } = await twoRacks(page);

  // Opened from the row view, the drawer covers every rack.
  await page.getByRole('button', { name: 'Export handoff' }).first().click();
  let drawer = page.getByRole('dialog', { name: 'Export handoff' });
  await expect(drawer.getByTestId('export-scope-summary')).toHaveText(/^All 2 racks · \d+ devices · 3 cables \(1 cross-rack\)$/);
  await expect(drawer.getByText(/all-racks-cables\.csv/)).toBeVisible();
  await drawer.getByRole('button', { name: 'Close export drawer' }).click();

  // Opened from a focused rack, it covers that rack.
  drawer = await openFromRackA(page);
  const summary = drawer.getByTestId('export-scope-summary');
  await expect(summary).toHaveText(new RegExp(`^${a} · \\d+ devices · 2 cables \\(1 cross-rack\\)$`));
  await expect(drawer.getByRole('button', { name: `This rack · ${a}` })).toHaveAttribute('aria-pressed', 'true');

  const [csv] = await Promise.all([page.waitForEvent('download'), drawer.getByRole('button', { name: 'CSV', exact: true }).click()]);
  expect(csv.suggestedFilename()).toBe(`${a}-cables.csv`);
  const text = await readFile((await csv.path())!, 'utf8');
  expect(text).toContain('A-LOCAL');
  expect(text).toContain(`"to ${b}"`);
  expect(text).not.toContain('B-LOCAL');

  const [bom] = await Promise.all([page.waitForEvent('download'), drawer.getByRole('button', { name: 'BOM', exact: true }).click()]);
  expect(bom.suggestedFilename()).toBe(`${a}-bom.csv`);

  await drawer.getByRole('button', { name: 'All racks · 2' }).click();
  const [fleet] = await Promise.all([page.waitForEvent('download'), drawer.getByRole('button', { name: 'CSV', exact: true }).click()]);
  expect(fleet.suggestedFilename()).toBe('all-racks-cables.csv');
  expect(await readFile((await fleet.path())!, 'utf8')).toContain('B-LOCAL');
});

test('a render that fails says why and retries to a download', async ({ page }) => {
  const { a } = await twoRacks(page);
  const drawer = await openFromRackA(page);

  // Force the canvas encode to fail, as an oversized sheet does.
  await page.evaluate(() => {
    const w = window as unknown as { __toBlob?: typeof HTMLCanvasElement.prototype.toBlob };
    w.__toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(null);
    };
  });
  const packet = drawer.locator('div').filter({ has: page.locator('b', { hasText: /^Install packet$/ }) }).last();
  await packet.getByRole('button', { name: 'PNG', exact: true }).click();
  const alert = drawer.getByRole('alert');
  await expect(alert).toContainText(`Couldn’t export the ${a} install packet PNG (Canvas export failed). Nothing was downloaded`);
  await expect(drawer).toBeVisible(); // still open, so the retry is one click away

  await page.evaluate(() => {
    const w = window as unknown as { __toBlob?: typeof HTMLCanvasElement.prototype.toBlob };
    HTMLCanvasElement.prototype.toBlob = w.__toBlob!;
  });
  const [png] = await Promise.all([page.waitForEvent('download'), alert.getByRole('button', { name: 'Retry' }).click()]);
  expect(png.suggestedFilename()).toBe(`${a}-install-packet.png`);
  await expect(drawer.getByRole('alert')).toHaveCount(0);
});
