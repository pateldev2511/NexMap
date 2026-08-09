/**
 * Absolute port geometry for the unified row canvas (W6b) — pure, no React.
 *
 * ONE source of truth on purpose. The drawn jacks and the hit targets must come
 * from the same computation, or you get the precise desync `PATCH_PORT_OPTS`
 * warns about in rackLayout.ts: a panel that DRAWS its ports in one place and
 * ACCEPTS clicks in another, so cabling lands on the wrong port. RowScene renders
 * from this array and RackRow hit-tests the same array.
 *
 * Coordinates are row-SVG user space (the same space `svgPoint` produces), so a
 * hit test needs no per-rack transform.
 */
import { bayOrigin, deviceRect, type Rect } from './rackLayout';
import { portAt } from './portHit';
import { portsHittable, type LodTier } from './lod';
import { devicePortLayout } from './rackDeviceArt';
import { slotOf } from './rackModel';
import type { PortTarget } from './portHit';
import type { Device, Rack } from '@/model/types';

/** The subset of the row's column layout this needs. */
export interface PortCol {
  rack: Rack;
  frontX: number;
  rearX: number;
}

/**
 * Every visible port across every rack in the row.
 *
 * Rear-mounted gear only contributes ports when the rear face is shown — cabling
 * to a port you cannot see would be a click into the void.
 */
export function rowPortTargets(
  cols: readonly PortCol[],
  devices: readonly Device[],
  showRear: boolean,
): PortTarget[] {
  const out: PortTarget[] = [];
  for (const col of cols) {
    for (const d of devices) {
      if (d.rackId !== col.rack.id || d.ru == null) continue;
      const slot = slotOf(d);
      // 0U rail gear (PDUs, vertical managers) has no faceplate jack grid.
      if (slot.mount === 'rail') continue;
      const face = slot.side ?? 'front';
      if (face === 'rear' && !showRear) continue;
      const colX = face === 'rear' ? col.rearX : col.frontX;
      const origin = bayOrigin(colX);
      const r = deviceRect(col.rack, d);
      const panel: Rect = { x: origin.x + r.x, y: origin.y + r.y, w: r.w, h: r.h };
      for (const pr of devicePortLayout(d, panel)) {
        out.push({
          deviceId: d.id,
          ifaceId: pr.ifaceId,
          x: pr.x,
          y: pr.y,
          w: pr.w,
          h: pr.h,
        });
      }
    }
  }
  return out;
}

/** Group targets by device, so a renderer can draw one device's jacks together. */
export function groupPortsByDevice(
  targets: readonly PortTarget[],
): Map<string, PortTarget[]> {
  const byDevice = new Map<string, PortTarget[]>();
  for (const t of targets) {
    const list = byDevice.get(t.deviceId);
    if (list) list.push(t);
    else byDevice.set(t.deviceId, [t]);
  }
  return byDevice;
}

/**
 * What a press on a device resolves to: a cable drag from a port, or a device move.
 *
 * Extracted as a PURE function on purpose. `pointer-native-canvas.md` establishes
 * that gestures are not proven by dispatching PointerEvents at jsdom (no pointer
 * capture, no real layout there) — the machine is proven headless, the adapters by
 * unit test, and the real drag by Playwright. This is the adapter DECISION, so it
 * belongs at the unit layer where it can be exhaustively covered.
 *
 * Arbiter priority is port > device, matching the focused editor. The tier gate is
 * E20: below `near` a jack is ~2px, and letting an invisible target win would turn
 * a device drag into a stray cable.
 */
export type PressResolution =
  | { kind: 'cable'; source: PortTarget }
  | { kind: 'device' };

export function resolvePress(opts: {
  tier: LodTier;
  /** False when the host provides no way to create a cable. */
  cablingEnabled: boolean;
  ports: readonly PortTarget[];
  /** Press point in row-SVG user space. */
  x: number;
  y: number;
}): PressResolution {
  if (!opts.cablingEnabled) return { kind: 'device' };
  if (!portsHittable(opts.tier)) return { kind: 'device' };
  const hit = portAt([...opts.ports], opts.x, opts.y);
  return hit ? { kind: 'cable', source: hit } : { kind: 'device' };
}

/**
 * Whether a drop should create a cable. A drop on nothing, or back on the source
 * port, is a changed mind rather than an error — it must connect nothing and
 * report nothing.
 */
export function resolveDrop(
  source: PortTarget,
  ports: readonly PortTarget[],
  x: number,
  y: number,
): PortTarget | null {
  const target = portAt([...ports], x, y);
  if (!target) return null;
  if (target.deviceId === source.deviceId && target.ifaceId === source.ifaceId) return null;
  return target;
}
