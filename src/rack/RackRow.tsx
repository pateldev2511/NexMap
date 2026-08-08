/**
 * Multi-rack ROW view (schema v3). Renders every rack side by side in ONE interactive SVG
 * so cross-rack cables can be drawn between cabinets. Each rack shows BOTH faces as two
 * adjacent columns (Front | Rear) so nothing on the back is hidden. This is the overview:
 * devices are labeled blocks (not port-level detail — that lives in the focused editor).
 * Click a rack/device to focus + select it; reorder cabinets with the ◀ ▶ chevrons.
 * Per-rack U + power/weight budget is shown inline.
 *
 * Input (M4d): all pointer work runs on the shared gesture machine — the same
 * skeleton as the flat canvas and the focused rack editor. Gestures here:
 *   'pan'     — press on background/face; below threshold = click (drill into
 *               the rack); past it = pan. Middle/right always pan.
 *   'moveDev' — press on a device; below threshold = select (+focus); past it
 *               = cross-rack drag with a live drop preview (green = the span
 *               is free at the hovered U, red = it will fall back to the
 *               nearest free U / be rejected). Commit calls onMoveDeviceToRack.
 * Machine coords are CLIENT px (like RackCanvas). Capture lives on the
 * container, so native clicks retarget there — face/device clicks are routed
 * through machine click effects, NOT DOM onClick.
 *
 * Perf (M4f): pan/zoom only changes the CSS transform on the <svg>; the whole
 * scene (shell/device innerHTML art, cables, budgets) lives in the memoized
 * RowScene below, whose props are all identity-stable across viewport frames.
 * rowScene.perf.test.tsx pins this: wheel-panning must not call the art
 * generators again.
 */
import { useRef, useState, useEffect, useMemo, useCallback, memo } from 'react';
import type { Device, Rack, RackCable } from '@/model/types';
import { fit, panBy, zoomAt, zoomTo, type Viewport, IDENTITY } from './viewport';
import { normalizeWheel, resolveWheel } from '@/input/wheel';
import { getWheelAction } from '@/lib/prefs';
import {
  reduce,
  IDLE,
  ownsPointer,
  type MachineState,
  type MachineEvent,
  type Effect as MachineEffect,
  type PointerKind,
} from '@/input/machine';
import { markGestureComplete } from '@/input/quiet';
import type { RackGestureApi } from './RackCanvas';
import { consumeRackWheelHint, RACK_WHEEL_HINT_EVENT } from './wheelHint';
import {
  cabinetSize,
  bayOrigin,
  deviceRect,
  uLabelCenterY,
  U_PX,
  BAY_W,
  FRAME_PAD,
  RACK_GUTTER,
} from './rackLayout';
import { isFullDepth, slotOf, canFit, nearestFreeU, type Slot } from './rackModel';
import { rackBudget, occupiedUnits } from './rackBudget';
import { deviceFaceParts, deviceOppositeFaceParts, devicePortLayout, rackShellParts, RACK_ART_DEFS } from './rackDeviceArt';
import { deviceColorBy, type ColorByMode } from './rackColorBy';
import { cablePath } from './cablePath';
import styles from './RackDesigner.module.css';

export interface RackRowProps {
  racks: Rack[];
  devices: Device[];
  cables: RackCable[];
  activeRackId?: string;
  selectedId: string | null;
  selectedIds?: Set<string>;
  searchHits: Set<string>;
  showRear: boolean;
  colorBy: ColorByMode;
  onFocusRack: (rackId: string) => void;
  onSelect: (deviceId: string | null, additive?: boolean) => void;
  onReorder: (rackId: string, dir: -1 | 1) => void;
  /** Cross-rack pointer drag lands here; wantedU is the hovered U (bottom of the span). */
  onMoveDeviceToRack?: (deviceId: string, rackId: string, wantedU?: number) => void;
  /** Filled while mounted so Escape / undo routing can cancel an in-flight drag. */
  gestureApi?: React.MutableRefObject<RackGestureApi | null>;
}

/** Gap between the front and rear columns of the SAME rack (tighter than between racks). */
const FACE_GAP = 22;

