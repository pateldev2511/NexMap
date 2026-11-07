import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * #47: a first-time user goes from the guided example to a verified repair with
 * the keyboard alone — pick it in the gallery, land on its one finding, open the
 * gateway field, type the fix, and watch Validation come back clean. At phone and
 * desktop widths.
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

const isFocused = (el: Locator) => el.evaluate((node) => node === document.activeElement);

/** Tab (or Shift+Tab) until `target` has focus — no pointer involved. */
async function tabTo(page: Page, target: Locator, key: 'Tab' | 'Shift+Tab' = 'Tab') {
  for (let i = 0; i < 60 && !(await isFocused(target)); i++) await page.keyboard.press(key);
  await expect(target).toBeFocused();
}

for (const [width, height] of [
  [390, 844],
  [1280, 800],
] as const) {
  test(`the guided example leads to a verified repair, keyboard only, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await tabTo(page, page.getByRole('button', { name: /Network Designer/ }));
    await page.keyboard.press('Enter');

    // The example sits beside Blank, which stays one keypress away.
    const blank = page.getByRole('button', { name: /Blank project/ });
    const example = page.getByRole('button', { name: /Guided example/ });
    await expect(blank).toBeVisible();
    await tabTo(page, example);
    await page.keyboard.press('Enter');

    // The mistake is explained on the canvas (the designer chunk may still be
    // compiling on a cold dev server)…
    await expect(page.getByText('One mistake to fix')).toBeVisible({ timeout: 15_000 });
    // …and the one next step already has focus: the finding, with a count of 1.
    const validationTab = page.getByRole('button', { name: /^Validation/ });
    await expect(validationTab).toHaveText('Validation1');
    const finding = page.getByRole('button', { name: /^Gateway 10\.0\.1\.1 is outside 10\.0\.0\.0\/24/ });
    await expect(finding).toBeVisible();
    await expect(finding).toBeFocused();
    await page.keyboard.press('Enter');

    // The gateway field, focused, marked and selected — typing replaces it.
    const gateway = page.getByRole('textbox', { name: 'Gateway' });
    await expect(gateway).toBeFocused();
    await expect(gateway).toHaveAttribute('aria-invalid', 'true');
    await expect(gateway).toHaveValue('10.0.1.1');
    await page.keyboard.type('10.0.0.1');
    await expect(gateway).toHaveValue('10.0.0.1');
    await expect(gateway).not.toHaveAttribute('aria-invalid');

    // The verdict changes: no count on the tab, and Validation reads clean.
    await expect(validationTab).toHaveText('Validation');
    await tabTo(page, validationTab, 'Shift+Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByText('No validation issues - your design looks clean.')).toBeVisible();
    await expect(finding).toHaveCount(0);
  });
}

test('the guided example is not offered as a Conductor insert', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: /Blank project/ }).click();
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('Insert:');
  await expect(page.getByText('Insert: Small office')).toBeVisible();
  await expect(page.getByText(/Insert: Guided example/)).toHaveCount(0);
});
