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

/**
 * #87: Flow is an interaction mode. At every zoom — including fit-to-screen zooms
 * where the editing connect handles used to grow over the click target — and in
 * isometric, a click on a device's centre pulls it; nothing is selected, added or
 * removed; Delete does nothing. (Not covered here: real touch — see touch.spec.ts
 * for the CDP recipe.)
 */
interface FlowModeStore extends FlowStore {
  select(ids: string[]): void;
  setProjection(p: 'flat' | 'iso' | 'blueprint'): void;
  devicesAll(): { id: string }[];
  linksAll(): { id: string }[];
  selection: Set<string>;
  flowMode: boolean;
  flowFailed: string[];
  mode: string;
}

const flowState = (page: Page) =>
  page.evaluate(() => {
    const st = (window as unknown as { __nexmap: { getState(): FlowModeStore } }).__nexmap.getState();
    return {
      devices: st.devicesAll().length,
      links: st.linksAll().length,
      selection: [...st.selection],
      failed: [...st.flowFailed],
      flowMode: st.flowMode,
      mode: st.mode,
    };
  });

/** Select a device and a link straight through the store (as search / a panel would). */
const selectDeviceAndLink = (page: Page, deviceId: string) =>
  page.evaluate((id) => {
    const st = (window as unknown as { __nexmap: { getState(): FlowModeStore } }).__nexmap.getState();
    st.select([id, st.linksAll()[0]!.id]);
  }, deviceId);

const zoomPct = async (page: Page) =>
  Number((await page.locator('text=/^\\d+%$/').first().textContent())!.replace('%', ''));

/** Step the zoom bar until the readout is as close to `target`% as 1.2× steps allow. */
async function zoomTo(page: Page, target: number) {
  const out = page.getByRole('button', { name: 'Zoom out' });
  const inn = page.getByRole('button', { name: 'Zoom in' });
  for (let i = 0; i < 30; i++) {
    const cur = await zoomPct(page);
    if (cur > target * 1.1) await out.click();
    else if (cur < target / 1.1) await inn.click();
    else return;
  }
  throw new Error(`could not reach ~${target}% zoom`);
}

async function centreOf(page: Page, id: string) {
  const box = (await page.locator(`[data-flow-hit="${id}"]`).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const flowVerdict = (page: Page) =>
  page.getByRole('status').filter({ hasText: /Click any device|Holding|down|isolated/ });

/** Hover, then click the centre of `id`; expect the HUD to say it is down. */
async function pullAndCheck(page: Page, id: string, name: string) {
  const before = await flowState(page);
  const c = await centreOf(page, id);
  await page.mouse.move(c.x - 30, c.y - 30);
  await page.mouse.move(c.x, c.y, { steps: 4 }); // hover: this is what raised the connect handles
  await page.mouse.click(c.x, c.y);
  await expect(flowVerdict(page)).toHaveText(new RegExp(`^${name} is down — 3 devices lost their path to it\\.`));
  const after = await flowState(page);
  expect(after.failed).toEqual([id]);
  expect(after.selection).toEqual(before.selection); // the click selected nothing
  expect(after.devices).toBe(before.devices);
  expect(after.links).toBe(before.links);

  // Delete in Flow removes nothing — even with a selection in the store.
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  const kept = await flowState(page);
  expect(kept.devices).toBe(before.devices);
  expect(kept.links).toBe(before.links);
  expect(kept.flowMode).toBe(true);

  // Click again restores it.
  await page.mouse.click(c.x, c.y);
  await expect(flowVerdict(page)).toHaveText(/^Click any device/);
  expect((await flowState(page)).failed).toEqual([]);
}

async function enterFlowOnIsp(page: Page): Promise<string> {
  const [ispId] = await chain(page);
  // A device and a link are selected when Flow starts: entering clears them.
  await selectDeviceAndLink(page, ispId!);
  await expect(page.getByRole('toolbar', { name: 'Selection actions' })).toBeVisible();
  await page.getByRole('button', { name: 'Stress-test (Flow)' }).click();
  await expect(page.getByRole('toolbar', { name: 'Selection actions' })).toHaveCount(0);
  const st = await flowState(page);
  expect(st.selection).toEqual([]);
  expect(st.mode).toBe('select');
  await page.getByLabel('Destination to measure reachability to').selectOption({ label: 'ISP' });
  return ispId!;
}

for (const zoom of [20, 28, 50, 100]) {
  test(`Flow click pulls the device at ~${zoom}% zoom, and edits nothing (#87)`, async ({ page }) => {
    const ispId = await enterFlowOnIsp(page);
    await zoomTo(page, zoom);
    await pullAndCheck(page, ispId, 'ISP');

    // Same again with a device + link selected behind Flow's back (search, a side
    // panel): still no editing chrome over the target, still a clean toggle.
    await selectDeviceAndLink(page, ispId);
    await expect(page.getByRole('toolbar', { name: 'Selection actions' })).toHaveCount(0);
    await pullAndCheck(page, ispId, 'ISP');
  });
}

test('Flow click pulls the device in isometric view (#87)', async ({ page }) => {
  const ispId = await enterFlowOnIsp(page);
  await page.evaluate(() =>
    (window as unknown as { __nexmap: { getState(): FlowModeStore } }).__nexmap.getState().setProjection('iso'),
  );
  await expect(page.locator(`g[data-id="${ispId}"]`)).toBeVisible();
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  await pullAndCheck(page, ispId, 'ISP');
  await zoomTo(page, 28);
  await pullAndCheck(page, ispId, 'ISP');
  await selectDeviceAndLink(page, ispId);
  await pullAndCheck(page, ispId, 'ISP');
});

test('a drag that starts on a device pans in Flow — it neither fails nor moves it (#87)', async ({ page }) => {
  const ispId = await enterFlowOnIsp(page);
  const node = page.locator(`g[data-id="${ispId}"]`);
  const transform = await node.getAttribute('transform');
  const c = await centreOf(page, ispId);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 90, c.y + 60, { steps: 6 });
  await page.mouse.up();
  const moved = await centreOf(page, ispId);
  expect(Math.round(moved.x - c.x)).toBe(90); // the canvas panned with the pointer
  expect(Math.round(moved.y - c.y)).toBe(60);
  expect(await node.getAttribute('transform')).toBe(transform); // the device's model position did not change
  expect((await flowState(page)).failed).toEqual([]);
  await expect(flowVerdict(page)).toHaveText(/^Click any device/);
});

test('keyboard: Enter on a focused device pulls it in Flow; Escape leaves (#87)', async ({ page }) => {
  const ispId = await enterFlowOnIsp(page);
  const node = page.locator(`g[data-id="${ispId}"]`);
  await node.focus();
  await expect(node).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Enter');
  await expect(flowVerdict(page)).toHaveText(/^ISP is down — 3 devices lost their path to it\./);
  await expect(node).toHaveAttribute('aria-pressed', 'true');
  let st = await flowState(page);
  expect(st.selection).toEqual([]);
  expect([st.devices, st.links]).toEqual([4, 3]);

  await page.keyboard.press('Space'); // again restores
  await expect(flowVerdict(page)).toHaveText(/^Click any device/);

  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Destination to measure reachability to')).toHaveCount(0);
  st = await flowState(page);
  expect(st.flowMode).toBe(false);
  expect([st.devices, st.links]).toEqual([4, 3]);
});
