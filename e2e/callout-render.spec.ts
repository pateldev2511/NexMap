import { test, expect, type Page } from '@playwright/test';

/**
 * W3a: rich callouts paint through the REAL canvas (ObjectNode), in a real
 * browser with real viewport dimensions. Guards the block model → calloutRows →
 * SVG path end-to-end, and that inline marks reach styled <tspan>s on screen.
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

async function openBlankNetwork(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: /Blank project/ }).click();
}

test('a rich callout paints stacked rows with a bold tspan on the real canvas', async ({
  page,
}) => {
  await openBlankNetwork(page);

  // Add a note through the real store, then give it rich content the same way
  // the editor does (updateObject with a blocks patch).
  const id = await page.evaluate(() => {
    const st = (window as unknown as { __nexmap: { getState: () => Record<string, any> } })
      .__nexmap.getState();
    const newId = st.addText(200, 160);
    const blocks = [
      { kind: 'heading', spans: [{ text: 'Core Switch' }] },
      { kind: 'subheading', spans: [{ text: 'rack A / U40' }] },
      { kind: 'paragraph', spans: [{ text: 'up ' }, { text: 'bold', marks: ['bold'] }] },
      { kind: 'bullets', items: [[{ text: 'uplink 1' }], [{ text: 'uplink 2' }]] },
    ];
    st.updateObject(newId, { blocks: st.getObject(newId).blocks }, { blocks });
    if (st.endEdit) st.endEdit();
    return newId as string;
  });

  const group = page.locator(`g[data-id="${id}"]`);
  await expect(group).toBeVisible();

  // heading + subheading + paragraph + 2 bullets = 5 painted rows
  const texts = group.locator('text');
  await expect(texts).toHaveCount(5);
  await expect(texts.first()).toHaveText('Core Switch');
  await expect(texts.first()).toHaveAttribute('font-weight', '700');

  // the inline-bold span paints as a weighted tspan
  const bold = group.locator('tspan', { hasText: 'bold' });
  await expect(bold).toHaveAttribute('font-weight', '700');

  // last row is the second bullet
  await expect(texts.nth(4)).toContainText('uplink 2');
});

test('an anchored callout paints a dotted leader to its target device', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Network Designer/ }).click();
  await page.getByRole('button', { name: /Branch office/ }).click();
  await expect(page.locator('g[data-id]').first()).toBeVisible();

  const calloutId = await page.evaluate(() => {
    const st = (window as unknown as { __nexmap: { getState: () => Record<string, any> } })
      .__nexmap.getState();
    // Anchor a new callout to the first real device on the canvas.
    const targetId = st.devicesAll()[0]?.id;
    const id = st.addText(60, 60);
    st.updateObject(
      id,
      { anchor: st.getObject(id).anchor },
      {
        anchor: { type: 'device', id: targetId },
        leader: { color: '#ef4444', dash: 'dotted', width: 2 },
      },
    );
    if (st.endEdit) st.endEdit();
    return id as string;
  });

  const leader = page.locator(`line[data-leader-for="${calloutId}"]`);
  await expect(leader).toBeVisible();
  await expect(leader).toHaveAttribute('stroke', '#ef4444');
  await expect(leader).toHaveAttribute('stroke-dasharray', /\d/);
});

test('the floating toolbar bolds a selected callout (W3c)', async ({ page }) => {
  await openBlankNetwork(page);

  const id = await page.evaluate(() => {
    const st = (window as unknown as { __nexmap: { getState: () => Record<string, any> } })
      .__nexmap.getState();
    const newId = st.addText(200, 160);
    st.updateObject(
      newId,
      { blocks: st.getObject(newId).blocks },
      { blocks: [{ kind: 'paragraph', spans: [{ text: 'note' }] }] },
    );
    if (st.endEdit) st.endEdit();
    st.select([newId]); // ensure the selection toolbar shows
    return newId as string;
  });

  // The formatting toolbar appears for the selected callout.
  const bold = page.getByRole('button', { name: 'Bold' });
  await expect(bold).toBeVisible();
  await expect(bold).toHaveAttribute('aria-pressed', 'false');

  await bold.click();

  // Model + paint both reflect the bold mark.
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  const group = page.locator(`g[data-id="${id}"]`);
  await expect(group.locator('tspan', { hasText: 'note' })).toHaveAttribute('font-weight', '700');

  // Convert body to a bulleted list; the row gains a bullet marker.
  await page.getByRole('button', { name: 'Bulleted list' }).click();
  await expect(group.locator('text').first()).toContainText('•');
});
