/**
 * Synthetic scene generator for the M0 SVG perf harness.
 *
 * Per the eng review (DA-P1/P2): the headline target is 1,000 devices / 5,000
 * links / 10,000 interfaces. Crucially, that is NOT "a few thousand SVG nodes" —
 * each device renders as a <g> of several elements. This generator produces a
 * realistic node count so the benchmark measures what the real renderer will face.
 */

export interface PerfNode {
  id: number;
  x: number;
  y: number;
  label: string;
}

export interface PerfLink {
  id: number;
  a: number;
  b: number;
}

export interface PerfScene {
  nodes: PerfNode[];
  links: PerfLink[];
  /** Approx live DOM nodes this scene will mount (for honest reporting). */
  estDomNodes: number;
}

export interface ScenePreset {
  key: string;
  label: string;
  devices: number;
  links: number;
}

export const PRESETS: ScenePreset[] = [
  { key: 'small', label: '200 / 400', devices: 200, links: 400 },
  { key: 'mvp', label: '1k / 5k', devices: 1000, links: 5000 },
  { key: 'large', label: '5k / 15k', devices: 5000, links: 15000 },
];

export const DEFAULT_PRESET: ScenePreset = PRESETS[1]!;

// Deterministic PRNG so runs are comparable (no Math.random — also keeps the
// harness reproducible, matching the project's no-nondeterminism discipline).
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLS = 50;
const CELL = 90;

export function genScene(devices: number, links: number): PerfScene {
  const rand = mulberry32(0xc0ffee);
  const nodes: PerfNode[] = [];
  for (let i = 0; i < devices; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    nodes.push({
      id: i,
      x: col * CELL + (rand() * 20 - 10),
      y: row * CELL + (rand() * 20 - 10),
      label: `dev-${i}`,
    });
  }

  const linkList: PerfLink[] = [];
  for (let i = 0; i < links && devices > 1; i++) {
    const a = Math.floor(rand() * devices);
    // Bias toward nearby nodes so links look topology-like, not spaghetti.
    const b = Math.min(devices - 1, a + 1 + Math.floor(rand() * COLS));
    if (a !== b) linkList.push({ id: i, a, b });
  }

  // Each device <g>: rect + accent rect + text = ~3 nodes + the <g> = 4.
  // Each link: 1 <path>. Honest estimate of live DOM nodes.
  const estDomNodes = devices * 4 + linkList.length;

  return { nodes, links: linkList, estDomNodes };
}
