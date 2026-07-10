import { test, expect, type Page } from '@playwright/test';

/**
 * Export parity harness (W1b skeleton, per docs/designs/rack-realism-callouts.md).
 *
 * The arrows bug (canvas showed link arrows, exports didn't) existed since links
 * shipped because NOTHING compared the canvas against the exported SVG. This
 * harness captures the REAL export string in-browser (the ExportDialog's live
 * preview is a data-URI of buildSvg's output) and asserts canvas-visible
 * features survive into the export. Later milestones EXTEND the fixture and
 * assertions (callouts, iso leaders, hide-faceplate, title block); this
 * skeleton pins the arrow fix.
 */

async function openBranchOffice(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: /Branch office/ }).click();
  await expect(page.locator('g[data-id]').first()).toBeVisible();
}

/** Open Export, read the live-preview data URI, decode to the raw export SVG string. */
async function exportedSvg(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const img = page.getByRole('img', { name: 'Export preview' });
  await expect(img).toBeVisible();
  const src = (await img.getAttribute('src'))!;
  expect(src.startsWith('data:image/svg+xml')).toBe(true);
  return decodeURIComponent(src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
}

test('flat export carries the link arrows shown on the canvas', async ({ page }) => {
  await openBranchOffice(page);
  // The canvas draws links with the #nexmap-arrow marker; the export must too.
  // (SVG stroke-only paths report "hidden" to Playwright's visibility heuristic,
  // so assert on presence, not visibility.)
  await expect(page.locator('path[marker-end="url(#nexmap-arrow)"]').first()).toBeAttached();

  const svg = await exportedSvg(page);
  expect(svg).toContain('<marker id="nexmap-arrow"');
  expect(svg).toContain('marker-end="url(#nexmap-arrow)"');
  expect(svg).toContain('fill="#6b7785"'); // literal color, no CSS var leaked
});

test('iso export also carries arrows', async ({ page }) => {
  await openBranchOffice(page);
  await page.getByRole('button', { name: 'Toggle isometric view' }).click();
  const svg = await exportedSvg(page);
  expect(svg).toContain('<marker id="nexmap-arrow"');
  expect(svg).toContain('marker-end="url(#nexmap-arrow)"');
});
