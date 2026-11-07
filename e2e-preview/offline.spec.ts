import { test, expect, type Page } from '@playwright/test';
import { startHost, type Host } from './host';

/**
 * Offline support, against the real production build. The everyday e2e suite runs
 * on the dev server, where the service worker is never registered, so these are the
 * only browser checks of public/sw.js. Every test starts from an empty profile.
 */

let host: Host;
test.beforeEach(async () => {
  host = await startHost();
});
test.afterEach(async () => {
  await host.dispose();
});

/** Waits for the first visit's worker to finish precaching and take control. */
async function waitUntilOfflineReady(page: Page) {
  await expect(page.getByText('NexMap is ready to work offline.')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

const cachedPaths = (page: Page) =>
  page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) out.push(new URL(req.url).pathname);
    }
    return out;
  });

test('one online visit is enough to open the Network Designer offline', async ({ page }) => {
  await page.goto(host.url);
  await waitUntilOfflineReady(page);

  await host.stop();
  await page.reload();
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: /Branch office/ }).click();
  await expect(page.locator('g[data-id][role="button"]').first()).toBeVisible();

  // A lazy chunk the first visit never loaded (the PDF exporter) is there too.
  const pdf = await page.evaluate(async () => {
    const paths = (await (await caches.open('nexmap-v2')).keys()).map((r) => new URL(r.url).pathname);
    const res = await fetch(paths.find((p) => p.includes('jspdf'))!);
    return { ok: res.ok, type: res.headers.get('content-type') };
  });
  expect(pdf).toEqual({ ok: true, type: 'text/javascript' });
});

test('one online visit is enough to open the Rack Designer offline', async ({ page }) => {
  await page.goto(host.url);
  await waitUntilOfflineReady(page);

  await host.stop();
  await page.reload();
  await page.getByRole('button', { name: /Rack Designer/ }).click();
  await expect(page.getByText(/No racks yet/)).toBeVisible();
});

test('a new deploy reaches the next load, replaces the old bundle and works offline', async ({
  page,
}) => {
  await page.goto(host.url);
  await waitUntilOfflineReady(page);

  const { oldBundle, newBundle } = host.deploy();
  await page.reload();
  const scripts = await page.evaluate(() =>
    [...document.scripts].map((s) => new URL(s.src || location.href).pathname),
  );
  expect(scripts).toContain(newBundle);
  await expect.poll(() => cachedPaths(page), { timeout: 15_000 }).toContain(newBundle);
  await expect.poll(() => cachedPaths(page)).not.toContain(oldBundle);
  expect(await cachedPaths(page)).not.toContainEqual(expect.stringMatching(/^\/assets\/.*gone/));

  await host.stop();
  await page.reload();
  await expect(page.getByRole('button', { name: /Network Designer/ })).toBeVisible();
});

test('an interrupted cache fill does not claim offline readiness, and the next visit recovers', async ({
  page,
}) => {
  host.fail('/icon.svg');
  await page.goto(host.url);
  await expect(page.getByRole('button', { name: /Network Designer/ })).toBeVisible();
  // Give the failed install time to settle: no worker controls the page, no toast.
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(false);
  await expect(page.getByText('NexMap is ready to work offline.')).toHaveCount(0);

  host.fail(null);
  await page.reload();
  await waitUntilOfflineReady(page);
  await host.stop();
  await page.reload();
  await expect(page.getByRole('button', { name: /Network Designer/ })).toBeVisible();
});
