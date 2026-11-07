import { test, expect, type Page } from '@playwright/test';
import type { NexWindow } from './support';

/**
 * Clipboard and shortcuts against the REAL clipboard and keyboard (no synthetic
 * paste events): the browser must deliver ⌘V's payload to the app.
 *   #51 cut + paste is a move — links come back
 *   #52 ⌘V reaches an external CSV, even with devices on the canvas clipboard
 *   #35 presentation ignores paste and editing shortcuts
 *   #56 New project is Alt/Option+N
 */

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

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

interface Counts {
  devices: number;
  links: number;
}

const counts = (page: Page) =>
  page.evaluate((): Counts => {
    const s = (window as unknown as NexWindow & {
      __nexmap: { getState(): { linksAll(): unknown[] } };
    }).__nexmap.getState();
    return { devices: s.devicesAll().length, links: s.linksAll().length };
  });

const deviceNames = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __nexmap: { getState(): { devicesAll(): { name: string }[] } } }).__nexmap
      .getState()
      .devicesAll()
      .map((d) => d.name),
  );

/** Put text on the system clipboard, as if copied in another app. */
const copyExternally = (page: Page, text: string) =>
  page.evaluate((t) => navigator.clipboard.writeText(t), text);

/** Select one device (through the store: the canvas chrome may cover a node). */
const selectOneDevice = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as NexWindow).__nexmap.getState();
    s.select([s.devicesAll()[2]!.id]);
  });

async function openTemplate(page: Page, name: RegExp) {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name }).click();
}

async function openBranchOffice(page: Page) {
  await openTemplate(page, /Branch office/);
  await expect(page.locator('g[data-id]').first()).toBeVisible();
}

const CSV = 'name,type\nClipTest,switch';

test('cut + paste of a cabled site keeps its links (#51)', async ({ page }) => {
  await openBranchOffice(page);
  expect(await counts(page)).toEqual({ devices: 10, links: 9 });

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+x');
  await expect.poll(() => counts(page)).toEqual({ devices: 0, links: 0 });

  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => counts(page)).toEqual({ devices: 10, links: 9 });
  await expect(page.locator('g[data-id][role="button"]')).toHaveCount(10);

  // Undo the paste, then the cut: the same topology both ways.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => counts(page)).toEqual({ devices: 0, links: 0 });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => counts(page)).toEqual({ devices: 10, links: 9 });
});

test('⌘V imports an external CSV from the real clipboard (#52)', async ({ page }) => {
  await openTemplate(page, /Blank project/);
  await copyExternally(page, CSV);
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => deviceNames(page)).toEqual(['ClipTest']);
});

test('copy a device, copy CSV elsewhere, paste → the CSV wins (#52)', async ({ page }) => {
  await openBranchOffice(page);
  await selectOneDevice(page);
  await page.keyboard.press('ControlOrMeta+c');
  await copyExternally(page, CSV);
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => deviceNames(page)).toContain('ClipTest');
  expect((await counts(page)).devices).toBe(11); // the CSV row, not a device clone
});

test('copy a device, paste → an internal paste, the clipboard says so (#52)', async ({ page }) => {
  await openBranchOffice(page);
  await selectOneDevice(page);
  await page.keyboard.press('ControlOrMeta+c');
  // The system clipboard now holds NexMap's marker, not stale text.
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('NexMap selection');
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(async () => (await counts(page)).devices).toBe(11);
});

test('pasting into a text field stays a native text paste (#52)', async ({ page }) => {
  await openBranchOffice(page);
  await copyExternally(page, 'Renamed,site');
  const title = page.getByLabel('Project name');
  await title.fill('');
  await title.press('ControlOrMeta+v');
  await expect(title).toHaveValue('Renamed,site');
  expect((await counts(page)).devices).toBe(10);
});

test('presentation ignores paste and editing keys; zoom and exit still work (#35)', async ({
  page,
}) => {
  await openBranchOffice(page);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Presentation' }).click();
  const exit = page.getByRole('button', { name: /Exit presentation/ });
  await expect(exit).toBeVisible();

  await copyExternally(page, 'name,type\nAuditPasted,router');
  await page.keyboard.press('ControlOrMeta+v');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+d');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
  expect(await counts(page)).toEqual({ devices: 10, links: 9 });

  // Zoom still zooms.
  const tf = () => page.locator('svg g[transform]').first().getAttribute('transform');
  const before = await tf();
  await page.keyboard.press('ControlOrMeta+=');
  await expect.poll(tf).not.toBe(before);

  // Esc exits; the editor pastes again, as one undoable edit.
  await page.keyboard.press('Escape');
  await expect(exit).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => deviceNames(page)).toContain('AuditPasted');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => counts(page)).toEqual({ devices: 10, links: 9 });
});

test('Alt/Option+N starts a new project after the unsaved-work confirm (#56)', async ({
  page,
}) => {
  await openBranchOffice(page);
  // Make an edit so there is unsaved work to confirm away.
  await selectOneDevice(page);
  await page.keyboard.press('ArrowRight');

  const asked = new Promise<string>((resolve) => {
    page.once('dialog', (d) => {
      resolve(d.message());
      void d.accept();
    });
  });
  await page.keyboard.press('Alt+n');
  expect(await asked).toMatch(/Discard unsaved changes/);
  await expect.poll(() => counts(page)).toEqual({ devices: 0, links: 0 });
});
