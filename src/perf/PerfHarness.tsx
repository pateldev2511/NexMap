import { useMemo, useRef, useState } from 'react';
import { genScene, PRESETS, DEFAULT_PRESET, type PerfScene } from './genScene';
import styles from './PerfHarness.module.css';

/**
 * M0 SVG perf harness (eng review DA-P1).
 *
 * Renders a synthetic topology at the chosen scale and measures frame time during
 * a scripted pan sweep. The result drives the M2 renderer decision: if 1k/5k can't
 * hold ~60fps pan on a mid laptop, the SceneSource interface lets us add a
 * Canvas-2D static layer before the real canvas is written.
 *
 * We measure pan because it is the common-case interaction and exercises the whole
 * live SVG tree (style recalc + paint), which is what degrades with node count.
 */

interface Metrics {
  fps: number;
  avgFrameMs: number;
  p95FrameMs: number;
  frames: number;
  domNodes: number;
}

const PAN_FRAMES = 120; // ~2s sweep at 60fps
const PAN_DISTANCE = 1200; // px translated across the sweep

function verdictClass(fps: number): 'good' | 'warn' | 'bad' {
  if (fps >= 55) return 'good';
  if (fps >= 30) return 'warn';
  return 'bad';
}

function verdictLabel(fps: number): string {
  if (fps >= 55) return 'SMOOTH';
  if (fps >= 30) return 'JANKY';
  return 'UNUSABLE';
}

function Scene({ scene, gRef }: { scene: PerfScene; gRef: React.Ref<SVGGElement> }) {
  return (
    <g ref={gRef}>
      {scene.links.map((l) => {
        const a = scene.nodes[l.a];
        const b = scene.nodes[l.b];
        if (!a || !b) return null;
        return (
          <path
            key={l.id}
            className={styles.link}
            d={`M${a.x + 28} ${a.y + 16} L${b.x + 28} ${b.y + 16}`}
          />
        );
      })}
      {scene.nodes.map((n) => (
        <g key={n.id} className={styles.node} transform={`translate(${n.x} ${n.y})`}>
          <rect width="56" height="32" rx="4" />
          <rect className="accent" x="4" y="4" width="10" height="10" rx="2" />
          <text x="18" y="20">
            {n.label}
          </text>
        </g>
      ))}
    </g>
  );
}

export function PerfHarness() {
  const [presetKey, setPresetKey] = useState('mvp');
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [running, setRunning] = useState(false);
  const gRef = useRef<SVGGElement>(null);

  const preset = PRESETS.find((p) => p.key === presetKey) ?? DEFAULT_PRESET;
  const scene = useMemo(() => genScene(preset.devices, preset.links), [preset]);

  function runPanBenchmark() {
    const g = gRef.current;
    if (!g || running) return;
    setRunning(true);
    setMetrics(null);

    const frameTimes: number[] = [];
    let last = performance.now();
    let i = 0;

    const step = () => {
      const now = performance.now();
      frameTimes.push(now - last);
      last = now;

      const t = i / PAN_FRAMES;
      const dx = Math.sin(t * Math.PI * 2) * PAN_DISTANCE;
      const dy = Math.cos(t * Math.PI * 2) * (PAN_DISTANCE / 2);
      g.setAttribute('transform', `translate(${dx} ${dy})`);

      i++;
      if (i <= PAN_FRAMES) {
        requestAnimationFrame(step);
      } else {
        g.setAttribute('transform', 'translate(0 0)');
        // Drop the first frame (warm-up).
        const samples = frameTimes.slice(1);
        const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
        const sorted = [...samples].sort((a, b) => a - b);
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? avg;
        setMetrics({
          fps: Math.round(1000 / avg),
          avgFrameMs: Math.round(avg * 10) / 10,
          p95FrameMs: Math.round(p95 * 10) / 10,
          frames: samples.length,
          domNodes: scene.estDomNodes,
        });
        setRunning(false);
      }
    };

    requestAnimationFrame(() => {
      last = performance.now();
      requestAnimationFrame(step);
    });
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <label>Scale (devices / links):</label>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            className={`${styles.preset} ${p.key === presetKey ? styles.active : ''}`}
            onClick={() => {
              setPresetKey(p.key);
              setMetrics(null);
            }}
            disabled={running}
          >
            {p.label}
          </button>
        ))}
        <button className={styles.run} onClick={runPanBenchmark} disabled={running}>
          {running ? 'Running…' : 'Run pan benchmark'}
        </button>

        {metrics && (
          <div className={styles.metrics}>
            <span className={styles.metric}>
              <span className="label">DOM nodes</span>
              <strong>{metrics.domNodes.toLocaleString()}</strong>
            </span>
            <span className={styles.metric}>
              <span className="label">fps</span>
              <strong>{metrics.fps}</strong>
            </span>
            <span className={styles.metric}>
              <span className="label">avg</span>
              <strong>{metrics.avgFrameMs}ms</strong>
            </span>
            <span className={styles.metric}>
              <span className="label">p95</span>
              <strong>{metrics.p95FrameMs}ms</strong>
            </span>
            <span className={`${styles.verdict} ${styles[verdictClass(metrics.fps)]}`}>
              {verdictLabel(metrics.fps)}
            </span>
          </div>
        )}
      </div>

      <div className={styles.viewport}>
        <svg className={styles.svg} viewBox="-200 -200 4800 2000" aria-hidden="true">
          <Scene scene={scene} gRef={gRef} />
        </svg>
      </div>

      <div className={styles.note}>
        Honest node count: {preset.devices.toLocaleString()} devices ≈{' '}
        {scene.estDomNodes.toLocaleString()} live SVG nodes. Target: ≥55fps pan at 1k/5k.
        If this is JANKY/UNUSABLE, M2 adds a Canvas-2D static layer behind SceneSource
        before the real renderer is built.
      </div>
    </div>
  );
}