type PanData = { tx: number; ty: number; faceRackId: string | null; button: number };
type MoveData = { deviceId: string; slot: Slot; name: string; fromRackId: string; additive: boolean };
type DropTarget = { rackId: string; colX: number; u: number; ok: boolean; reason: string | null };
type DragState = { deviceId: string; span: number; name: string; target: DropTarget | null };
type Col = { rack: Rack; frontX: number; rearX: number; size: ReturnType<typeof cabinetSize> };

/**
 * Everything INSIDE the row svg except the drop preview. Memoized (M4f): all
 * props hold identity across pan/zoom frames (cols/devices/cables are
 * rev-memoized upstream, callbacks are stable), so viewport changes re-render
 * only the transform wrapper — not N racks × M devices of innerHTML art.
 */
const RowScene = memo(function RowScene({
  cols, devices, cables, activeRackId, selectedId, selectedIds, searchHits, showRear, colorBy,
  dragRackId, dimmedId, onDevDown, onReorder,
}: {
  cols: Col[];
  devices: Device[];
  cables: RackCable[];
  activeRackId?: string;
  selectedId: string | null;
  selectedIds?: Set<string>;
  searchHits: Set<string>;
  showRear: boolean;
  colorBy: ColorByMode;
  /** Highlighted drop-target rack during a cross-rack device drag. */
  dragRackId: string | null;
  /** Device being dragged over another rack (rendered faded at its old slot). */
  dimmedId: string | null;
  onDevDown: (e: React.PointerEvent, d: Device, rack: Rack) => void;
  onReorder: (rackId: string, dir: -1 | 1) => void;
}) {
  if (import.meta.env.MODE === 'test') {
    (globalThis as { __rowSceneRenders?: number }).__rowSceneRenders =
      ((globalThis as { __rowSceneRenders?: number }).__rowSceneRenders ?? 0) + 1;
  }
  // `${deviceId}:${ifaceId}` → visible port/NIC center, for cable routing. Rear devices are
  // only cabled when the rear face is shown.
  const portCenter = new Map<string, { x: number; y: number }>();
  const deviceCenter = new Map<string, { x: number; y: number }>();
  const rackOf = new Map<string, string>();
  for (const c of cols) {
    for (const d of devices) {
      if (d.rackId !== c.rack.id || d.ru == null) continue;
      const isRear = slotOf(d).side === 'rear';
      if (isRear && !showRear) continue;
      const colX = isRear ? c.rearX : c.frontX;
      const origin = bayOrigin(colX);
      const r = deviceRect(c.rack, d);
      const panel = { x: origin.x + r.x, y: origin.y + r.y, w: r.w, h: r.h };
      deviceCenter.set(d.id, { x: panel.x + panel.w / 2, y: panel.y + panel.h / 2 });
      for (const j of devicePortLayout(d, panel)) {
        portCenter.set(`${d.id}:${j.ifaceId}`, { x: j.x + j.w / 2, y: j.y + j.h / 2 });
      }
      rackOf.set(d.id, c.rack.id);
    }
  }

  const renderFace = (rack: Rack, originX: number, face: 'front' | 'rear') => {
    const origin = bayOrigin(originX);
    const bayH = rack.ruHeight * U_PX;
    const size = cabinetSize(rack);
    return (
      // Whole face is a click target → drill into the focused editor, routed
      // through the machine's click effect (capture retargets native clicks).
      <g
        key={`${rack.id}-${face}`}
        data-rack-face={`${rack.id}-${face}`}
        style={{ cursor: 'pointer' }}
      >
        <g dangerouslySetInnerHTML={{
          __html: rackShellParts({
            rackName: rack.name,
            ruHeight: rack.ruHeight,
            face,
            x: originX,
            y: 0,
            width: size.width,
            height: size.height,
            bayX: origin.x,
            bayY: origin.y,
            bayW: BAY_W,
            bayH,
            active: rack.id === activeRackId,
            title: true,
          }).join(''),
        }} />
        {dragRackId === rack.id && (
          <rect
            x={originX + 5}
            y={5}
            width={size.width - 10}
            height={size.height - 10}
            rx={8}
            fill="color-mix(in srgb, var(--accent) 10%, transparent)"
            stroke="var(--accent)"
            strokeDasharray="7 4"
            strokeWidth={2}
            pointerEvents="none"
          />
        )}
        {/* U ticks (every 5) */}
        {Array.from({ length: rack.ruHeight }, (_, k) => k + 1).filter((u) => u % 5 === 0 || u === 1).map((u) => (
          <text key={u} x={origin.x - 23} y={origin.y + uLabelCenterY(rack, u) + 3} textAnchor="end" fontSize={8} fontFamily="var(--font-mono)" fill="var(--chrome-fg-muted)">{u}</text>
        ))}
        {/* occupancy heatmap — a per-U track on the left edge: filled = used, faint = free */}
        {(() => {
          const occ = occupiedUnits(rack, devices, face);
          return Array.from({ length: rack.ruHeight }, (_, k) => k + 1).map((u) => (
            <rect
              key={`heat-${u}`}
              x={origin.x - 10.5}
              y={origin.y + uLabelCenterY(rack, u) - U_PX / 2 + 0.5}
              width={2.5}
              height={U_PX - 1}
              fill={occ.has(u) ? '#22c55e' : '#475569'}
              fillOpacity={occ.has(u) ? 0.6 : 0.22}
            />
          ));
        })()}
        {/* Opposite-face context: when both faces are visible, only full-depth gear spans
            into the other aisle; when rear is hidden, rear-mounted gear is hinted on front. */}
        {devices
          .filter((d) => {
            if (d.rackId !== rack.id || d.ru == null || slotOf(d).side === face || slotOf(d).mount === 'rail') return false;
            if (!showRear) return face === 'front';
            return isFullDepth(d.type);
          })
          .map((d) => {
            const r = deviceRect(rack, d);
            const panel = { x: origin.x + r.x, y: origin.y + r.y, w: r.w, h: r.h };
            return <g key={`opposite-${d.id}`} pointerEvents="none" dangerouslySetInnerHTML={{ __html: deviceOppositeFaceParts(d, panel, face).join('') }} />;
          })}
        {/* devices on this face — realistic shared art + select/search overlay */}
        {devices.filter((d) => d.rackId === rack.id && d.ru != null && slotOf(d).side === face).map((d) => {
          const r = deviceRect(rack, d);
          const panel = { x: origin.x + r.x, y: origin.y + r.y, w: r.w, h: r.h };
          const sel = d.id === selectedId || (selectedIds?.has(d.id) ?? false);
          const anySel = selectedId != null || (selectedIds?.size ?? 0) > 0;
          // `dimmedId` is the drag ghost and must win; focus dimming is the weaker,
          // wider demotion applied to everything the selection isn't.
          const focusDim = anySel && !sel;
          const hit = searchHits.has(d.id);
          return (
            <g
              key={d.id}
              data-dev-id={d.id}
              onPointerDown={(e) => onDevDown(e, d, rack)}
              style={{ cursor: 'grab' }}
              opacity={dimmedId === d.id ? 0.35 : focusDim ? 0.42 : 1}
            >
              <g dangerouslySetInnerHTML={{ __html: deviceFaceParts(d, panel, face).join('') }} />
              {colorBy !== 'gear' && (() => {
                const tint = deviceColorBy(d, colorBy);
                return tint ? <rect x={panel.x} y={panel.y} width={panel.w} height={panel.h} rx={3} fill={tint} fillOpacity={0.6} pointerEvents="none" /> : null;
              })()}
              <rect x={panel.x} y={panel.y} width={panel.w} height={panel.h} fill="transparent" />
              {(sel || hit) && (
                <rect x={panel.x} y={panel.y} width={panel.w} height={panel.h} rx={3} fill="none"
                  stroke={sel ? 'var(--accent)' : '#f59e0b'} strokeWidth={2} pointerEvents="none" />
              )}
            </g>
          );
        })}
      </g>
    );
  };

  return (
    <>
      {cols.map((c, i) => {
        const b = rackBudget(c.rack, devices);
        const bayH = c.rack.ruHeight * U_PX;
        const groupRight = (showRear ? c.rearX : c.frontX) + c.size.width;
        return (
          <g key={c.rack.id}>
            {renderFace(c.rack, c.frontX, 'front')}
            {showRear && renderFace(c.rack, c.rearX, 'rear')}
            {/* reorder chevrons over the rack group — real buttons: keyboard
                reachable (Enter/Space), 24px hit target, not just a 13px glyph */}
            {i > 0 && (
              <g
                role="button"
                tabIndex={0}
                aria-label={`Move ${c.rack.name} left`}
                style={{ cursor: 'pointer' }}
                onClick={() => onReorder(c.rack.id, -1)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onReorder(c.rack.id, -1); }
                }}
              >
                <rect x={c.frontX} y={c.size.height + 2} width={24} height={20} fill="transparent" />
                <text x={c.frontX + 10} y={c.size.height + 14} fontSize={13} fill="var(--accent)">◀</text>
              </g>
            )}
            {i < cols.length - 1 && (
              <g
                role="button"
                tabIndex={0}
                aria-label={`Move ${c.rack.name} right`}
                style={{ cursor: 'pointer' }}
                onClick={() => onReorder(c.rack.id, 1)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onReorder(c.rack.id, 1); }
                }}
              >
                <rect x={groupRight - 24} y={c.size.height + 2} width={24} height={20} fill="transparent" />
                <text x={groupRight - 16} y={c.size.height + 14} fontSize={13} fill="var(--accent)">▶</text>
              </g>
            )}
            {/* whole-rack budget under the front column */}
            <text x={bayOrigin(c.frontX).x} y={FRAME_PAD + bayH + 16} fontSize={10} fontFamily="var(--font-mono)" fill={b.overWatts || b.overWeight ? '#dc2626' : 'var(--chrome-fg-muted)'}>
              {b.usedU}/{c.rack.ruHeight}U · {b.freeU} free{b.maxWatts != null ? ` · ${b.watts}/${b.maxWatts}W` : b.watts ? ` · ${b.watts}W` : ''}{b.maxWeightKg != null ? ` · ${b.weightKg}/${b.maxWeightKg}kg` : ''}
            </text>
          </g>
        );
      })}

      {/* cables — intra-rack bow, cross-rack arc up and over the gap */}
      {cables.map((c, idx) => {
        const pa = portCenter.get(`${c.aEnd.deviceId}:${c.aEnd.ifaceId}`) ?? deviceCenter.get(c.aEnd.deviceId);
        const pb = portCenter.get(`${c.bEnd.deviceId}:${c.bEnd.ifaceId}`) ?? deviceCenter.get(c.bEnd.deviceId);
        if (!pa || !pb) return null;
        const crossRack = rackOf.get(c.aEnd.deviceId) !== rackOf.get(c.bEnd.deviceId);
        const { d } = cablePath(pa, pb, idx, crossRack);
        return (
          <g key={c.id} pointerEvents="none">
            <path d={d} fill="none" stroke="#020617" strokeWidth={7} strokeLinecap="round" opacity={0.22} filter="url(#rkCableShadow)" />
            <path d={d} fill="none" stroke="#f8fafc" strokeWidth={5.2} strokeLinecap="round" opacity={0.82} />
            <path d={d} fill="none" stroke={c.color} strokeWidth={3} strokeLinecap="round" />
            <path d={d} fill="none" stroke="#ffffff" strokeWidth={0.8} strokeLinecap="round" opacity={0.45} />
            <circle cx={pa.x} cy={pa.y} r={3.8} fill="#0f172a" stroke="#f8fafc" strokeWidth={1} />
            <circle cx={pb.x} cy={pb.y} r={3.8} fill="#0f172a" stroke="#f8fafc" strokeWidth={1} />
            <circle cx={pa.x} cy={pa.y} r={2} fill={c.color} />
            <circle cx={pb.x} cy={pb.y} r={2} fill={c.color} />
          </g>
        );
      })}
    </>
  );
});

