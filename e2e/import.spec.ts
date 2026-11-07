import { test, expect, type Page } from '@playwright/test';

/**
 * Import dialog integrity (audit #27, #28, #40): files go through the REAL dialog —
 * file input, preview warnings, Import, Undo — not just the parsers. Guards that a
 * malformed file is rejected visibly and can be retried in place, that ambiguous
 * link endpoints are surfaced instead of guessed, and that multi-page draw.io files
 * keep each page's links on that page.
 */

interface ImportTestStore {
  devicesAll(): { id: string; name: string }[];
  linksAll(): { sourceId: string; targetId: string }[];
}
type ImportTestWindow = { __nexmap: { getState(): ImportTestStore } };

// Wide enough that the top bar's Import button isn't under the panel toggles.
test.use({ viewport: { width: 1600, height: 900 } });

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
  await page.getByRole('button', { name: /Blank project/ }).click();
});

const dialog = (page: Page) =>
  page.locator('[class*="dialog"]', {
    has: page.getByRole('heading', { name: 'Import', exact: true }),
  });

async function openImport(page: Page) {
  // With the dialog closed, the top bar's is the only "Import" button. (Not by
  // title: the tooltip layer moves `title` off a button once it's been hovered.)
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}

function file(name: string, body: string, mimeType = 'application/json') {
  return { name, mimeType, buffer: Buffer.from(body) };
}

async function choose(page: Page, f: ReturnType<typeof file>) {
  await dialog(page).locator('input[type="file"]').setInputFiles(f);
}

/** Links in the project as "source->target" device names. */
async function linkNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const st = (window as unknown as ImportTestWindow).__nexmap.getState();
    const name = new Map(st.devicesAll().map((d) => [d.id, d.name]));
    return st.linksAll().map((l) => `${name.get(l.sourceId)}->${name.get(l.targetId)}`);
  });
}

async function deviceCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as ImportTestWindow).__nexmap.getState().devicesAll().length,
  );
}

test('a null-root JSON is rejected visibly, then a corrected mixed file imports in place', async ({
  page,
}) => {
  await openImport(page);
  const d = dialog(page);
  const importBtn = d.getByRole('button', { name: 'Import', exact: true });

  await choose(page, file('topology.json', 'null'));
  await expect(d.getByText('JSON has no "devices" array')).toBeVisible();
  await expect(importBtn).toBeDisabled();
  expect(await deviceCount(page)).toBe(0); // project untouched

  // Retry from the same dialog with a corrected (but still partly bad) file.
  const corrected = JSON.stringify({
    devices: [{ name: 'R1', type: 'router' }, null, { name: 'SW1', type: 'switch' }],
    links: [{ source: 'R1', target: 'SW1' }, null, { source: 'R1', target: 'ghost' }],
  });
  const chooser = page.waitForEvent('filechooser');
  await d.getByRole('button', { name: 'Choose another file' }).click();
  await (await chooser).setFiles(file('topology.json', corrected));

  await expect(d.getByText('Device 2: not a device object — skipped.')).toBeVisible();
  await expect(d.getByText('Link 2: not a link object — skipped.')).toBeVisible();
  await expect(
    d.getByText('1 link(s) referenced unknown devices and were skipped.'),
  ).toBeVisible();
  await importBtn.click();
  await expect(d.getByText(/Imported/)).toBeVisible();
  expect(await linkNames(page)).toEqual(['R1->SW1']);
});

test('a NetBox export with a null row still previews the good rows', async ({ page }) => {
  await openImport(page);
  const d = dialog(page);
  await choose(
    page,
    file('netbox.json', JSON.stringify({ results: [null, { name: 'sw-core-1' }] })),
  );
  await expect(d.getByText('Device 1: not a device object — skipped.')).toBeVisible();
  await d.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(d.getByText(/Imported/)).toBeVisible();
  expect(await deviceCount(page)).toBe(1);
});

test('a link CSV row naming two devices is shown with its matches and skipped', async ({
  page,
}) => {
  await openImport(page);
  const d = dialog(page);
  await choose(
    page,
    file(
      'inventory.csv',
      'name,type,location\ncore,router,HQ\ncore,switch,DR\nedge,switch,HQ',
      'text/csv',
    ),
  );
  await d.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(d.getByText(/Imported/)).toBeVisible();
  await d.getByRole('button', { name: 'Done' }).click();

  await openImport(page);
  await choose(page, file('links.csv', 'source,target\ncore,edge', 'text/csv'));
  await expect(
    d.getByText(
      'Row 1: "core" matches 2 devices: core (Router, HQ); core (Switch, DR) — link skipped. Rename devices so names are unique.',
    ),
  ).toBeVisible();
  await expect(d.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
});

test('a two-page draw.io file keeps each page’s links and undoes in one step', async ({
  page,
}) => {
  const pageXml = (name: string, a: string, b: string) =>
    `<diagram name="${name}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
    `<mxCell id="2" value="${a}" vertex="1" parent="1"/><mxCell id="3" value="${b}" vertex="1" parent="1"/>` +
    `<mxCell id="4" edge="1" source="2" target="3" parent="1"/></root></mxGraphModel></diagram>`;
  const xml = `<mxfile>${pageXml('Site A', 'A1', 'A2')}${pageXml('Site B', 'B1', 'B2')}</mxfile>`;

  await openImport(page);
  const d = dialog(page);
  await choose(page, file('sites.drawio', xml, 'application/xml'));
  await expect(
    d.getByText(
      'Merged 2 draw.io pages (Site A, Site B); links are matched within each page.',
    ),
  ).toBeVisible();
  await d.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(d.getByText(/Imported/)).toBeVisible();
  expect((await linkNames(page)).sort()).toEqual(['A1->A2', 'B1->B2']);

  await d.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => deviceCount(page)).toBe(0);
  expect(await linkNames(page)).toEqual([]);
});
