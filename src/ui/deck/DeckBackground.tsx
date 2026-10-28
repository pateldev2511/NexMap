import { useEffect, useRef } from 'react';
import { getReduceMotion } from '@/lib/prefs';

/**
 * DeckBackground — a real-time 3D "network constellation" rendered on a 2D canvas
 * (projected point cloud + proximity links), the hero visual of the NexMap Deck.
 *
 * Why Canvas 2D rather than WebGL: zero dependencies, zero shader/context-loss risk,
 * runs on every device, and — crucially for a local-first PWA — it degrades and pauses
 * cleanly. Glow is drawn with a pre-rendered radial sprite under 'lighter' compositing
 * (additive bloom) so there is no per-frame shadowBlur cost.
 *
 * Robustness: honors reduced-motion (renders ONE static frame, no RAF loop), pauses
 * when the tab/page is hidden or the element scrolls out of view, tracks devicePixelRatio
 * and resize, re-reads brand colors when the theme flips, and cleans up every listener.
 */

type Node = {
  bx: number;
  by: number;
  bz: number;
  r: number;
  hub: boolean;
  phase: number;
};

type Proj = { sx: number; sy: number; scale: number; depth: number };
type RGB = [number, number, number];

function readRGB(varName: string, fallback: RGB): RGB {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (raw.startsWith('#')) {
      const h = raw.slice(1);
      const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
      const n = parseInt(full, 16);
      if (!Number.isNaN(n) && full.length === 6)
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m = raw.match(/rgba?\(([^)]+)\)/);
    if (m && m[1]) {
      const p = m[1].split(',').map((s) => parseFloat(s));
      if (p.length >= 3) return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
    }
  } catch {
    /* fall through */
  }
  return fallback;
}

