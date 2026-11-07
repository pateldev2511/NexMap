import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * PDF export end to end: the jsPDF writer only runs in a browser (it rasterizes the
 * diagram onto a canvas), so this is the check that a jsPDF upgrade still produces
 * a well-formed document.
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

test('exporting a diagram as PDF downloads a well-formed document with the diagram', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: /Branch office/ }).click();
  await expect(page.locator('g[data-id][role="button"]').first()).toBeVisible();

  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export', exact: true }).last().click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const pdf = readFileSync((await download.path())!).toString('latin1');
  expect(pdf.startsWith('%PDF-')).toBe(true);
  expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  // At least one page, carrying the rasterized diagram as an image.
  expect((pdf.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(1);
  expect(pdf).toMatch(/\/Subtype \/Image/);
});
