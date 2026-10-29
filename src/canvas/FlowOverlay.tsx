import { memo, useEffect, useMemo, useState } from 'react';
import type { Device, Link } from '@/model/types';
import { center } from './connector';
import { blastRadius } from '@/sim/blastRadius';
import styles from './Canvas.module.css';

/** Hops from the failed set to every node, so the red wave can propagate outward. */
function waveDistances(
  devices: Device[],
  links: Link[],
  failed: string[],
): Map<string, number> {
  const adj = new Map<string, Set<string>>();
  for (const d of devices) adj.set(d.id, new Set());
  for (const l of links) {
    if (l.sourceId === l.targetId) continue;
    adj.get(l.sourceId)?.add(l.targetId);
    adj.get(l.targetId)?.add(l.sourceId);
  }
  const dist = new Map<string, number>();
  let frontier = failed.filter((id) => adj.has(id));
  for (const id of frontier) dist.set(id, 0);
  let depth = 0;
  while (frontier.length) {
    depth++;
    const next: string[] = [];
    for (const u of frontier) {
      for (const v of adj.get(u) ?? []) {
        if (!dist.has(v)) {
          dist.set(v, depth);
          next.push(v);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

interface SceneProps {
  devices: Device[];
  links: Link[];
  failed: string[];
  scale: number;
  onToggle: (id: string) => void;
}

/**
 * The Flow lens scene layer (rendered inside the viewport group, so it pans, zooms,
 * and projects for free). Reads the FULL device/link set — never the viewport-culled
 * arrays — so a blast that crosses off-screen is not clipped. Only opacity/transform
 * animate; the blast math is pure (`sim/blastRadius`).
 */
function FlowSceneOverlayImpl({ devices, links, failed, scale, onToggle }: SceneProps) {
  const [hover, setHover] = useState<string | null>(null);
  const result = useMemo(() => blastRadius(devices, links, failed), [devices, links, failed]);
  const byId = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);
  const dist = useMemo(() => waveDistances(devices, links, failed), [devices, links, failed]);
  const failedSet = result.failed;

  // Intent telegraph: the EXTRA devices that would drop if you also pulled `hover`.
  const preview = useMemo(() => {
    if (!hover || failedSet.has(hover)) return new Set<string>();
    const next = blastRadius(devices, links, [...failed, hover]).isolated;
    const extra = new Set<string>([hover]);
    for (const id of next) if (!result.isolated.has(id) && !failedSet.has(id)) extra.add(id);
    return extra;
  }, [hover, devices, links, failed, failedSet, result.isolated]);

  const sw = (n: number) => n / scale; // screen-constant stroke regardless of zoom
  const delay = (id: string) => `${(dist.get(id) ?? 0) * 70}ms`;

  return (
    <g className={styles.flowLayer}>
      {/* Dead links: the red wave marching out from the failure, hop by hop. */}
      {links.map((l) => {
        if (!result.deadLinks.has(l.id)) return null;
        const a = byId.get(l.sourceId);
        const b = byId.get(l.targetId);
        if (!a || !b) return null;
        const pa = center(a);
        const pb = center(b);
        const hop = Math.min(dist.get(l.sourceId) ?? 0, dist.get(l.targetId) ?? 0);
        return (
          <line
            key={`dead-${l.id}`}
            className={styles.flowDeadLink}
            x1={pa.x}
            y1={pa.y}
            x2={pb.x}
            y2={pb.y}
            strokeWidth={sw(2.75)}
            style={{ animationDelay: `${hop * 70}ms` }}
          />
        );
      })}

      {/* Reroute: the backups that light up — survivors' traffic finding the detour.
          Cyan (the signal channel), not red, so "held via a backup" reads as relief. */}
      {links.map((l) => {
        if (!result.rerouted.has(l.id)) return null;
        const a = byId.get(l.sourceId);
        const b = byId.get(l.targetId);
        if (!a || !b) return null;
        const pa = center(a);
        const pb = center(b);
        const hop = Math.min(dist.get(l.sourceId) ?? 0, dist.get(l.targetId) ?? 0);
        return (
          <line
            key={`reroute-${l.id}`}
            className={styles.flowRerouteLink}
            x1={pa.x}
            y1={pa.y}
            x2={pb.x}
            y2={pb.y}
            strokeWidth={sw(2.5)}
            style={{ animationDelay: `${hop * 70}ms` }}
          />
        );
      })}

      {/* Per-device status rings + the (always-present) hit targets. */}
      {devices.map((d) => {
        const c = center(d);
        const r = Math.max(d.width, d.height) / 2;
        const isFailed = failedSet.has(d.id);
        const isIsolated = result.isolated.has(d.id);
        const isPreview = !isFailed && !isIsolated && preview.has(d.id);
        const ringCls = isFailed
          ? styles.flowFailedRing
          : isIsolated
            ? styles.flowIsolatedRing
            : isPreview
              ? styles.flowPreviewRing
              : '';
        return (
          <g key={`flow-${d.id}`}>
            {ringCls && (
              <circle
                className={ringCls}
                cx={c.x}
                cy={c.y}
                r={r + sw(3)}
                strokeWidth={sw(2.5)}
                style={isIsolated ? { animationDelay: delay(d.id) } : undefined}
              />
            )}
            {isFailed && (
              <path
                className={styles.flowFailedMark}
                d={`M${c.x - r * 0.42} ${c.y - r * 0.42} L${c.x + r * 0.42} ${c.y + r * 0.42} M${c.x + r * 0.42} ${c.y - r * 0.42} L${c.x - r * 0.42} ${c.y + r * 0.42}`}
                strokeWidth={sw(2.75)}
              />
            )}
            <circle
              className={styles.flowHit}
              cx={c.x}
              cy={c.y}
              r={r}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (e.button === 0) onToggle(d.id);
              }}
              onPointerEnter={() => setHover(d.id)}
              onPointerLeave={() => setHover((h) => (h === d.id ? null : h))}
            />
          </g>
        );
      })}
    </g>
  );
}
export const FlowSceneOverlay = memo(FlowSceneOverlayImpl);

interface HudProps {
  devices: Device[];
  links: Link[];
  failed: string[];
  onExit: () => void;
  onReset: () => void;
}

/**
 * Screen-space HUD: the one-line verdict + the discoverability hint. Rendered outside
 * the viewport group so it stays put while the canvas pans. Esc exits the lens.
 */
export function FlowHud({ devices, links, failed, onExit, onReset }: HudProps) {
  const result = useMemo(() => blastRadius(devices, links, failed), [devices, links, failed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const lost = result.isolated.size;
  const rr = result.rerouted.size;
  let verdict: string;
  let tone: 'idle' | 'safe' | 'danger';
  if (failed.length === 0) {
    verdict = 'Click any device to pull it — watch what loses its connection.';
    tone = 'idle';
  } else if (lost === 0) {
    verdict =
      rr > 0
        ? `Holding — traffic rerouted over ${rr} backup link${rr === 1 ? '' : 's'}, 0 lost.`
        : `Holding — 0 devices lost${failed.length > 1 ? ` after ${failed.length} failures` : ''}.`;
    tone = 'safe';
  } else {
    verdict =
      `${lost} device${lost === 1 ? '' : 's'} isolated — no path to the network` +
      (rr > 0 ? `; ${rr} rerouted.` : '.');
    tone = 'danger';
  }

  return (
    <div className={styles.flowHud} data-canvas-chrome>
      <div className={styles.flowHudRow}>
        <span className={styles.flowHudBadge}>STRESS-TEST</span>
        <span className={`${styles.flowHudVerdict} ${styles[`flowTone_${tone}`]}`}>{verdict}</span>
      </div>
      <div className={styles.flowHudHint}>
        click to fail · again to restore
        {failed.length > 0 && (
          <>
            {' · '}
            <button className={styles.flowHudLink} onClick={onReset}>
              reset
            </button>
          </>
        )}
        {' · '}
        <button className={styles.flowHudLink} onClick={onExit}>
          Esc to exit
        </button>
      </div>
    </div>
  );
}
