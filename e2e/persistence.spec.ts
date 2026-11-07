import { test, expect, type Page } from '@playwright/test';

/**
 * Files, drafts and the document lifecycle, against real IndexedDB, real reloads
 * and real Web Locks (#17 #18 #19 #20 #23 #24 #37 #53 #54). The File System
 * Access pickers are stubbed in-page with an in-memory "disk" so writes can be
 * inspected byte-for-byte; `fallback` hides them to exercise the download /
 * file-input path the way Firefox and Safari see it.
 */

const NOW = '2026-01-01T00:00:00.000Z';

// Wide enough that the topbar's file buttons aren't overlapped by the title field.
test.use({ viewport: { width: 1680, height: 900 } });

/** A minimal, valid current-schema .nexmap. */
function nexmap(name: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 7,
    appVersion: '0.6.2',
    project: { id: `p-${name}`, name, createdAt: NOW, updatedAt: NOW, description: '', units: 'px' },
    layers: [{ id: 'L', name: 'Default', visible: true, locked: false, order: 0 }],
    devices: [
      { id: 'd1', kind: 'device', type: 'router', name: 'R1', x: 200, y: 200, width: 56, height: 40, layerId: 'L', interfaces: [] },
    ],
    links: [],
    objects: [],
    vlans: [],
    subnets: [],
    racks: [],
    rackCables: [],
    views: [],
    invariants: [],
    customRules: [],
    interfaces: [],
    assets: [],
    customFields: [],
    ...extra,
  });
}

interface FakeFs {
  /** Text the open picker returns (as `name`), or null for no native open picker. */
  open?: { name: string; text: string } | null;
  /** Whether a native save picker exists. */
  save?: boolean;
}

async function fakeFs(page: Page, opts: FakeFs) {
  await page.addInitScript((o: FakeFs) => {
    const w = window as unknown as Record<string, unknown> & {
      __disk: Record<string, string>;
      __pickerCalls: number;
    };
    w.__disk = {};
    w.__pickerCalls = 0;
    const handle = (name: string) => ({
      name,
      async createWritable() {
        let buf = '';
        return {
          async write(d: string) {
            buf = d;
          },
          async close() {
            w.__disk[name] = buf;
          },
        };
      },
      async getFile() {
        return new File([w.__disk[name] ?? ''], name);
      },
    });
    let n = 0;
    w.showSaveFilePicker = o.save
      ? async () => {
          w.__pickerCalls++;
          n++;
          return handle(`file${n}.nexmap`);
        }
      : undefined;
    if (o.open) {
      const file = o.open;
      w.__disk[file.name] = file.text;
      w.showOpenFilePicker = async () => [handle(file.name)];
    } else {
      w.showOpenFilePicker = undefined;
    }
  }, opts);
}

const disk = (page: Page) =>
  page.evaluate(() => (window as unknown as { __disk: Record<string, string> }).__disk);
const pickerCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pickerCalls: number }).__pickerCalls);
const title = (page: Page) => page.getByLabel('Project name');
const unsaved = (page: Page) => page.getByRole('alertdialog', { name: 'Unsaved changes' });
const autosaved = (page: Page) => expect(page.getByText(/^Autosaved /)).toBeVisible();

async function branchOffice(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: /Branch office/ }).click();
  await expect(title(page)).toHaveValue('Branch office');
}

async function clickSave(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
}

test.describe('file identity (#17, #54)', () => {
  test('Save A → New → Save does not overwrite A', async ({ page }) => {
    await fakeFs(page, { save: true, open: null });
    await branchOffice(page);
    await clickSave(page);
    await expect(page.getByText('file1.nexmap')).toBeVisible();
    const a = (await disk(page))['file1.nexmap']!;
    expect(a).toContain('"name": "Branch office"');

    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(title(page)).toHaveValue('Untitled NexMap Project');
    await expect(page.getByText('Not saved to a file yet')).toBeVisible();
    await clickSave(page);
    await expect(page.getByText('file2.nexmap')).toBeVisible();

    expect(await pickerCalls(page)).toBe(2);
    const files = await disk(page);
    expect(files['file1.nexmap']).toBe(a); // A byte-for-byte
    expect(files['file2.nexmap']).toContain('"name": "Untitled NexMap Project"');
  });

  test('switching designer keeps the project: Save still writes back to A', async ({ page }) => {
    await fakeFs(page, { save: true, open: null });
    await branchOffice(page);
    const ids = await page.evaluate(() =>
      (window as unknown as { __nexmap: { getState(): { devicesAll(): { id: string }[] } } }).__nexmap
        .getState()
        .devicesAll()
        .map((d) => d.id),
    );
    await clickSave(page);
    await title(page).fill('Branch office, edited');

    await page.getByRole('button', { name: 'Switch designer' }).click();
    await expect(page.getByRole('button', { name: /New rack/ }).first()).toBeVisible();
    // Same project, same unsaved edit, same file.
    await expect(title(page)).toHaveValue('Branch office, edited');
    await expect(page.getByText('file1.nexmap')).toBeVisible();
    await clickSave(page);
    await expect.poll(async () => (await disk(page))['file1.nexmap']).toContain('Branch office, edited');
    expect(await pickerCalls(page)).toBe(1);

    // …and back: the topology and its ids are intact, undo still works.
    await page.getByRole('button', { name: 'Switch designer' }).click();
    await expect(page.locator('g[data-id]').first()).toBeVisible();
    const after = await page.evaluate(() =>
      (window as unknown as { __nexmap: { getState(): { devicesAll(): { id: string }[]; canUndo: boolean } } }).__nexmap.getState(),
    );
    expect(after.canUndo).toBe(true);
    const idsAfter = await page.evaluate(() =>
      (window as unknown as { __nexmap: { getState(): { devicesAll(): { id: string }[] } } }).__nexmap
        .getState()
        .devicesAll()
        .map((d) => d.id),
    );
    expect(idsAfter).toEqual(ids);
  });
});

