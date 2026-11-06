/**
 * Measure trusted icon markup (the compile-time art in deviceVisuals /
 * deviceFlatArt / blueprintArt) so the icon-system spec can be checked by tests
 * instead of by eye. Not a general SVG engine: it understands exactly the
 * primitives our art uses (rect, circle, ellipse, line, path with every command
 * incl. arcs) and ignores transforms, which the 0–24 art never uses.
 *
 * Bounds include half the stroke width where a primitive is stroked, because a
 * 2px line on the keyline pokes 1px past it — that's what the eye sees.
 */

export interface ArtBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ArtElement {
  tag: string;
  attrs: Record<string, string>;
  box: ArtBox | null;
}

const ELEMENT = /<(rect|circle|ellipse|line|path)\b([^>]*?)\/?>/g;
const ATTR = /([a-zA-Z-]+)="([^"]*)"/g;

function attrsOf(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(ATTR)) out[m[1]!] = m[2]!;
  return out;
}

const num = (v: string | undefined, d = 0) => (v === undefined ? d : Number.parseFloat(v));

function grow(b: ArtBox | null, x: number, y: number): ArtBox {
  if (!b) return { minX: x, minY: y, maxX: x, maxY: y };
  return {
    minX: Math.min(b.minX, x),
    minY: Math.min(b.minY, y),
    maxX: Math.max(b.maxX, x),
    maxY: Math.max(b.maxY, y),
  };
}

function pad(b: ArtBox | null, by: number): ArtBox | null {
  return b && { minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by };
}

/** Points on an SVG elliptical arc (endpoint parameterization → center form). */
function arcPoints(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phiDeg: number,
  large: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): [number, number][] {
  if (rx === 0 || ry === 0) return [[x2, y2]];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = large === sweep ? -1 : 1;
  const numr = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, numr / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const out: [number, number][] = [];
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    const t = t1 + (dt * i) / steps;
    out.push([
      cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
      cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
    ]);
  }
  return out;
}

/** Bounds of a path's geometry (curves via their control hull — a safe overestimate). */
export function pathBounds(d: string): ArtBox | null {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let b: ArtBox | null = null;
  const isCmd = (t: string | undefined) => t !== undefined && /^[a-zA-Z]$/.test(t);
  const n = () => Number.parseFloat(tokens[i++]!);
  while (i < tokens.length) {
    if (isCmd(tokens[i])) cmd = tokens[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
      case 'L':
      case 'T': {
        x = ox + n();
        y = oy + n();
        if (cmd.toUpperCase() === 'M') {
          sx = x;
          sy = y;
          cmd = rel ? 'l' : 'L'; // implicit lineto after the first pair
        }
        b = grow(b, x, y);
        break;
      }
      case 'H':
        x = (rel ? x : 0) + n();
        b = grow(b, x, y);
        break;
      case 'V':
        y = (rel ? y : 0) + n();
        b = grow(b, x, y);
        break;
      case 'C': {
        for (let k = 0; k < 2; k++) b = grow(b, ox + n(), oy + n());
        x = ox + n();
        y = oy + n();
        b = grow(b, x, y);
        break;
      }
      case 'S':
      case 'Q': {
        b = grow(b, ox + n(), oy + n());
        x = ox + n();
        y = oy + n();
        b = grow(b, x, y);
        break;
      }
      case 'A': {
        const rx = n();
        const ry = n();
        const rot = n();
        const large = n() !== 0;
        const sweep = n() !== 0;
        const nx = ox + n();
        const ny = oy + n();
        for (const [px, py] of arcPoints(x, y, rx, ry, rot, large, sweep, nx, ny))
          b = grow(b, px, py);
        x = nx;
        y = ny;
        break;
      }
      case 'Z':
        x = sx;
        y = sy;
        break;
      default:
        i++; // unknown token — skip rather than loop forever
    }
  }
  return b;
}

function strokeOf(attrs: Record<string, string>, inheritedStroke: number): number {
  if (attrs.stroke === 'none') return 0;
  if (attrs['stroke-width'] !== undefined) return num(attrs['stroke-width']);
  return attrs.stroke !== undefined || inheritedStroke > 0 ? inheritedStroke : 0;
}

/**
 * Every measurable element in `markup`. `inheritedStroke` is the stroke width a
 * parent `<g>` applies (line icons are painted by their caller at 2).
 */
export function artElements(markup: string, inheritedStroke = 0): ArtElement[] {
  const out: ArtElement[] = [];
  for (const m of markup.matchAll(ELEMENT)) {
    const tag = m[1]!;
    const a = attrsOf(m[2]!);
    const sw = strokeOf(a, a.fill === undefined || a.fill === 'none' ? inheritedStroke : 0);
    let box: ArtBox | null = null;
    if (tag === 'rect') {
      const x = num(a.x);
      const y = num(a.y);
      box = { minX: x, minY: y, maxX: x + num(a.width), maxY: y + num(a.height) };
    } else if (tag === 'circle') {
      const r = num(a.r);
      box = { minX: num(a.cx) - r, minY: num(a.cy) - r, maxX: num(a.cx) + r, maxY: num(a.cy) + r };
    } else if (tag === 'ellipse') {
      const rx = num(a.rx);
      const ry = num(a.ry);
      box = {
        minX: num(a.cx) - rx,
        minY: num(a.cy) - ry,
        maxX: num(a.cx) + rx,
        maxY: num(a.cy) + ry,
      };
    } else if (tag === 'line') {
      box = grow(grow(null, num(a.x1), num(a.y1)), num(a.x2), num(a.y2));
    } else if (tag === 'path') {
      box = pathBounds(a.d ?? '');
    }
    // A stroked element that also carries an explicit fill (filled port dots
    // with stroke="none" excluded above) still paints its outline.
    out.push({ tag, attrs: a, box: pad(box, sw / 2) });
  }
  return out;
}

/** Union bounds of all `markup`, with stroke. Null for empty art. */
export function artBounds(markup: string, inheritedStroke = 0): ArtBox | null {
  let b: ArtBox | null = null;
  for (const e of artElements(markup, inheritedStroke)) {
    if (!e.box) continue;
    b = grow(grow(b, e.box.minX, e.box.minY), e.box.maxX, e.box.maxY);
  }
  return b;
}
