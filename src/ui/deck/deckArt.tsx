import { useId, type ReactElement } from 'react';

/**
 * Bespoke isometric illustrations for the Deck mode-tiles — hand-built 3D scenes
 * (no external assets) that echo exactly what each designer makes. Colors come from
 * CSS vars so both themes read correctly; motion is CSS (dash-flow, LED blink, float)
 * and is neutralised by the reduced-motion kill switch.
 *
 * Iso convention: a true 2:1 isometric projection. project(x,y,z) maps grid units to
 * screen space; +x goes down-right, +y down-left, +z up.
 */

const COS = 0.866; // cos 30°
const SIN = 0.5; // sin 30°

function project(x: number, y: number, z: number, ox: number, oy: number, s: number) {
  return [ox + (x - y) * COS * s, oy + (x + y) * SIN * s - z * s] as const;
}

/** Three visible faces of an axis-aligned iso box, as an SVG <g>. */
function IsoBox({
  x, y, z, w, d, h, ox, oy, s, top, left, right, stroke = 'rgba(255,255,255,0.14)',
}: {
  x: number; y: number; z: number; w: number; d: number; h: number;
  ox: number; oy: number; s: number;
  top: string; left: string; right: string; stroke?: string;
}) {
  const p = (px: number, py: number, pz: number) => project(x + px, y + py, z + pz, ox, oy, s);
  const t = [p(0, 0, h), p(w, 0, h), p(w, d, h), p(0, d, h)];
  const l = [p(0, 0, h), p(0, d, h), p(0, d, 0), p(0, 0, 0)];
  const r = [p(0, d, h), p(w, d, h), p(w, d, 0), p(0, d, 0)];
  const poly = (pts: readonly (readonly [number, number])[]) => pts.map((q) => q.join(',')).join(' ');
  return (
    <g strokeLinejoin="round">
      <polygon points={poly(l)} fill={left} stroke={stroke} strokeWidth="0.5" />
      <polygon points={poly(r)} fill={right} stroke={stroke} strokeWidth="0.5" />
      <polygon points={poly(t)} fill={top} stroke={stroke} strokeWidth="0.5" />
    </g>
  );
}

/* ── Network topology scene ──────────────────────────────────────────────── */
export function NetworkArt({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, '');
  const ox = 110, oy = 92, s = 15;
  // node footprints (grid coords), z=height of top
  const router = { x: -0.5, y: -0.5 };
  const sw1 = { x: -2.6, y: 1.2 };
  const sw2 = { x: 1.6, y: 1.4 };
  const ep1 = { x: -3.4, y: -1.4 };
  const ep2 = { x: 2.6, y: -1.0 };
  const top = (n: { x: number; y: number }, h: number) => project(n.x + 0.5, n.y + 0.5, h, ox, oy, s);
  const rTop = top(router, 1.4);
  const s1Top = top(sw1, 0.8);
  const s2Top = top(sw2, 0.8);
  const e1Top = top(ep1, 0.55);
  const e2Top = top(ep2, 0.55);

  const link = (a: readonly [number, number], b: readonly [number, number], i: number) => (
    <line
      key={i}
      x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
      stroke={`url(#nl-${uid})`}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeDasharray="3 4"
      style={{ animation: `nx-dashflow 1.4s linear infinite`, animationDelay: `${i * 0.12}s` }}
    />
  );

  return (
    <svg viewBox="0 0 220 160" className={className} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`nl-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="var(--accent-2)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
        <radialGradient id={`ng-${uid}`} cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="var(--accent)" stopOpacity="0.5" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ground glow */}
      <ellipse cx="110" cy="112" rx="92" ry="34" fill={`url(#ng-${uid})`} opacity="0.7" />

      {/* iso grid */}
      <g stroke="var(--deck-grid)" strokeWidth="0.75" opacity="0.9">
        {Array.from({ length: 9 }, (_, i) => {
          const a = project(-4 + i, -3, 0, ox, oy, s);
          const b = project(-4 + i, 3, 0, ox, oy, s);
          return <line key={`a${i}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
        })}
        {Array.from({ length: 7 }, (_, i) => {
          const a = project(-4, -3 + i, 0, ox, oy, s);
          const b = project(4, -3 + i, 0, ox, oy, s);
          return <line key={`b${i}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
        })}
      </g>

      {/* links */}
      <g className="nx-float-slow">
        {link(rTop, s1Top, 0)}
        {link(rTop, s2Top, 1)}
        {link(s1Top, e1Top, 2)}
        {link(s2Top, e2Top, 3)}
        {link(rTop, e2Top, 4)}
      </g>

      {/* endpoints (small) */}
      <IsoBox x={ep1.x} y={ep1.y} z={0} w={1} d={1} h={0.55} ox={ox} oy={oy} s={s}
        top="var(--accent-3)" left="color-mix(in srgb, var(--accent-3) 62%, #000)" right="color-mix(in srgb, var(--accent-3) 80%, #000)" />
      <IsoBox x={ep2.x} y={ep2.y} z={0} w={1} d={1} h={0.55} ox={ox} oy={oy} s={s}
        top="var(--accent-3)" left="color-mix(in srgb, var(--accent-3) 62%, #000)" right="color-mix(in srgb, var(--accent-3) 80%, #000)" />

      {/* switches */}
      <IsoBox x={sw1.x} y={sw1.y} z={0} w={1.2} d={1.2} h={0.8} ox={ox} oy={oy} s={s}
        top="var(--accent-2)" left="color-mix(in srgb, var(--accent-2) 55%, #000)" right="color-mix(in srgb, var(--accent-2) 72%, #000)" />
      <IsoBox x={sw2.x} y={sw2.y} z={0} w={1.2} d={1.2} h={0.8} ox={ox} oy={oy} s={s}
        top="var(--accent-2)" left="color-mix(in srgb, var(--accent-2) 55%, #000)" right="color-mix(in srgb, var(--accent-2) 72%, #000)" />

      {/* router (central, elevated) */}
      <IsoBox x={router.x} y={router.y} z={0.4} w={1.3} d={1.3} h={1.0} ox={ox} oy={oy} s={s}
        top="var(--accent)" left="color-mix(in srgb, var(--accent) 52%, #000)" right="color-mix(in srgb, var(--accent) 70%, #000)" />
      {/* router beacon */}
      <circle cx={rTop[0]} cy={rTop[1] - 2} r="3.4" fill="#fff" style={{ animation: 'nx-glow-pulse 2.2s ease-in-out infinite' }} />

      {/* node beacons */}
      {[s1Top, s2Top].map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1] - 1} r="1.8" fill="#fff" opacity="0.9"
          style={{ animation: 'nx-glow-pulse 2.6s ease-in-out infinite', animationDelay: `${i * 0.4}s` }} />
      ))}

      <style>{`
        @keyframes nx-dashflow { to { stroke-dashoffset: -14; } }
        .nx-float-slow { animation: nx-float 6s ease-in-out infinite; }
      `}</style>
    </svg>
  );
}