test.describe('drafts (#20, #53)', () => {
  test('reloading right after an edit keeps the edit', async ({ page }) => {
    await branchOffice(page);
    await autosaved(page);
    await title(page).fill('Last edit');
    await page.reload(); // inside the 800 ms autosave debounce
    await expect(page.getByText('Recover your work?')).toBeVisible();
    await page.getByRole('button', { name: 'Recover', exact: true }).click();
    await expect(title(page)).toHaveValue('Last edit');
  });

  test('an annotation-only network draft is offered for recovery', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Network Designer/ }).click();
    await page.getByRole('button', { name: /Blank project/ }).click();
    await page.evaluate(() =>
      (window as unknown as { __nexmap: { getState(): { addText(x: number, y: number): string } } }).__nexmap
        .getState()
        .addText(240, 200),
    );
    await autosaved(page);
    await page.reload();
    await expect(page.getByText('Recover your work?')).toBeVisible();
    await expect(page.getByText(/1 note · saved/)).toBeVisible();
    await page.getByRole('button', { name: 'Recover', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __nexmap: { getState(): { objectsAll(): unknown[] } } }).__nexmap
              .getState()
              .objectsAll().length,
        ),
      )
      .toBe(1);
  });

  test('a rack-only draft is offered for recovery', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Rack Designer/ }).click();
    await page.getByRole('button', { name: /New rack/ }).first().click();
    await autosaved(page);
    await page.reload();
    await expect(page.getByText('Recover your work?')).toBeVisible();
    await expect(page.getByText(/1 rack · saved/)).toBeVisible();
    await page.getByRole('button', { name: 'Recover', exact: true }).click();
    await expect(page.getByText('No racks yet')).toHaveCount(0);
  });
});

test.describe('open while dirty (#19)', () => {
  test('native picker: Cancel keeps the project, Discard opens the file (also via ⌘O)', async ({ page }) => {
    await fakeFs(page, { save: true, open: { name: 'other.nexmap', text: nexmap('Replacement') } });
    await branchOffice(page);
    await title(page).fill('Mine');

    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(unsaved(page)).toBeVisible();
    await unsaved(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(unsaved(page)).toHaveCount(0);
    await expect(title(page)).toHaveValue('Mine');

    await title(page).blur();
    await page.keyboard.press('ControlOrMeta+o');
    await expect(unsaved(page)).toBeVisible();
    await unsaved(page).getByRole('button', { name: 'Discard changes' }).click();
    await expect(title(page)).toHaveValue('Replacement');
    await expect(page.getByText('other.nexmap')).toBeVisible();
  });

  test('file-input fallback: Save first, then the file opens; an invalid file changes nothing', async ({ page }) => {
    await fakeFs(page, { save: true, open: null });
    await branchOffice(page);
    await title(page).fill('Mine');

    // An invalid file is refused without a prompt.
    let chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await (await chooser).setFiles({
      name: 'bad.nexmap',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ schemaVersion: 7, project: {}, devices: [], links: [] })),
    });
    await expect(page.getByRole('alert')).toContainText('project.id');
    await expect(unsaved(page)).toHaveCount(0);
    await expect(title(page)).toHaveValue('Mine');

    chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await (await chooser).setFiles({
      name: 'other.nexmap',
      mimeType: 'application/json',
      buffer: Buffer.from(nexmap('Replacement')),
    });
    await expect(unsaved(page)).toBeVisible();
    await unsaved(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(title(page)).toHaveValue('Replacement');
    expect((await disk(page))['file1.nexmap']).toContain('"name": "Mine"');
  });
});

