import { test, expect, type Page } from '@playwright/test';

/**
 * #46: the Flow stress-test names the destination behind its verdict, and you can
 * pick one. ISP → router → switch → client: pulling the ISP holds while any exit
 * counts (the router survives), but not when the destination is the ISP itself.
 */

interface FlowStore {
  addDeviceAt(type: string, x: number, y: number): string;
  updateDevice(id: string, before: unknown, after: unknown): void;
  connect(a: string, b: string): string | null;
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

async function chain(page: Page): Promise<string[]> {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: /Blank project/ }).click();
  return page.evaluate(() => {
    const st = (window as unknown as { __nexmap: { getState(): FlowStore } }).__nexmap.getState();
    const spec: [string, string][] = [
      ['isp', 'ISP'],
      ['router', 'R1'],
      ['switch', 'SW1'],
      ['end-user', 'PC'],
    ];
    const ids = spec.map(([type, name], i) => {
      const id = st.addDeviceAt(type, 160 + i * 180, 220);
      st.updateDevice(id, {}, { name });
      return id;
    });
    for (let i = 0; i + 1 < ids.length; i++) st.connect(ids[i]!, ids[i + 1]!);
    return ids;
  });
}

test('Flow names its destination and answers for the one you pick', async ({ page }) => {
  const [ispId] = await chain(page);
  await page.getByRole('button', { name: 'Stress-test (Flow)' }).click();

  const destination = page.getByLabel('Destination to measure reachability to');
  await expect(destination.locator('option:checked')).toHaveText('any exit: ISP, R1');

  // Pull the ISP with a real click on it.
  const box = (await page.locator(`[data-flow-hit="${ispId}"]`).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const verdict = page.getByRole('status').filter({ hasText: /Holding|down|isolated/ });
  await expect(verdict).toHaveText('Holding — nothing lost its path to the network.1 failed · 0 newly unreachable');

  // Ask about the ISP itself: the same failure now cuts everything off.
  await destination.selectOption({ label: 'ISP' });
  await expect(verdict).toHaveText('ISP is down — 3 devices lost their path to it.1 failed · 3 newly unreachable');

  // Ask about the router: holding again. Then back to any exit.
  await destination.selectOption({ label: 'R1' });
  await expect(verdict).toHaveText('Holding — nothing lost its path to R1.1 failed · 0 newly unreachable');
  await destination.selectOption({ index: 0 });
  await expect(verdict).toHaveText(/^Holding — nothing lost its path to the network\./);
});
