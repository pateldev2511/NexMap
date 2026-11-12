import { memo, useMemo, useState } from 'react';
import type { Device, Link } from '@/model/types';
import { center } from './connector';
import { blastRadius, blastVerdict, isEgressType } from '@/sim/blastRadius';
import { useProjectStore } from '@/store/projectStore';
import styles from './Canvas.module.css';

/** The chosen Flow destination as blast options — ignored once it isn't in the diagram. */
function useFlowTargets(devices: Device[]): string[] | undefined {
  const target = useProjectStore((s) => s.flowTarget);
  return useMemo(
    () => (target && devices.some((d) => d.id === target) ? [target] : undefined),
    [target, devices],
  );
}

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
  /**
   * A press on a device's hit target. The canvas owns what it means (#87): a press
   * that never moves toggles the failure on release; one that moves pans instead.
   */
  onDevicePointerDown: (e: React.PointerEvent, id: string) => void;
}

/**
 * The Flow lens scene layer (rendered inside the viewport group, so it pans, zooms,
 * and projects for free). Reads the FULL device/link set — never the viewport-culled
 * arrays — so a blast that crosses off-screen is not clipped. Only opacity/transform
 * animate; the blast math is pure (`sim/blastRadius`).
 */
function FlowSceneOverlayImpl({ devices, links, failed, scale, onDevicePointerDown }: SceneProps) {
  const [hover, setHover] = useState<string | null>(null);
  const targets = useFlowTargets(devices);
  const result = useMemo(
    () => blastRadius(devices, links, failed, { targets }),
    [devices, links, failed, targets],
  );
  const byId = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);
  const dist = useMemo(() => waveDistances(devices, links, failed), [devices, links, failed]);
  const failedSet = result.failed;
  const destinations = useMemo(() => new Set(result.destinations), [result.destinations]);

  // Intent telegraph: the EXTRA devices that would drop if you also pulled `hover`.
  const preview = useMemo(() => {
    if (!hover || failedSet.has(hover)) return new Set<string>();
    const next = blastRadius(devices, links, [...failed, hover], { targets }).isolated;
    const extra = new Set<string>([hover]);
    for (const id of next) if (!result.isolated.has(id) && !failedSet.has(id)) extra.add(id);
    return extra;
  }, [hover, devices, links, failed, failedSet, result.isolated, targets]);

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
              : destinations.has(d.id)
                ? styles.flowTargetRing
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
              data-flow-hit={d.id}
              cx={c.x}
              cy={c.y}
              r={r}
              onPointerDown={(e) => onDevicePointerDown(e, d.id)}
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
 * the viewport group so it stays put while the canvas pans. Esc exits the lens —
 * through the keyboard router's canvas stage (Canvas.handleCanvasKey), so a dialog,
 * menu or in-flight gesture above it gets the key first (#87). The router steps
 * aside for a focused <select>, so the destination picker handles its own Escape.
 */
export function FlowHud({ devices, links, failed, onExit, onReset }: HudProps) {
  const targets = useFlowTargets(devices);
  const setTarget = useProjectStore((s) => s.setFlowTarget);
  const result = useMemo(
    () => blastRadius(devices, links, failed, { targets }),
    [devices, links, failed, targets],
  );

  const byId = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);
  const { verdict, tone, counts, destination } = blastVerdict(
    result,
    (id) => byId.get(id)?.name || 'Unnamed',
    !!targets,
  );

  // Destinations worth asking about: exits (ISP, gateways, routers…) first, then any
  // other linked device — a server or service is a fair "can it still reach this?".
  const { exits, others } = useMemo(() => {
    const linked = new Set(links.flatMap((l) => [l.sourceId, l.targetId]));
    const byName = (a: Device, b: Device) => a.name.localeCompare(b.name);
    const candidates = devices.filter((d) => linked.has(d.id));
    return {
      exits: candidates.filter((d) => isEgressType(d.type)).sort(byName),
      others: candidates.filter((d) => !isEgressType(d.type)).sort(byName),
    };
  }, [devices, links]);

  return (
    <div className={styles.flowHud} data-canvas-chrome>
      <div className={styles.flowHudRow}>
        <span className={styles.flowHudBadge}>STRESS-TEST</span>
        <span
          className={`${styles.flowHudVerdict} ${styles[`flowTone_${tone}`]}`}
          role="status"
          aria-live="polite"
        >
          {verdict}
          {counts && <span className={styles.flowHudCounts}>{counts}</span>}
        </span>
      </div>
      <div className={styles.flowHudHint}>
        <label className={styles.flowHudTarget}>
          reach to{' '}
          <select
            className={styles.flowHudSelect}
            value={targets?.[0] ?? ''}
            onChange={(e) => setTarget(e.target.value || null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onExit();
            }}
            aria-label="Destination to measure reachability to"
          >
            <option value="">{targets ? 'any exit' : destination}</option>
            {exits.length > 0 && (
              <optgroup label="Exits">
                {exits.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name || 'Unnamed'}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Other devices">
                {others.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name || 'Unnamed'}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        {' · '}
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