export function RackRow({
  racks, devices, cables, activeRackId, selectedId, selectedIds, searchHits, showRear, colorBy,
  onFocusRack, onSelect, onReorder, onMoveDeviceToRack, gestureApi,
}: RackRowProps) {
  const [dragRackId, setDragRackId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  // Front (and optionally rear) column per rack, laid out left-to-right.
  // Memoized so the RowScene's props hold identity across viewport frames.
  const { cols, width, height } = useMemo(() => {
    let x = 0;
    let h = 0;
    const cs: Col[] = racks.map((rack) => {
      const size = cabinetSize(rack);
      const frontX = x;
      const rearX = showRear ? x + size.width + FACE_GAP : x;
      x = (showRear ? rearX + size.width : frontX + size.width) + RACK_GUTTER;
      h = Math.max(h, size.height);
      return { rack, frontX, rearX, size };
    });
    return { cols: cs, width: Math.max(0, x - RACK_GUTTER), height: h };
  }, [racks, showRear]);

  // ── Pan / zoom viewport ─────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [vp, setVp] = useState<Viewport>(IDENTITY);
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const content = { w: width, h: height + 18 };
  const rect = () => containerRef.current?.getBoundingClientRect();

  function fitNow() {
    const r = rect();
    if (r) setVp(fit(content.w, content.h, r.width, r.height));
  }
  // Fit on first mount (content + container measured by then).
  useEffect(() => {
    fitNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Wheel contract (shared with the flat canvas): plain wheel PANS by default
  // per DA-DES-5.1, ctrl/pinch zooms at the cursor; the Settings wheelAction
  // pref flips plain wheel to zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // One-time migration hint for returning users: their wheel used to zoom.
      if (consumeRackWheelHint()) window.dispatchEvent(new CustomEvent(RACK_WHEEL_HINT_EVENT));
      const n = normalizeWheel(e);
      const intent = resolveWheel(n, getWheelAction());
      if (intent.kind === 'zoom') {
        const r = el.getBoundingClientRect();
        setVp((v) => zoomAt(v, intent.factor, e.clientX - r.left, e.clientY - r.top));
      } else {
        setVp((v) => panBy(v, -intent.dx, -intent.dy));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Window blur mid-gesture = cancel (Cmd+Tab, Mission Control): pointer
  // events stop arriving, so without this the gesture dangles with capture
  // held. The machine's 'blur' path was unit-pinned but never wired.
  useEffect(() => {
    const onBlur = () => {
      if (machine.current.phase !== 'idle') dispatchRef.current({ type: 'blur' });
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  // ── Gesture machine (M4d) ───────────────────────────────────────────────────
  const machine = useRef<MachineState>(IDLE);
  const dispatchRef = useRef<(e: MachineEvent, mods?: { alt?: boolean; shift?: boolean }) => void>(() => {});
  const suppressMenu = useRef(false);
  const panPrev = useRef({ x: 0, y: 0 });

  /** Client px → SVG user space (the svg carries the pan/zoom CSS transform). */
  const svgPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const scale = vpRef.current.scale || 1;
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  };

  /** Which rack column + U is under this client point (null = aisle/background/outside the bay). */
  const hitTarget = (clientX: number, clientY: number): { col: Col; u: number } | null => {
    const p = svgPoint(clientX, clientY);
    for (const c of cols) {
      let colX: number | null = null;
      if (p.x >= c.frontX && p.x <= c.frontX + c.size.width) colX = c.frontX;
      else if (showRear && p.x >= c.rearX && p.x <= c.rearX + c.size.width) colX = c.rearX;
      if (colX == null) continue;
      const origin = bayOrigin(colX);
      // Outside the bay vertically (rack title, budget line) is NOT a target —
      // clamping here would show a confident preview the user isn't aiming at.
      if (p.y < origin.y || p.y > origin.y + c.rack.ruHeight * U_PX) return null;
      const fromTop = Math.floor((p.y - origin.y) / U_PX);
      const u = Math.max(1, Math.min(c.rack.ruHeight, c.rack.ruHeight - fromTop));
      return { col: c, u };
    }
    return null;
  };

  const runMachineEffect = (ef: MachineEffect): void => {
    switch (ef.kind) {
      case 'capture':
        containerRef.current?.setPointerCapture?.(ef.pointerId);
        break;
      case 'release':
        try {
          containerRef.current?.releasePointerCapture?.(ef.pointerId);
        } catch {
          /* not captured here — fine */
        }
        break;
      case 'begin':
        if (ef.gesture === 'pan') {
          // Delta-from-previous (like the other canvases): survives a
          // machine-seeded survivor pan (data null) and never stomps
          // concurrent viewport writers with an arm-time snapshot.
          panPrev.current = { x: ef.x, y: ef.y };
        } else if (ef.gesture === 'moveDev') {
          const d = ef.data as MoveData;
          const next = { deviceId: d.deviceId, span: d.slot.ruSpan, name: d.name, target: null };
          dragRef.current = next; // ref first: commit may land before React flushes
          setDrag(next);
        }
        break;
      case 'update':
        if (ef.gesture === 'pan') {
          const prev = panPrev.current;
          panPrev.current = { x: ef.x, y: ef.y };
          setVp((v) => panBy(v, ef.x - prev.x, ef.y - prev.y));
        } else if (ef.gesture === 'moveDev') {
          const d = ef.data as MoveData;
          const cur = dragRef.current;
          if (!cur) break;
          const t = hitTarget(ef.x, ef.y);
          // Only a DIFFERENT rack is a drop target — same-rack repositioning
          // lives in the focused editor, and previewing it here would lie.
          if (!t || t.col.rack.id === d.fromRackId) {
            setDragRackId(null);
            const cleared = { ...cur, target: null };
            dragRef.current = cleared;
            setDrag(cleared);
            break;
          }
          const rack = t.col.rack;
          const sl = d.slot;
          // Validate with the SAME predicate the commit uses (canFit on the
          // device's own side/bay/depth/mount — the move KEEPS its side, so
          // hovered-face occupancy would lie about full-depth and rail gear).
          const uMax = rack.ruHeight - sl.ruSpan + 1;
          const u = Math.max(1, Math.min(t.u, Math.max(1, uMax)));
          const occupants = devices.filter((x) => x.rackId === rack.id);
          const fit = canFit(rack, occupants, { ...sl, ru: u }, d.deviceId);
          let reason: string | null = null;
          if (!fit.ok) {
            const alt = nearestFreeU(rack, occupants, sl.ruSpan, u, sl.side, sl.bay, sl.depth, d.deviceId, sl.mount);
            reason = alt != null ? `U${u} blocked — will land at U${alt}` : `no room in ${rack.name}`;
          }
          // Preview draws in the column of the device's OWN side (where it
          // will actually land), not the hovered column.
          const colX = sl.side === 'rear' ? t.col.rearX : t.col.frontX;
          setDragRackId(rack.id);
          const next = { ...cur, target: { rackId: rack.id, colX, u, ok: fit.ok, reason } };
          dragRef.current = next;
          setDrag(next);
        }
        break;
      case 'commit':
        markGestureComplete(); // earned quiet (M3c)
        if (ef.gesture === 'pan') {
          // Null data = machine-seeded survivor pan (touch, never a right-drag).
          const d = ef.data as PanData | null;
          if (d?.button === 2) suppressMenu.current = true; // no menu after a real right-pan
        } else if (ef.gesture === 'moveDev') {
          const d = ef.data as MoveData;
          const t = dragRef.current?.target ?? null;
          dragRef.current = null;
          setDrag(null);
          setDragRackId(null);
          if (t) onMoveDeviceToRack?.(d.deviceId, t.rackId, t.u);
        }
        break;
      case 'cancel':
        if (ef.gesture === 'moveDev') {
          dragRef.current = null;
          setDrag(null);
          setDragRackId(null);
        }
        break;
      case 'click':
        if (ef.gesture === 'pan') {
          const d = ef.data as PanData | null;
          if (d?.button === 0 && d.faceRackId) onFocusRack(d.faceRackId);
        } else if (ef.gesture === 'moveDev') {
          const d = ef.data as MoveData;
          dragRef.current = null;
          setDrag(null);
          onSelect(d.deviceId, d.additive);
          if (!d.additive) onFocusRack(d.fromRackId); // shift/cmd builds a selection without drilling in
        }
        break;
      case 'pinchUpdate': {
        // Two-finger touch: centroid delta pans, distance ratio zooms at the
        // centroid (same 1% deadband as the other canvases — touch points
        // update in alternating events, so plain pans oscillate the distance).
        const r = rect();
        const ox = r?.left ?? 0;
        const oy = r?.top ?? 0;
        const cx = (ef.a.x + ef.b.x) / 2 - ox;
        const cy = (ef.a.y + ef.b.y) / 2 - oy;
        const pcx = (ef.prevA.x + ef.prevB.x) / 2 - ox;
        const pcy = (ef.prevA.y + ef.prevB.y) / 2 - oy;
        const dist = Math.hypot(ef.a.x - ef.b.x, ef.a.y - ef.b.y);
        const prevDist = Math.hypot(ef.prevA.x - ef.prevB.x, ef.prevA.y - ef.prevB.y);
        const ratio = prevDist > 0 ? dist / prevDist : 1;
        const zooming = Math.abs(ratio - 1) > 0.01;
        setVp((v) => {
          const panned = panBy(v, cx - pcx, cy - pcy);
          return zooming ? zoomAt(panned, ratio, cx, cy) : panned;
        });
        break;
      }
      case 'pinchEnd':
        markGestureComplete();
        break;
      default:
        break; // begin(pan)/pinchStart/swallowClick need no DOM work here
    }
  };
  dispatchRef.current = (e: MachineEvent, mods?: { alt?: boolean; shift?: boolean }) => {
    const r = reduce(machine.current, e, mods);
    machine.current = r.state;
    for (const ef of r.effects) runMachineEffect(ef);
  };

  // Escape / undo-mid-drag routing (the designer's keyboard handler drives this).
  useEffect(() => {
    if (!gestureApi) return;
    gestureApi.current = {
      cancel: () => dispatchRef.current({ type: 'escape' }),
      active: () => machine.current.phase !== 'idle',
    };
    return () => {
      gestureApi.current = null;
    };
  }, [gestureApi]);

  // Stable (touches refs only) so RowScene's memo isn't defeated by identity churn.
  const onDevDown = useCallback((e: React.PointerEvent, d: Device, rack: Rack) => {
    if (machine.current.phase !== 'idle') return; // container routes second pointers
    if (e.button !== 0) return; // middle/right bubble to the container pan
    e.stopPropagation();
    dispatchRef.current({
      type: 'arm',
      gesture: 'moveDev',
      data: {
        deviceId: d.id,
        slot: slotOf(d),
        name: d.name,
        fromRackId: rack.id,
        additive: e.shiftKey || e.metaKey || e.ctrlKey,
      } satisfies MoveData,
      swallowTrailingClick: true,
      pointerId: e.pointerId,
      pointerType: e.pointerType as PointerKind,
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  function onContainerDown(e: React.PointerEvent) {
    if (machine.current.phase !== 'idle') {
      // Second pointer: the machine decides (touch → pinch, mouse → ignored).
      dispatchRef.current({
        type: 'down',
        pointerId: e.pointerId,
        pointerType: e.pointerType as PointerKind,
        button: e.button,
        x: e.clientX,
        y: e.clientY,
      });
      return;
    }
    const t = e.target as Element;
    // Chevron buttons and the zoom cluster keep their native clicks — arming
    // would capture the pointer and retarget those clicks away from them.
    if (t.closest('[data-canvas-chrome]') || t.closest('g[role="button"]')) return;
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    const faceAttr = t.closest('[data-rack-face]')?.getAttribute('data-rack-face') ?? null;
    dispatchRef.current({
      type: 'arm',
      gesture: 'pan',
      data: {
        tx: vpRef.current.tx,
        ty: vpRef.current.ty,
        faceRackId: faceAttr ? faceAttr.replace(/-(front|rear)$/, '') : null,
        button: e.button,
      } satisfies PanData,
      swallowTrailingClick: true,
      pointerId: e.pointerId,
      pointerType: e.pointerType as PointerKind,
      x: e.clientX,
      y: e.clientY,
    });
  }
  function onContainerMove(e: React.PointerEvent) {
    if (machine.current.phase === 'idle') return;
    dispatchRef.current(
      {
        type: 'move',
        pointerId: e.pointerId,
        buttons: e.buttons,
        x: e.clientX,
        y: e.clientY,
      },
      { alt: e.altKey, shift: e.shiftKey },
    );
  }
  function onContainerUp(e: React.PointerEvent) {
    if (machine.current.phase === 'idle') return;
    dispatchRef.current(
      { type: 'up', pointerId: e.pointerId, x: e.clientX, y: e.clientY },
      { alt: e.altKey, shift: e.shiftKey },
    );
  }
  function onContextMenu(e: React.MouseEvent) {
    if (suppressMenu.current) {
      e.preventDefault();
      suppressMenu.current = false;
    }
  }
  const zoomStep = (k: number) => {
    const r = rect();
    setVp((v) => zoomTo(v, v.scale * k, r?.width ?? 800, r?.height ?? 600));
  };

  /** Live drop preview: the device's U-span outlined at the hovered bay. */
  const renderDropPreview = () => {
    const t = drag?.target;
    if (!drag || !t) return null;
    const col = cols.find((c) => c.rack.id === t.rackId);
    if (!col) return null;
    const origin = bayOrigin(t.colX);
    const y = origin.y + (col.rack.ruHeight - (t.u + drag.span - 1)) * U_PX;
    const h = drag.span * U_PX;
    const color = t.ok ? '#22c55e' : '#f59e0b';
    const label = `${drag.name} → U${t.u}${drag.span > 1 ? `–U${t.u + drag.span - 1}` : ''}${t.reason ? ` · ${t.reason}` : ''}`;
    return (
      <g pointerEvents="none" data-testid="row-drop-preview">
        <rect x={origin.x} y={y} width={BAY_W} height={h} rx={3}
          fill={color} fillOpacity={0.14} stroke={color} strokeWidth={1.5} strokeDasharray="5 3" />
        {/* Label sits on an opaque theme plate — raw green/amber 9px text on
            the light canvas was ~2:1 contrast; the outline still carries the
            ok/blocked color and the reason text is the non-color cue. */}
        <rect x={origin.x} y={y - 17} width={label.length * 6.2 + 10} height={14} rx={3}
          fill="var(--chrome-bg)" stroke={color} strokeWidth={1} />
        <text x={origin.x + 5} y={y - 6.5} fontSize={10} fontFamily="var(--font-mono)"
          fill="var(--chrome-fg)">
          {label}
        </text>
      </g>
    );
  };

  return (
    <div
      ref={containerRef}
      className={styles.panCanvas}
      data-canvas-surface
      tabIndex={-1} /* programmatic focus target: Escape/menu-close land here */
      onPointerDown={onContainerDown}
      onPointerMove={onContainerMove}
      onPointerUp={onContainerUp}
      onPointerCancel={() => dispatchRef.current({ type: 'cancel' })}
      onClickCapture={(e) => {
        // Make the machine's trailing-click swallow REAL (it was designed and
        // tested but never wired): after a commit that requested it, the next
        // native click is consumed here. Capture retargeting usually eats the
        // click first — this covers gestures that start AND end on the same
        // element with its own onClick.
        if (machine.current.swallowNextClick) {
          e.preventDefault();
          e.stopPropagation();
        }
        dispatchRef.current({ type: 'nativeclick' });
      }}
      onLostPointerCapture={(e) => {
        // Only a loss of the pointer the machine still OWNS cancels — the
        // browser also fires this for fingers the machine itself released
        // (pinch → survivor pan must keep panning).
        if (machine.current.phase !== 'idle' && ownsPointer(machine.current, e.pointerId)) {
          dispatchRef.current({ type: 'lostcapture' });
        }
      }}
      onContextMenu={onContextMenu}
    >
      <svg
        ref={svgRef}
        width={width}
        height={height + 18}
        className={styles.svg}
        style={{ transformOrigin: '0 0', transform: `translate(${vp.tx}px, ${vp.ty}px) scale(${vp.scale})` }}
        role="img"
        aria-label="All racks"
      >
        <g dangerouslySetInnerHTML={{ __html: RACK_ART_DEFS }} />
        <RowScene
          cols={cols}
          devices={devices}
          cables={cables}
          activeRackId={activeRackId}
          selectedId={selectedId}
          selectedIds={selectedIds}
          searchHits={searchHits}
          showRear={showRear}
          colorBy={colorBy}
          dragRackId={dragRackId}
          dimmedId={drag && drag.target ? drag.deviceId : null}
          onDevDown={onDevDown}
          onReorder={onReorder}
        />
        {renderDropPreview()}
      </svg>
      <div className={styles.zoomControls} data-canvas-chrome data-demote="chrome">
        <button onClick={() => zoomStep(1 / 1.2)} aria-label="Zoom out" title="Zoom out">−</button>
        <span>{Math.round(vp.scale * 100)}%</span>
        <button onClick={() => zoomStep(1.2)} aria-label="Zoom in" title="Zoom in">+</button>
        <button onClick={fitNow} aria-label="Fit to screen" title="Fit to screen">⊡</button>
      </div>
    </div>
  );
}
