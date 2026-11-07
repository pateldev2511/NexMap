import { test, expect, type Page } from '@playwright/test';

/**
 * The entry chooser must route to the designer you actually pick, and switching
 * designers opens the same project in the other designer (#54).
 *
 * Regression context: a lingering autosave draft used to make App bypass the
 * chooser whenever `mode === null` and fall through to `isRack = false`,
 * silently rendering the Network Designer — so picking Rack after a switch
 * landed you in Network. The fix: the chooser owns the mode===null state
 * unconditionally, and switch-designer discards the stale draft. (The
 * draft-present precondition is verified manually in-browser; headless
 * IndexedDB timing makes an autosave-across-reload fixture flaky, so these
 * pin the routing that the fix guarantees.)
 */

const inNetwork = (page: Page) =>
  page.getByPlaceholder('Search components').isVisible().catch(() => false);
const inRack = (page: Page) =>
  page.getByRole('button', { name: /New rack/i }).isVisible().catch(() => false);

test('Rack card opens the Rack designer (not Network)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Rack Designer/ }).click();
  await expect.poll(() => inRack(page)).toBe(true); // designers load as lazy chunks (#44)
  expect(await inNetwork(page)).toBe(false);
});

test('Network card opens the Network designer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await expect.poll(() => inNetwork(page)).toBe(true); // designers load as lazy chunks (#44)
  expect(await inRack(page)).toBe(false);
});

/**
 * #54: switching designer opens the SAME project in the other view — the
 * document, its ids, unsaved edits, undo history and file carry over. A project
 * with a network, two racks and a patch cable between them makes the
 * logical-to-physical round trip concrete.
 */
const NOW = '2026-01-01T00:00:00.000Z';
const port = (id: string) => ({ id, name: id });
const twoRackProject = JSON.stringify({
  schemaVersion: 7,
  appVersion: '0.6.2',
  project: { id: 'p-two-racks', name: 'Two racks', createdAt: NOW, updatedAt: NOW, description: '', units: 'px' },
  layers: [{ id: 'L', name: 'Default', visible: true, locked: false, order: 0 }],
  devices: [
    { id: 'sw-a', kind: 'device', type: 'switch', name: 'sw-a', x: 100, y: 100, width: 56, height: 40, layerId: 'L', interfaces: [port('a1')], rackId: 'rack-a', ru: 40, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full' },
    { id: 'sw-b', kind: 'device', type: 'switch', name: 'sw-b', x: 300, y: 100, width: 56, height: 40, layerId: 'L', interfaces: [port('b1')], rackId: 'rack-b', ru: 40, ruSpan: 1, mount: 'rack', side: 'front', bay: 'full' },
    { id: 'rtr', kind: 'device', type: 'router', name: 'edge', x: 200, y: 0, width: 56, height: 40, layerId: 'L', interfaces: [] },
  ],
  links: [
    { id: 'l-ab', kind: 'link', sourceId: 'sw-a', targetId: 'sw-b', layerId: 'L', sourceIfaceId: 'a1', targetIfaceId: 'b1' },
    { id: 'l-up', kind: 'link', sourceId: 'rtr', targetId: 'sw-a', layerId: 'L' },
  ],
  objects: [],
  vlans: [],
  subnets: [],
  racks: [
    { id: 'rack-a', name: 'Rack A', ruHeight: 42 },
    { id: 'rack-b', name: 'Rack B', ruHeight: 42 },
  ],
  rackCables: [{ id: 'c-ab', aEnd: { deviceId: 'sw-a', ifaceId: 'a1' }, bEnd: { deviceId: 'sw-b', ifaceId: 'b1' }, color: '#22d3ee' }],
  views: [],
  invariants: [],
  customRules: [],
  interfaces: [],
  assets: [],
  customFields: [],
});

type Snap = { devices: string[]; links: string[]; cables: string[]; name: string; dirty: boolean; canUndo: boolean };
const snapshot = (page: Page) =>
  page.evaluate((): Snap => {
    const st = (
      window as unknown as {
        __nexmap: {
          getState(): {
            devicesAll(): { id: string }[];
            linksAll(): { id: string }[];
            rackCablesAll(): { id: string }[];
            projectName: string;
            dirty: boolean;
            canUndo: boolean;
          };
        };
      }
    ).__nexmap.getState();
    return {
      devices: st.devicesAll().map((d) => d.id),
      links: st.linksAll().map((l) => l.id),
      cables: st.rackCablesAll().map((c) => c.id),
      name: st.projectName,
      dirty: st.dirty,
      canUndo: st.canUndo,
    };
  });

test('switch designer keeps the same project: network ↔ racks round trip', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.addInitScript(() => {
    // The file-input path, so the fixture loads without a native picker.
    (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker = undefined;
  });
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open a .nexmap file' }).click();
  await (await chooser).setFiles({
    name: 'two-racks.nexmap',
    mimeType: 'application/json',
    buffer: Buffer.from(twoRackProject),
  });
  await expect.poll(() => inNetwork(page)).toBe(true); // designers load as lazy chunks (#44)
  await expect(page.locator('g[data-id="sw-a"]')).toBeVisible();

  // An unsaved edit before switching.
  await page.getByLabel('Project name').fill('Two racks, edited');
  const before = await snapshot(page);
  expect(before).toMatchObject({ dirty: true, canUndo: true, cables: ['c-ab'] });

  let prompted = false;
  page.on('dialog', (d) => {
    prompted = true;
    void d.dismiss();
  });
  await page.getByRole('button', { name: 'Switch designer' }).click();
  // No chooser, no discard prompt: the same project, now in the Rack designer.
  await expect(page.getByRole('dialog', { name: 'Choose a designer' })).toHaveCount(0);
  await expect(page.getByText('2 racks · row view')).toBeVisible();
  expect(await inNetwork(page)).toBe(false);
  expect(await snapshot(page)).toEqual(before);

  // The physical side of the same design: both racks drawn, the patch cable kept
  // (snapshot above), the unsaved title shown.
  await expect(page.locator('[data-rack-face]').first()).toBeVisible();
  await expect(page.getByText('Rack A').first()).toBeVisible();
  await expect(page.getByText('Rack B').first()).toBeVisible();
  await expect(page.getByLabel('Project name')).toHaveValue('Two racks, edited');

  await page.getByRole('button', { name: 'Switch designer' }).click();
  await expect.poll(() => inNetwork(page)).toBe(true); // designers load as lazy chunks (#44)
  await expect(page.locator('g[data-id="sw-b"]')).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  expect(prompted).toBe(false);
});
