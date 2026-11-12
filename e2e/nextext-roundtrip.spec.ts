import { test, expect, type Page } from '@playwright/test';

/**
 * NexText Apply is a lossless sync, not a rebuild (#85). Opening NexText on a project
 * with a populated rack and applying it unchanged used to empty the rack, drop every
 * interface and merge same-named devices. Now an unedited Apply is switched off, an
 * edit touches only what was edited, and a removal names exactly what goes with it.
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

type RackSnap = { devices: string[]; mounted: number; interfaces: number; racks: number; canUndo: boolean };
type Dev = { id: string; name: string; location?: string; rackId?: string; ru?: number; interfaces?: unknown[] };
const store = (page: Page) =>
  page.evaluate((): RackSnap => {
    const st = (
      window as unknown as {
        __nexmap: { getState(): { devicesAll(): Dev[]; racksAll(): unknown[]; canUndo: boolean } };
      }
    ).__nexmap.getState();
    const devices = st.devicesAll();
    return {
      devices: devices.map((d) => d.id).sort(),
      mounted: devices.filter((d) => d.rackId != null && d.ru != null).length,
      interfaces: devices.reduce((n, d) => n + (d.interfaces?.length ?? 0), 0),
      racks: st.racksAll().length,
      canUndo: st.canUndo,
    };
  });
const device = (page: Page, name: string) =>
  page.evaluate(
    (n): Dev | undefined =>
      (window as unknown as { __nexmap: { getState(): { devicesAll(): Dev[] } } }).__nexmap
        .getState()
        .devicesAll()
        .find((d) => d.name === n),
    name,
  );

/** Rack designer → Enterprise compute (42U) → the same project in the Network designer → NexText. */
async function openNexTextOnRackProject(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Rack designer/i }).first().click();
  await page.getByRole('button', { name: /Enterprise compute \(42U\)/ }).click();
  await expect(page.locator('[data-rack-face]').first()).toBeVisible();
  const before = await store(page);
  expect(before.racks).toBe(1);
  expect(before.mounted).toBeGreaterThan(5);
  expect(before.interfaces).toBeGreaterThan(20);

  await page.getByRole('button', { name: 'Switch designer' }).click();
  await expect(page.getByPlaceholder('Search components')).toBeVisible();
  await page.getByRole('button', { name: /NexText/ }).click();
  await expect(page.getByLabel('NexText source')).toBeVisible();
  return before;
}

const status = (page: Page) => page.getByTestId('nextext-status');
const applyBtn = (page: Page) => page.getByRole('button', { name: 'Apply', exact: true });

test('unedited NexText cannot be applied; editing one line keeps the rack populated', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  const before = await openNexTextOnRackProject(page);
  const editor = page.getByLabel('NexText source');

  // The generated text already matches the diagram: nothing to apply.
  await expect(status(page)).toHaveText('No changes');
  await expect(applyBtn(page)).toBeDisabled();
  expect(await store(page)).toEqual(before);

  // Edit one line.
  const text = await editor.inputValue();
  const line = text.split('\n').find((l) => /\btor-01\b/.test(l))!;
  expect(line).toBeTruthy();
  await editor.fill(text.replace(line, `${line} location="Row A #1"`));
  await expect(status(page)).toHaveText('1 updated');
  await expect(applyBtn(page)).toBeEnabled();
  await applyBtn(page).click();
  await expect(status(page)).toHaveText('Applied.');
  await expect(applyBtn(page)).toBeDisabled();
  expect(dialogs).toEqual([]); // nothing removed, so nothing to confirm

  // Same devices, still mounted, ports intact — and only the edit landed.
  const after = await store(page);
  expect(after).toEqual({ ...before, canUndo: true });
  const tor = await device(page, 'tor-01');
  expect(tor?.location).toBe('Row A #1');
  expect(tor?.rackId).toBeTruthy();

  // The rack still draws its gear.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Switch designer' }).click();
  await expect(page.locator('[data-rack-face]').first()).toBeVisible();
  expect((await store(page)).mounted).toBe(before.mounted);
});

test('deleting a line asks first and names what the device takes with it', async ({ page }) => {
  let answer: 'dismiss' | 'accept' = 'dismiss';
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void (answer === 'accept' ? d.accept() : d.dismiss());
  });
  const before = await openNexTextOnRackProject(page);
  const editor = page.getByLabel('NexText source');
  const tor = (await device(page, 'tor-01'))!;

  const text = await editor.inputValue();
  await editor.fill(
    text
      .split('\n')
      .filter((l) => !/\btor-01\b/.test(l))
      .join('\n'),
  );
  await expect(status(page)).toHaveText('1 removed');

  // Cancel: nothing happens.
  await applyBtn(page).click();
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]).toContain(`Removes tor-01 — ${tor.interfaces!.length} interfaces, rack position Compute U${tor.ru}`);
  expect(await store(page)).toEqual(before);

  // Accept: only that device goes, and it is one undo step.
  answer = 'accept';
  await applyBtn(page).click();
  await expect(status(page)).toHaveText('Applied.');
  const after = await store(page);
  expect(after.devices).toEqual(before.devices.filter((id) => id !== tor.id));
  expect(after.mounted).toBe(before.mounted - 1);

  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await store(page)).devices).toEqual(before.devices);
  expect((await store(page)).interfaces).toBe(before.interfaces);
});
