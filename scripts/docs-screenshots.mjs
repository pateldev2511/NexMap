/**
 * Screenshots for the README and the user guide, taken from the real app.
 *
 *   npm run dev                       # in one terminal
 *   npm run docs:screenshots          # in another (or pass a URL: -- http://localhost:5174/)
 *
 * Every shot starts from a fresh browser profile and a built-in template, then
 * walks the same steps a user would, so the pictures always match the current UI.
 * Writes docs/assets/screens/*.jpg (2x, compressed) — commit the ones that change.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5173/';
const OUT = new URL('../docs/assets/screens/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
/** Park the pointer where it shows no tooltip or hover state, then capture. */
const shot = async (page, name) => {
  await page.mouse.move(2, (page.viewportSize()?.height ?? 900) - 2);
  await page.waitForTimeout(250);
  return page.screenshot({ path: `${OUT}${name}.jpg`, type: 'jpeg', quality: 86 }).then(() => console.log(`  ${name}.jpg`));
};

/** A close-up of one region (CSS px of the 1440x900 window), for the README, where
 *  GitHub's narrow column would shrink a whole-window shot past reading. */
const crop = async (page, name, clip) => {
  await page.mouse.move(2, (page.viewportSize()?.height ?? 900) - 2);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}${name}.jpg`, type: 'jpeg', quality: 86, clip });
  console.log(`  ${name}.jpg`);
};

/** A fresh profile: no draft, no remembered designer, the chosen theme. */
async function fresh({ theme = 'light', width = 1440, height = 900, scale = 2, mobile = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    colorScheme: theme,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'reduce', // still frames: no half-drawn animation in a picture
  });
  await context.addInitScript((t) => {
    try {
      indexedDB.deleteDatabase('nexmap');
      localStorage.clear();
      localStorage.setItem('nexmap.theme', t);
    } catch {
      /* storage blocked: the app still runs */
    }
  }, theme);
  const page = await context.newPage();
  await page.goto(BASE);
  return page;
}

const store = (page, fn, arg) =>
  page.evaluate(([src, a]) => new Function('s', 'a', src)(window.__nexmap.getState(), a), [fn, arg]);

async function openTemplate(page, name, { stepBack = true } = {}) {
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await page.locator('g[data-id][role="button"]').first().waitFor();
  await fit(page, stepBack);
}

/** Fit the design to the canvas, then one step back so nothing sits under the chrome. */
async function fit(page, stepBack = true) {
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  if (stepBack) await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.waitForTimeout(400);
}

/** Select a device by its name, so the Inspector shows something real. */
const selectDevice = (page, name) =>
  store(page, 's.select([s.devicesAll().find((d) => d.name === a).id])', name);

// 1. Launch screen and template gallery
{
  const page = await fresh();
  await page.getByRole('button', { name: /Network Designer/ }).waitFor();
  await page.waitForTimeout(600);
  await shot(page, 'launch');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: /Branch office/ }).waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'templates');
  await page.context().close();
}

// 2. The editor, light and dark, with a device selected
for (const theme of ['light', 'dark']) {
  const page = await fresh({ theme });
  await openTemplate(page, 'Branch office');
  await selectDevice(page, 'PC-1');
  await page.waitForTimeout(300);
  await shot(page, theme === 'light' ? 'network' : 'network-dark');
  if (theme === 'light') {
    // 3. The same design in 3D
    await store(page, 's.select([])');
    await page.getByRole('button', { name: 'Toggle isometric view' }).click();
    await page.waitForTimeout(1200);
    // The 3D layout is wider than the flat one: a plain fit leaves room enough.
    await page.getByRole('button', { name: 'Fit to screen' }).click();
    await page.waitForTimeout(400);
    await shot(page, 'isometric');
  }
  await page.context().close();
}

// 4. Checking: a gateway outside its subnet → the finding → the field to fix
{
  const page = await fresh();
  await openTemplate(page, 'Branch office');
  await page.getByRole('button', { name: /^IP Plan/ }).click();
  await page.getByText('Add subnet').click();
  await page.getByLabel('Subnet CIDR').fill('10.20.0.0/24');
  await page.getByLabel('Subnet CIDR').press('Tab');
  await page.getByLabel('Gateway').fill('192.0.2.1');
  await page.getByLabel('Gateway').press('Tab');
  await page.getByRole('button', { name: /^Validation/ }).click();
  await page.waitForTimeout(400);
  await shot(page, 'validation');
  await page.getByRole('button', { name: /Gateway 192\.0\.2\.1 is outside/ }).click();
  await page.waitForTimeout(400);
  await shot(page, 'validation-fix');
  await crop(page, 'validation-fix-crop', { x: 0, y: 612, width: 1000, height: 190 });
  await page.context().close();
}

// 5. Stress-test: pull the core switch and see what loses its connection
{
  const page = await fresh();
  await openTemplate(page, 'Branch office');
  await page.getByRole('button', { name: 'Stress-test (Flow)' }).click();
  await page.waitForTimeout(400);
  const core = await store(page, 'return s.devicesAll().find((d) => d.name === a).id', 'Core SW');
  const box = await page.locator(`[data-flow-hit="${core}"]`).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);
  await shot(page, 'stress-test');
  await crop(page, 'stress-test-crop', { x: 240, y: 44, width: 901, height: 800 });
  await page.context().close();
}

// 6. Export
{
  const page = await fresh();
  await openTemplate(page, 'Branch office');
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await page.getByRole('button', { name: 'PNG', exact: true }).click();
  await page.waitForTimeout(500);
  await shot(page, 'export');
  await page.context().close();
}

// 7. Rack Designer: a row of racks, then one rack up close
{
  const page = await fresh();
  await page.getByRole('button', { name: /Rack Designer/ }).click();
  await page.getByRole('button', { name: /Enterprise core \(42U\)/ }).click();
  await page.waitForTimeout(800);
  await shot(page, 'rack-row');
  await page.getByRole('button', { name: /^Single rack$/ }).click();
  await page.waitForTimeout(800);
  await shot(page, 'rack');
  await crop(page, 'rack-crop', { x: 292, y: 186, width: 788, height: 662 });
  await page.context().close();
}

// 8. On a phone
{
  const page = await fresh({ width: 390, height: 844, scale: 3, mobile: true });
  await openTemplate(page, 'Home Wi-Fi', { stepBack: false }); // a phone needs every pixel
  await shot(page, 'phone');
  await page.context().close();
}

await browser.close();
