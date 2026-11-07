import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import type { NexWindow } from './support';

/**
 * The network Export dialog as a real modal (#36), and the ZIP package checked
 * on the unzipped download rather than the preview alone (#22, #33):
 *  - named modal, focus moves in, Tab stays in, Escape closes, focus goes back,
 *    and editor keys (Delete) can't reach the canvas behind it
 *  - the ZIP is the whole project, and its diagram.svg is the preview's SVG
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

const devices = (page: Page) => page.locator('g[data-id][role="button"]');
/** Select one device through the store (the first one sits under the tool rail). */
const selectOneDevice = (page: Page) =>
  page.evaluate(() => {
    const st = (window as unknown as NexWindow).__nexmap.getState();
    st.select([st.devicesAll()[0]!.id]);
  });
const focusInDialog = (page: Page) =>
  page.evaluate(() => !!document.activeElement?.closest('[role="dialog"][aria-modal="true"]'));

test('Export is a keyboard-owned modal: focus in, Tab trapped, Escape out, focus back', async ({ page }) => {
  await openBranchOffice(page);
  const trigger = page.getByRole('button', { name: 'Export', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(await focusInDialog(page)).toBe(true);

  // Far more Tabs than the dialog has controls: focus never leaves it.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab');
    expect(await focusInDialog(page)).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('editor shortcuts cannot change the project while Export is open', async ({ page }) => {
  await openBranchOffice(page);
  const before = await devices(page).count();
  await selectOneDevice(page); // a selection Delete would remove
  await expect(page.locator('g[data-id][aria-pressed="true"]')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+e');
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'SVG', exact: true }).focus();
  for (const key of ['Delete', 'Backspace', 'ArrowRight', 'ControlOrMeta+d', 'ControlOrMeta+z']) {
    await page.keyboard.press(key);
  }
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(devices(page)).toHaveCount(before);
});

test('Escape closes Settings too (same modal contract)', async ({ page }) => {
  await openBranchOffice(page);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  expect(await focusInDialog(page)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('a ZIP with a selection is still the whole project, rendered as previewed', async ({ page }) => {
  await openBranchOffice(page);
  const total = await devices(page).count();
  await selectOneDevice(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByLabel('Scope').selectOption('selection');

  await dialog.getByRole('button', { name: 'ZIP package' }).click();
  await expect(dialog.getByLabel('Scope')).toHaveCount(0);
  await expect(dialog.getByText(/Packages the whole project, not just the selection/)).toBeVisible();
  await dialog.getByLabel('Projection').selectOption('blueprint');
  await dialog.getByLabel('Include device names').uncheck();

  const src = (await dialog.getByRole('img', { name: 'Export preview' }).getAttribute('src'))!;
  const preview = decodeURIComponent(src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  const files = unzipSync(readFileSync((await download.path())!));
  const svg = strFromU8(files['diagram.svg']!);
  expect(svg).toBe(preview);
  expect(svg).toContain('url(#nexmap-bp-minor)'); // the blueprint sheet, not a white flat render
  expect(files['diagram.png']!.byteLength).toBeGreaterThan(0);
  expect(files['diagram.pdf']!.byteLength).toBeGreaterThan(0);

  const project = JSON.parse(strFromU8(files['project.nexmap']!));
  expect(project.devices).toHaveLength(total);
  const inventoryRows = strFromU8(files['inventory.csv']!).trim().split(/\r?\n/).length - 1;
  expect(inventoryRows).toBe(total);
});