/** Pre-render a soft radial glow sprite once; reused (scaled) for every node. */
function makeGlowSprite(rgb: RGB): HTMLCanvasElement {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return c;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.95)`);
  grad.addColorStop(0.25, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.55)`);
  grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export function DeckBackground({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const g = cv.getContext('2d', { alpha: true });
    if (!g) return;

    let raf = 0;
    let running = true;
    let W = 0;
    let H = 0;
    let dpr = 1;

    let cAccent = readRGB('--accent', [76, 141, 255]);
    let cCyan = readRGB('--accent-2', [47, 227, 240]);
    let spriteA = makeGlowSprite(cAccent);
    let spriteB = makeGlowSprite(cCyan);
    let isDark = document.documentElement.dataset.theme === 'dark';

    const NODE_COUNT = 150;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const nodes: Node[] = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      nodes.push({
        bx: rand(-1, 1),
        by: rand(-0.62, 0.62),
        bz: rand(-1, 1),
        r: rand(0.6, 1.5),
        hub: Math.random() < 0.16,
        phase: rand(0, Math.PI * 2),
      });
    }
    // Nearest-neighbour edges (static topology) for stable links.
    const edges: [number, number][] = [];
    for (let i = 0; i < nodes.length; i++) {
      const ni = nodes[i]!;
      const dists: { j: number; d: number }[] = [];
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const nj = nodes[j]!;
        const dx = ni.bx - nj.bx;
        const dy = ni.by - nj.by;
        const dz = ni.bz - nj.bz;
        dists.push({ j, d: dx * dx + dy * dy + dz * dz });
      }
      dists.sort((a, b) => a.d - b.d);
      const k = ni.hub ? 3 : 2;
      for (let n = 0; n < k; n++) {
        const j = dists[n]!.j;
        if (i < j) edges.push([i, j]);
        else if (!edges.some(([a, b]) => a === j && b === i)) edges.push([j, i]);
      }
    }

    function resize() {
      const rect = cv!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, Math.round(rect.width));
      H = Math.max(1, Math.round(rect.height));
      cv!.width = Math.round(W * dpr);
      cv!.height = Math.round(H * dpr);
      g!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function project(x: number, y: number, z: number): Proj {
      const fov = 2.6;
      const camZ = 3.0;
      const scale = (fov / (camZ - z)) * Math.min(W, H) * 0.52;
      return { sx: W / 2 + x * scale, sy: H / 2 + y * scale, scale, depth: (z + 1) / 2 };
    }

    function frame(t: number) {
      if (!running) return;
      const time = t * 0.001;
      pointer.current.x += (pointer.current.tx - pointer.current.x) * 0.05;
      pointer.current.y += (pointer.current.ty - pointer.current.y) * 0.05;
      const rotY = time * 0.06 + pointer.current.x * 0.5;
      const rotX = -0.26 + pointer.current.y * 0.28;
      const cy = Math.cos(rotY), sy = Math.sin(rotY);
      const cx = Math.cos(rotX), sx = Math.sin(rotX);

      g!.clearRect(0, 0, W, H);

      const proj: Proj[] = new Array(nodes.length);
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        const breathe = 1 + Math.sin(time * 0.8 + n.phase) * 0.015;
        const x = n.bx * breathe;
        const y = n.by * breathe;
        const z = n.bz * breathe;
        const x1 = x * cy - z * sy;
        const z1 = x * sy + z * cy;
        const y1 = y * cx - z1 * sx;
        const z2 = y * sx + z1 * cx;
        proj[i] = project(x1, y1, z2);
      }

      // Links (additive glow).
      g!.globalCompositeOperation = 'lighter';
      for (let e = 0; e < edges.length; e++) {
        const edge = edges[e]!;
        const a = proj[edge[0]]!;
        const b = proj[edge[1]]!;
        const depth = (a.depth + b.depth) / 2;
        const alpha = (0.05 + depth * 0.22) * (isDark ? 1 : 0.7);
        const col = e % 3 === 0 ? cCyan : cAccent;
        g!.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha})`;
        g!.lineWidth = 0.6 + depth * 0.9;
        g!.beginPath();
        g!.moveTo(a.sx, a.sy);
        g!.lineTo(b.sx, b.sy);
        g!.stroke();
      }

      // Node glow sprites.
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        const p = proj[i]!;
        const twinkle = 0.7 + Math.sin(time * 1.6 + n.phase) * 0.3;
        const glowR = (n.hub ? 22 : 10) * (0.5 + p.depth) * (p.scale / 300 + 0.6);
        const sprite = n.hub ? spriteB : spriteA;
        const ga = (n.hub ? 0.5 : 0.28) * twinkle * (0.5 + p.depth) * (isDark ? 1 : 0.8);
        g!.globalAlpha = Math.min(1, ga);
        g!.drawImage(sprite, p.sx - glowR, p.sy - glowR, glowR * 2, glowR * 2);
      }

      // Bright cores.
      g!.globalCompositeOperation = 'source-over';
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        const p = proj[i]!;
        const coreR = Math.max(0.5, n.r * (0.4 + p.depth) * (p.scale / 300 + 0.5));
        const col = n.hub ? cCyan : cAccent;
        g!.globalAlpha = 0.3 + p.depth * 0.7;
        g!.fillStyle = n.hub
          ? `rgb(${Math.min(255, col[0] + 90)},${Math.min(255, col[1] + 70)},${Math.min(255, col[2] + 40)})`
          : `rgba(${col[0]},${col[1]},${col[2]},0.9)`;
        g!.beginPath();
        g!.arc(p.sx, p.sy, coreR, 0, Math.PI * 2);
        g!.fill();
      }
      g!.globalAlpha = 1;

      raf = requestAnimationFrame(frame);
    }

    function renderStatic() {
      running = true;
      frame(1600);
      running = false;
      cancelAnimationFrame(raf);
    }

    resize();

    const reduce = getReduceMotion() || matchMedia('(prefers-reduced-motion: reduce)').matches;

    const themeObs = new MutationObserver(() => {
      cAccent = readRGB('--accent', [76, 141, 255]);
      cCyan = readRGB('--accent-2', [47, 227, 240]);
      spriteA = makeGlowSprite(cAccent);
      spriteB = makeGlowSprite(cCyan);
      isDark = document.documentElement.dataset.theme === 'dark';
      if (reduce) renderStatic();
    });
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    const onResize = () => {
      resize();
      if (reduce) renderStatic();
    };
    window.addEventListener('resize', onResize);

    const onPointer = (e: PointerEvent) => {
      pointer.current.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    if (!reduce) window.addEventListener('pointermove', onPointer, { passive: true });

    const onVis = () => {
      if (reduce) return;
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener('visibilitychange', onVis);

    let io: IntersectionObserver | null = null;
    if (!reduce && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(
        (entries) => {
          const vis = entries[0]?.isIntersecting ?? true;
          if (!vis) {
            running = false;
            cancelAnimationFrame(raf);
          } else if (!document.hidden && !running) {
            running = true;
            raf = requestAnimationFrame(frame);
          }
        },
        { threshold: 0 },
      );
      io.observe(cv);
    }

    if (reduce) renderStatic();
    else raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      themeObs.disconnect();
      io?.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