/* ── Rack elevation scene ────────────────────────────────────────────────── */
export function RackArt({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, '');
  const ox = 112, oy = 128, s = 15;
  // Rack frame
  const rackW = 2.4, rackD = 2.0, rackH = 6.2;
  const units: { z: number; h: number; c: string }[] = [
    { z: 0.2, h: 0.5, c: 'var(--accent-3)' },
    { z: 0.9, h: 0.8, c: 'var(--accent-2)' },
    { z: 1.9, h: 0.5, c: 'var(--accent)' },
    { z: 2.6, h: 1.0, c: 'var(--accent-2)' },
    { z: 3.8, h: 0.5, c: 'var(--accent-3)' },
    { z: 4.5, h: 0.8, c: 'var(--accent)' },
  ];
  // Front face top-left origin of each unit for LEDs
  const ledsFor = (z: number, h: number, i: number) => {
    const row: ReactElement[] = [];
    for (let k = 0; k < 4; k++) {
      const [lx, ly] = project(0.25 + k * 0.45, rackD, z + h / 2, ox, oy, s);
      row.push(
        <circle key={`${i}-${k}`} cx={lx} cy={ly} r="1.1" fill="#fff"
          style={{ animation: 'nx-led 1.8s steps(1) infinite', animationDelay: `${(i * 4 + k) * 0.19}s` }} />,
      );
    }
    return row;
  };

  return (
    <svg viewBox="0 0 220 170" className={className} fill="none" aria-hidden="true">
      <defs>
        <radialGradient id={`rg-${uid}`} cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="var(--accent-2)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--accent-2)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="112" cy="150" rx="80" ry="26" fill={`url(#rg-${uid})`} />

      {/* rack cabinet shell (empty frame, slightly larger than units) */}
      <IsoBox x={-0.2} y={-0.2} z={0} w={rackW + 0.4} d={rackD + 0.4} h={rackH} ox={ox} oy={oy} s={s}
        top="color-mix(in srgb, var(--chrome-fg) 14%, transparent)"
        left="color-mix(in srgb, #0b0f16 86%, var(--accent))"
        right="color-mix(in srgb, #11161f 80%, var(--accent))"
        stroke="rgba(255,255,255,0.12)" />

      {/* mounted units (front-stacked) */}
      {units.map((u, i) => (
        <g key={i} className="nx-rack-unit" style={{ animationDelay: `${i * 90}ms` }}>
          <IsoBox x={0} y={0} z={u.z} w={rackW} d={rackD} h={u.h} ox={ox} oy={oy} s={s}
            top={`color-mix(in srgb, ${u.c} 80%, #fff 0%)`}
            left={`color-mix(in srgb, ${u.c} 50%, #000)`}
            right={`color-mix(in srgb, ${u.c} 70%, #000)`} />
          {ledsFor(u.z, u.h, i)}
        </g>
      ))}

      <style>{`
        @keyframes nx-led { 0%,55% { opacity: 1; } 56%,100% { opacity: 0.25; } }
        .nx-rack-unit { animation: nx-rise 500ms var(--ease-out, ease) both; }
      `}</style>
    </svg>
  );
}
