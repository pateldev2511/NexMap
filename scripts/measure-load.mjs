/**
 * Load-time measurement on a documented mobile profile (#44): 390x844 touch
 * viewport, 4x CPU slowdown, 150 ms latency / 1.6 Mbps down, a fresh profile per
 * run, median of N runs. Serve a production build first, then:
 *
 *   npm run build && npx vite preview --port 4174
 *   node scripts/measure-load.mjs http://localhost:4174/ [runs=5] [thinkMs=0]
 *
 * `thinkMs` is how long the user looks at the launch screen before picking a
 * designer (0 = the worst case for lazy chunks). Note `vite preview` serves files
 * uncompressed while production compresses them, so absolute times run high.
 */
/* global process */
import { chromium } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:4174/';
const runs = Number(process.argv[3] ?? 5);
const thinkMs = Number(process.argv[4] ?? 0);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const out = { chooser: [], network: [], rack: [], script: [], jsKB: [] };
const browser = await chromium.launch();
for (let i = 0; i < runs; i++) {
  for (const designer of ['Network', 'Rack']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
    await cdp.send('Performance.enable');
    let js = 0;
    page.on('response', async (r) => { if (r.url().endsWith('.js')) { try { js += (await r.body()).length; } catch { /* body unavailable (redirect / aborted) */ } } });
    const t0 = Date.now();
    await page.goto(url);
    await page.getByRole('button', { name: new RegExp(`${designer} Designer`) }).waitFor();
    const chooser = Date.now() - t0;
    if (designer === 'Network') {
      out.chooser.push(chooser);
      const m = await cdp.send('Performance.getMetrics');
      out.script.push(Math.round(m.metrics.find((x) => x.name === 'ScriptDuration').value * 1000));
    }
    await page.waitForTimeout(thinkMs);
    const t1 = Date.now();
    await page.getByRole('button', { name: new RegExp(`${designer} Designer`) }).click();
    if (designer === 'Network') {
      await page.getByRole('button', { name: /Branch office/ }).click();
      await page.locator('g[data-id][role="button"]').first().waitFor();
      out.network.push(Date.now() - t1);
      out.jsKB.push(Math.round(js / 1024));
    } else {
      await page.getByText(/No racks yet/).waitFor();
      out.rack.push(Date.now() - t1);
    }
    await ctx.close();
  }
}
// Returning visitor: the app remembers the designer and skips the launch screen.
out.returning = [];
for (let i = 0; i < runs; i++) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { try { localStorage.setItem('nexmap.mode', 'network'); } catch { /* storage blocked */ } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
  const t0 = Date.now();
  await page.goto(url);
  await page.getByRole('button', { name: /Branch office/ }).waitFor();
  out.returning.push(Date.now() - t0);
  await ctx.close();
}
// Returning visitor WITH the service worker (the real repeat-visit case): one
// unthrottled visit to install it, then a throttled reload into the remembered designer.
out.returningSw = [];
for (let i = 0; i < runs; i++) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('nexmap.mode', 'network'); } catch { /* storage blocked */ } });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(async () => !!navigator.serviceWorker.controller && (await caches.keys()).length > 0, null, { timeout: 30000 });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
  const t0 = Date.now();
  await page.reload();
  await page.getByRole('button', { name: /Branch office/ }).waitFor();
  out.returningSw.push(Date.now() - t0);
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify({
  runs,
  toLaunchScreenMs: med(out.chooser),
  scriptOnLaunchMs: med(out.script),
  launchToNetworkCanvasMs: med(out.network),
  launchToRackMs: med(out.rack),
  jsDownloadedThroughNetworkKB: med(out.jsKB),
  returningToNetworkMs: med(out.returning),
  returningWithServiceWorkerMs: med(out.returningSw),
}));
