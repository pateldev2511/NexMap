/**
 * Faceplate glyphs shared by BOTH art paths — pure, leaf module.
 *
 * A leaf so the generic art and the vendor skins can share a glyph without importing
 * each other. Sharing matters more than the few lines saved: an outlet drawn two
 * different ways in two files is how the drawn-vs-hit-tested geometry drifts apart.
 */
const n = (v: number) => v.toFixed(1);

const OUTLET = {
  body: '#161c24',
  border: '#566372',
  pin: '#05080c',
} as const;

/**
 * A C13-style outlet: recessed body plus the earth-pin glyph.
 *
 * Drawn at exactly the rect hit-testing uses (see portLayouts.devicePortLayout), so
 * clicking an outlet always resolves to that outlet.
 */
export function outletGlyph(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return (
    `<rect data-fx="outlet" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="1.5" fill="${OUTLET.body}" stroke="${OUTLET.border}" stroke-width="0.75"/>` +
    `<path d="M ${n(cx - Math.min(2.4, w * 0.22))} ${n(cy - 1.4)} h ${n(Math.min(4.8, w * 0.44))} M ${n(cx)} ${n(cy + 0.6)} v ${n(Math.min(3, h * 0.28))}" stroke="${OUTLET.pin}" stroke-width="1.1" stroke-linecap="round"/>`
  );
}
