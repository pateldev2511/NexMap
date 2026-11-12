import { test, expect, type Page } from '@playwright/test';

/**
 * Rack designer responsive layout (#89): at every width the inspector and its
 * "+ Connect ports…" control must be reachable; below 900px the designer shows
 * one panel at a time behind a bottom tab bar.
 */

const WIDTHS: { width: number; height: number }[] = [
  { width: 390, height: 844 },
  { width: 675, height: 800 },
  { width: 800, height: 768 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

async function openRack(page: Page) {
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
}

for (const { width, height } of WIDTHS) {
  test(`rack designer inspector is reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openRack(page);
    const narrow = width < 900;
    const tabs = page.getByRole('tablist', { name: /Rack designer panels/i });

    if (narrow) {
      await expect(tabs).toBeVisible();
      const box = (await tabs.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
      for (const t of await tabs.getByRole('tab').all()) {
        expect((await t.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    } else {
      await expect(tabs).toBeHidden();
    }

    // Select a device (left ear, not a jack).
    const dev = page.locator('[data-testid="rack-canvas"] g[role="button"]').first();
    await dev.scrollIntoViewIfNeeded();
    const b = (await dev.boundingBox())!;
    await page.mouse.click(b.x + 8, b.y + b.height / 2);

    if (narrow) {
      // Selection does not auto-switch; the Inspect tab carries the count.
      await expect(tabs.getByRole('tab', { name: /Inspect, \d+ selected/ })).toBeVisible();
      await tabs.getByRole('tab', { name: /Inspect/ }).click();
      await expect(page.locator('#rack-pane-inspect')).toBeFocused();
    }
    await expect(page.getByRole('heading', { name: /^Selected device$/ })).toBeVisible();

    const connect = page.getByRole('button', { name: '+ Connect ports…' });
    await connect.scrollIntoViewIfNeeded();
    await expect(connect).toBeVisible();
    const cb = (await connect.boundingBox())!;
    expect(cb.x).toBeGreaterThanOrEqual(0);
    expect(cb.x + cb.width).toBeLessThanOrEqual(width + 0.5);
    expect(cb.y).toBeGreaterThanOrEqual(0);
    expect(cb.y + cb.height).toBeLessThanOrEqual(height + 0.5);

    // Nothing inside the inspector pokes out horizontally past the viewport or its own panel.
    const clipped = await page.evaluate(() => {
      const side = document.querySelector('[class*="side"][data-demote="panel"]') as HTMLElement;
      const sr = side.getBoundingClientRect();
      const out: string[] = [];
      side.querySelectorAll<HTMLElement>('button, input, select, h3').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0) return;
        if (r.right > Math.min(sr.right, window.innerWidth) + 1 || r.left < sr.left - 1) {
          out.push(`${el.tagName} ${el.textContent?.slice(0, 30)}`);
        }
      });
      return out;
    });
    expect(clipped).toEqual([]);

    await connect.click();
    const dialog = page.getByRole('dialog', { name: 'Connect ports' });
    await expect(dialog).toBeVisible();
    const db = (await dialog.boundingBox())!;
    expect(db.x).toBeGreaterThanOrEqual(0);
    expect(db.x + db.width).toBeLessThanOrEqual(width + 0.5);
    expect(db.y + db.height).toBeLessThanOrEqual(height + 0.5);
  });
}

test('narrow: library arms a preset and returns to the rack; Escape leaves the inspector', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRack(page);
  const tabs = page.getByRole('tablist', { name: /Rack designer panels/i });
  await tabs.getByRole('tab', { name: 'Library' }).click();
  await expect(page.getByLabel('Search device library')).toBeVisible();
  await expect(page.getByTestId('rack-canvas')).toBeHidden();
  await page.locator('#rack-pane-library button[aria-pressed]').first().click();
  await expect(tabs.getByRole('tab', { name: 'Rack' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('rack-canvas')).toBeVisible();

  await page.keyboard.press('Escape'); // disarm
  await tabs.getByRole('tab', { name: /Inspect/ }).click();
  await page.keyboard.press('Escape');
  await expect(tabs.getByRole('tab', { name: 'Rack' })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab', { name: 'Rack' })).toBeFocused();
});