test.describe('launch-screen open (#23)', () => {
  test('native picker lands in the editor with the file, not the template gallery', async ({ page }) => {
    await fakeFs(page, { save: true, open: { name: 'site.nexmap', text: nexmap('Loaded file') } });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a .nexmap file' }).click();
    await expect(title(page)).toHaveValue('Loaded file');
    await expect(page.getByRole('dialog', { name: 'Choose a designer' })).toHaveCount(0);
    await expect(page.getByText('Home & small office')).toHaveCount(0);
    await expect(page.getByText('site.nexmap')).toBeVisible();
  });

  test('fallback input works from the quick launcher; a rack-only file opens in the Rack designer', async ({ page }) => {
    await fakeFs(page, { save: false, open: null });
    await page.goto('/');
    await page.getByRole('button', { name: /Jump in/ }).click();
    await page.getByLabel('Quick launch search').fill('open');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('option', { name: /Open a \.nexmap file/ }).click();
    await (await chooser).setFiles({
      name: 'racks.nexmap',
      mimeType: 'application/json',
      buffer: Buffer.from(nexmap('Rack room', { devices: [], racks: [{ id: 'r1', name: 'MDF', ruHeight: 42 }] })),
    });
    await expect(title(page)).toHaveValue('Rack room');
    await expect(page.getByText('No racks yet')).toHaveCount(0);
    await expect(page.getByPlaceholder('Search components')).toHaveCount(0); // not Network
  });

  test('malformed and future-version files keep the launch screen with a reason', async ({ page }) => {
    await fakeFs(page, { save: false, open: null });
    await page.goto('/');
    for (const [buffer, reason] of [
      ['{ not json', /not valid JSON/],
      [nexmap('Future', { schemaVersion: 99 }), /schema v99/],
    ] as const) {
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Open a .nexmap file' }).click();
      await (await chooser).setFiles({ name: 'x.nexmap', mimeType: 'application/json', buffer: Buffer.from(buffer) });
      await expect(page.getByRole('alert')).toContainText(reason);
      await expect(page.getByRole('dialog', { name: 'Choose a designer' })).toBeVisible();
    }
  });
});

test('a second tab is really read-only, and takes over with the latest work (#24)', async ({ context }) => {
  const one = await context.newPage();
  await branchOffice(one);
  await autosaved(one);

  const two = await context.newPage();
  await two.goto('/');
  await expect(two.getByText('Recover your work?')).toBeVisible();
  await expect(two.getByRole('button', { name: /Discard/ })).toBeDisabled();
  await two.getByRole('button', { name: 'Recover', exact: true }).click();
  await expect(two.getByText(/view-only/)).toBeVisible();
  await expect(two.getByText('Read-only')).toBeVisible();

  // Title, keyboard and toolbar edits are all refused.
  const before = await two.evaluate(() => {
    const st = (window as unknown as { __nexmap: { getState(): { devicesAll(): unknown[]; projectName: string } } }).__nexmap.getState();
    return { n: st.devicesAll().length, name: st.projectName };
  });
  await expect(title(two)).toHaveAttribute('readonly', '');
  await title(two).press('a').catch(() => {});
  await two.locator('body').press('ControlOrMeta+a');
  await two.locator('body').press('Delete');
  await two.locator('body').press('ControlOrMeta+z');
  await expect(two.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(two.getByRole('button', { name: 'New', exact: true })).toBeDisabled();
  const after = await two.evaluate(() => {
    const st = (window as unknown as { __nexmap: { getState(): { devicesAll(): unknown[]; projectName: string; dirty: boolean } } }).__nexmap.getState();
    return { n: st.devicesAll().length, name: st.projectName, dirty: st.dirty };
  });
  expect(after).toEqual({ ...before, dirty: false });

  // The writer keeps working after tab two opened, then closes.
  await title(one).fill('Edited in tab one');
  await expect(one.getByText('Saving…')).toBeVisible();
  await autosaved(one);
  await one.close();

  await expect(two.getByText(/view-only/)).toHaveCount(0);
  await expect(two.getByText('Read-only')).toHaveCount(0);
  await expect(title(two)).toHaveValue('Edited in tab one');
  await expect(title(two)).not.toHaveAttribute('readonly', '');
});

test('a throwing localStorage still mounts; open, edit and download a copy (#37)', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  await fakeFs(page, { save: false, open: null });
  await page.goto('/');
  await expect(page.getByRole('dialog', { name: 'Choose a designer' })).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open a .nexmap file' }).click();
  await (await chooser).setFiles({ name: 'site.nexmap', mimeType: 'application/json', buffer: Buffer.from(nexmap('Blocked storage')) });
  await expect(title(page)).toHaveValue('Blocked storage');
  await expect(page.getByText(/blocking site storage/)).toBeVisible();

  await title(page).fill('Edited without storage');
  const download = page.waitForEvent('download');
  await clickSave(page);
  expect((await download).suggestedFilename()).toBe('Edited without storage.nexmap');
});
