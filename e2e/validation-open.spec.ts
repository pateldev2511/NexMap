import { test, expect, type Page } from '@playwright/test';

/**
 * #45: a validation finding opens the field that needs repair. Keyboard only —
 * Tab reaches the finding, Enter opens the IP Plan on its CIDR field (text
 * selected), typing the fix replaces it, and the finding clears.
 */

interface PlanStore {
  addSubnet(cidr: string): string;
}

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

async function openBlankNetwork(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: /Blank project/ }).click();
}

test('an invalid subnet CIDR finding opens its field, keyboard only, and clears once fixed', async ({
  page,
}) => {
  await openBlankNetwork(page);
  await page.evaluate(() => {
    const st = (window as unknown as { __nexmap: { getState(): PlanStore } }).__nexmap.getState();
    st.addSubnet('10.0.0.0/33');
  });

  // Open Validation from the keyboard.
  const validationTab = page.getByRole('button', { name: /^Validation/ });
  await validationTab.focus();
  await page.keyboard.press('Enter');
  const finding = page.getByRole('button', { name: '"10.0.0.0/33" is not a valid subnet CIDR.' });
  await expect(finding).toBeVisible();

  // Tab until the finding has focus — it must be reachable without a pointer.
  for (let i = 0; i < 20 && !(await finding.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(finding).toBeFocused();
  await page.keyboard.press('Enter');

  // One action: the IP Plan's CIDR field, focused and marked.
  const cidr = page.getByRole('textbox', { name: 'Subnet CIDR' });
  await expect(cidr).toBeFocused();
  await expect(cidr).toHaveAttribute('aria-invalid', 'true');

  // Its text is selected, so typing replaces it; the mark clears with the finding.
  await page.keyboard.type('10.0.0.0/24');
  await expect(cidr).toHaveValue('10.0.0.0/24');
  await expect(cidr).not.toHaveAttribute('aria-invalid');

  await validationTab.focus();
  await page.keyboard.press('Enter');
  await expect(finding).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Subnet 10.0.0.0/24 has no gateway.' })).toBeVisible();
});
