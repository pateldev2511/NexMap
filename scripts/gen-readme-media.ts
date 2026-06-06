/**
 * Generate the README visuals from REAL NexMap renders.
 *
 * Uses the app's own export pipeline (buildSvg) over a real starter template, so
 * the screenshot/gif always reflect the current rendering — no hand-drawn mockups.
 *
 *   npx vite-node scripts/gen-readme-media.ts
 *
 * Outputs:
 *   docs/assets/nexmap-screenshot.svg   flat 2D render (vector, self-contained)
 *   docs/assets/nexmap-iso.svg          isometric render
 *   docs/assets/nexmap-demo.gif         flat ↔ iso loop (rasterized via resvg)
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { buildTemplate } from '@/model/templates';
import { buildSvg } from '@/io/export/buildSvg';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(HERE, '../docs/assets');
const PUBLIC = resolve(HERE, '../public');
const NOW = '2026-06-06T00:00:00.000Z';
const BG = '#f8fafc';

// A topology with enough structure to show the rendering off.
const doc = buildTemplate('campus-3tier', NOW);

function render(projection: 'flat' | 'iso'): string {
  return buildSvg(doc.devices, doc.links, {
    background: BG,
    includeLabels: true,
    padding: 48,
    objects: doc.objects,
    projection,
  });
}

const flatSvg = render('flat');
const isoSvg = render('iso');

writeFileSync(resolve(ASSETS, 'nexmap-screenshot.svg'), flatSvg);
writeFileSync(resolve(ASSETS, 'nexmap-iso.svg'), isoSvg);

// --- Rasterize each frame onto a uniform canvas, then encode a looping GIF. ---
const FRAME_W = 1100;
const FRAME_H = 720;

/** Render an SVG to RGBA pixels composited (centered) onto a fixed FRAME_W×FRAME_H. */
function frame(svg: string): Uint8Array {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: FRAME_W - 96 }, background: BG });
  const img = r.render();
  const { width: w, height: h } = img;
  const src = img.pixels; // RGBA

  // Fixed canvas filled with the background color.
  const bg = hexToRgb(BG);
  const out = new Uint8Array(FRAME_W * FRAME_H * 4);
  for (let i = 0; i < FRAME_W * FRAME_H; i++) {
    out[i * 4] = bg.r;
    out[i * 4 + 1] = bg.g;
    out[i * 4 + 2] = bg.b;
    out[i * 4 + 3] = 255;
  }
  const ox = Math.max(0, Math.floor((FRAME_W - w) / 2));
  const oy = Math.max(0, Math.floor((FRAME_H - h) / 2));
  const cw = Math.min(w, FRAME_W);
  const ch = Math.min(h, FRAME_H);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const s = (y * w + x) * 4;
      const d = ((oy + y) * FRAME_W + (ox + x)) * 4;
      const a = src[s + 3]! / 255;
      // Alpha-composite over the background.
      out[d] = Math.round(src[s]! * a + out[d]! * (1 - a));
      out[d + 1] = Math.round(src[s + 1]! * a + out[d + 1]! * (1 - a));
      out[d + 2] = Math.round(src[s + 2]! * a + out[d + 2]! * (1 - a));
      out[d + 3] = 255;
    }
  }
  return out;
}

function hexToRgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const frames = [
  { data: frame(flatSvg), delay: 1600 },
  { data: frame(isoSvg), delay: 1600 },
];

const gif = GIFEncoder();
for (const f of frames) {
  const palette = quantize(f.data, 256);
  const index = applyPalette(f.data, palette);
  gif.writeFrame(index, FRAME_W, FRAME_H, { palette, delay: f.delay });
}
gif.finish();
writeFileSync(resolve(ASSETS, 'nexmap-demo.gif'), Buffer.from(gif.bytes()));

// --- Open Graph social card (1200×630): wordmark + tagline + a real render. ---
const OG_W = 1200;
const OG_H = 630;

// Render the diagram to a PNG and embed it as a data URI on the right side.
const diag = new Resvg(flatSvg, {
  fitTo: { mode: 'width', value: 560 },
  background: '#ffffff',
}).render();
const diagB64 = Buffer.from(diag.asPng()).toString('base64');
const diagScale = Math.min(560 / diag.width, 500 / diag.height);
const dW = diag.width * diagScale;
const dH = diag.height * diagScale;
const dX = 620 + (560 - dW) / 2;
const dY = (OG_H - dH) / 2;

const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" font-family="Helvetica, Arial, sans-serif">
  <defs>
    <linearGradient id="og-bg" x1="0" y1="0" x2="0" y2="${OG_H}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#eef2ff"/>
    </linearGradient>
  </defs>
  <rect width="${OG_W}" height="${OG_H}" fill="url(#og-bg)"/>
  <rect x="0" y="0" width="10" height="${OG_H}" fill="#2563eb"/>
  <text x="72" y="180" font-size="96" font-weight="700"><tspan fill="#0f172a">Nex</tspan><tspan fill="#2563eb">Map</tspan></text>
  <text x="76" y="244" font-size="30" font-weight="600" fill="#334155">Local-first network diagram designer</text>
  <text x="76" y="298" font-size="23" fill="#64748b">Validate your topology while you draw it.</text>
  <text x="76" y="338" font-size="23" fill="#64748b">No login. No cloud. Your data stays on your device.</text>
  <rect x="72" y="498" width="214" height="52" rx="26" fill="#2563eb"/>
  <text x="179" y="532" font-size="24" font-weight="700" fill="#ffffff" text-anchor="middle">nexmap.xyz</text>
  <image x="${dX.toFixed(1)}" y="${dY.toFixed(1)}" width="${dW.toFixed(1)}" height="${dH.toFixed(1)}" href="data:image/png;base64,${diagB64}"/>
</svg>`;

const ogPng = new Resvg(ogSvg, {
  background: '#ffffff',
  font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' },
}).render().asPng();
writeFileSync(resolve(PUBLIC, 'og.png'), ogPng);

console.log(
  `Wrote nexmap-screenshot.svg, nexmap-iso.svg, nexmap-demo.gif (${FRAME_W}×${FRAME_H}) to docs/assets/ and og.png (${OG_W}×${OG_H}) to public/`,
);
