import { useEffect, useRef, useState, useMemo, useCallback, memo } from 'react';
import type { Device, Rack, RackCable, TextObject } from '@/model/types';
import { RackCalloutLayer } from './RackCalloutLayer';
import {
  cabinetSize,
  bayOrigin,
  deviceRect,
  uLabelCenterY,
  uToY,
  BAY_W,
  RAIL_PX,
  U_PX,
  type Rect,
} from './rackLayout';

/** A rejected drop: the slot the user aimed at + why + the nearest U that WOULD fit. */
export interface RejectInfo {
  u: number;
  span: number;
  reason: string;
  pulseU: number | null;
}
import { slotOf } from './rackModel';
import { deviceFaceParts, deviceOppositeFaceParts, devicePortLayout, rackShellParts, RACK_ART_DEFS } from './rackDeviceArt';
import { cablePath } from './cablePath';
import { normalizeRect, devicesInMarquee, type Box } from './marquee';
import { portAt, portCenter, type PortTarget } from './portHit';
import {
  reduce,
  IDLE,
  ownsPointer,
  type MachineState,
  type MachineEvent,
  type Effect as MachineEffect,
  type PointerKind,
} from '@/input/machine';
import { fit, panBy, zoomAt, zoomTo, type Viewport, IDENTITY } from './viewport';
import { normalizeWheel, resolveWheel } from '@/input/wheel';
import { getWheelAction, getConnectMode } from '@/lib/prefs';
import { consumeRackWheelHint, RACK_WHEEL_HINT_EVENT } from './wheelHint';
import { markGestureComplete } from '@/input/quiet';
import { SelectionToolbar, ToolbarSep, toolbarStyles } from '@/ui/SelectionToolbar';
import { placeToolbar } from '@/ui/toolbarPlace';
import { NexIcon } from '@/ui/icons/NexIcon';

/** Screen readers should hear "green", not "#22c55e" (CABLE_COLORS hexes). */
const CABLE_COLOR_NAMES: Record<string, string> = {
  '#2563eb': 'blue',
  '#16a34a': 'green',
  '#dc2626': 'red',
  '#f59e0b': 'amber',
  '#7c3aed': 'violet',
  '#06b6d4': 'cyan',
  '#6b7280': 'gray',
  '#111827': 'black',
};
function cableColorName(hex: string): string {
  return CABLE_COLOR_NAMES[hex.toLowerCase()] ?? hex;
}

/** Cancel/inspect handle the keyboard router uses for in-flight rack gestures. */
export interface RackGestureApi {
  cancel: () => void;
  active: () => boolean;
  /** Clear ARMED (not in-flight) state, e.g. a click-to-cable source port.
      Returns true when something was cleared — Escape-innermost consumes it. */
  clearArmed?: () => boolean;
}

/** In-canvas quick actions for the selected DEVICE (M3: toolbar > sidebar). */
export interface RackDeviceActions {
  nudge: (delta: 1 | -1) => void;
  unmount: () => void;
  remove: () => void;
  racks: { id: string; name: string }[];
  moveToRack: (rackId: string) => void;
}

/** In-canvas cable editing (M3: THE edit path; the schedule locates). */
export interface RackCableActions {
  setColor: (color: string) => void;
  setLabel: (label: string) => void;
  setLength: (lengthFt: number | null) => void;
  remove: () => void;
  colors: string[];
}
import styles from './RackDesigner.module.css';

type ScenePanel = { d: Device; panel: Rect; jacks: ReturnType<typeof devicePortLayout> };
interface RackLayout {
  mounted: Device[];
  portCenters: Map<string, { x: number; y: number }>;
  deviceRects: { id: string; box: Box }[];
  ports: PortTarget[];
  panels: ScenePanel[];
  ghosts: { d: Device; panel: Rect }[];
}

/**
 * The static rack scene: shell art, U gutter, ghosts, device panels, cables.
 * Memoized (perf review 2026-07-05): pan/zoom is a CSS transform on the svg,
 * so viewport frames must not regenerate rackShellParts/deviceFaceParts
 * innerHTML (a 42U rack with dense gear is 1000+ SVG elements). Re-renders
 * only on model/selection changes — rackScene.perf.test.tsx pins this.
 * Live overlays (drop preview, reject flash, marquee, rubber cable, pending
 * port ring) render OUTSIDE, in RackCanvas itself.
 */
const RackFocusScene = memo(function RackFocusScene({
  rack,
  cables,
  side,
  selectedId,
  selectedIds,
  selectedCableId,
  layout,
  onDevDown,
  onSelectCable,
}: {
  rack: Rack;
  cables: RackCable[];
  side: 'front' | 'rear';
  selectedId: string | null;
  selectedIds?: Set<string>;
  selectedCableId: string | null;
  layout: RackLayout;
  onDevDown: (e: React.PointerEvent, d: Device) => void;
  onSelectCable: (id: string | null) => void;
}) {
  if (import.meta.env.MODE === 'test') {
    (globalThis as { __rackSceneRenders?: number }).__rackSceneRenders =
      ((globalThis as { __rackSceneRenders?: number }).__rackSceneRenders ?? 0) + 1;
  }
  const { width, height } = cabinetSize(rack);
  const origin = bayOrigin();
  const bayH = rack.ruHeight * U_PX;
  return (
    <>
      <g dangerouslySetInnerHTML={{ __html: RACK_ART_DEFS }} />
      <g dangerouslySetInnerHTML={{
        __html: rackShellParts({
          rackName: rack.name,
          ruHeight: rack.ruHeight,
          face: side,
          x: 0,
          y: 0,
          width,
          height,
          bayX: origin.x,
          bayY: origin.y,
          bayW: BAY_W,
          bayH,
          title: true,
          active: true,
        }).join(''),
      }} />

      {/* U-number gutter */}
      {Array.from({ length: rack.ruHeight }, (_, i) => {
        const u = i + 1;
        return (
          <text key={u} x={origin.x - 23} y={origin.y + uLabelCenterY(rack, u) + 3} textAnchor="end"
            fontFamily="var(--font-mono)" fontSize={9} style={{ fill: 'var(--chrome-fg-muted)' }}>{u}</text>
        );
      })}

      {/* opposite-face ghosts (behind), then live devices. Full-depth gear
          shows its rear hardware; shallow gear is a muted occupancy hint. */}
      {layout.ghosts.map(({ d, panel }) => (
        <g key={`ghost-${d.id}`} pointerEvents="none" aria-hidden="true">
          <title>{`${d.name} — mounted on the ${slotOf(d).side} face`}</title>
          <g dangerouslySetInnerHTML={{ __html: deviceOppositeFaceParts(d, panel, side).join('') }} />
        </g>
      ))}
      {layout.panels.map(({ d, panel, jacks }) => {
        const isSel = d.id === selectedId || (selectedIds?.has(d.id) ?? false);
        const anySel = selectedId != null || (selectedIds?.size ?? 0) > 0;
        return (
          <g
            key={d.id}
            className={`${styles.devhit} ${anySel && !isSel ? styles.devDimmed : ''}`}
            onPointerDown={(e) => onDevDown(e, d)}
            role="button"
            tabIndex={0}
            aria-label={`${d.name}, U${d.ru}${(d.ruSpan ?? 1) > 1 ? `–U${(d.ru ?? 0) + (d.ruSpan ?? 1) - 1}` : ''}`}
          >
            {/* realistic device art (shared, hex SVG strings) */}
            <g
              dangerouslySetInnerHTML={{
                __html: deviceFaceParts(d, panel, side, rack.hideFaceplateText).join(''),
              }}
            />
            {/* transparent hit area so the whole panel drags/selects */}
            <rect x={panel.x} y={panel.y} width={panel.w} height={panel.h} fill="transparent" />
            {/* per-jack markers: hit-testing uses portAt(); these exist so e2e
                specs (and devtools) can FIND ports */}
            {jacks.map((j) => (
              <rect
                key={`port-${d.id}-${j.ifaceId}`}
                data-port={`${d.id}:${j.ifaceId}`}
                x={j.x}
                y={j.y}
                width={j.w}
                height={j.h}
                fill="transparent"
                pointerEvents="none"
              />
            ))}
            {isSel && (
              <rect x={panel.x} y={panel.y} width={panel.w} height={panel.h} rx={3}
                fill="none" style={{ stroke: 'var(--accent)', strokeWidth: 2 }} pointerEvents="none" />
            )}
          </g>
        );
      })}

      {/* cables: haloed, bowed, selectable curves. Each cable bows by a different
          amount so parallel runs separate; a contrasting halo keeps crossings legible;
          selecting one (here or in the schedule) highlights it and dims the rest. */}
      {cables.map((c, i) => {
        const a = layout.portCenters.get(`${c.aEnd.deviceId}:${c.aEnd.ifaceId}`);
        const b = layout.portCenters.get(`${c.bEnd.deviceId}:${c.bEnd.ifaceId}`);
        if (!a || !b) return null;
        const sel = c.id === selectedCableId;
        const anySel = selectedCableId != null;
        const { d: dPath, control } = cablePath(a, b, i, false);
        const op = anySel ? (sel ? 1 : 0.16) : 0.94;
        const w = sel ? 4.4 : 3.1;
        return (
          <g
            key={c.id}
            data-cable-id={c.id}
            style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onSelectCable(sel ? null : c.id); }}
          >
            {/* layered cable: soft shadow, pale jacket highlight, colored core, plug ends */}
            <path d={dPath} fill="none" stroke="#020617" strokeWidth={w + 5} strokeLinecap="round" opacity={op * 0.24} filter="url(#rkCableShadow)" />
            <path d={dPath} fill="none" stroke="#f8fafc" strokeWidth={w + 2.4} strokeLinecap="round" opacity={op * 0.86} />
            <path d={dPath} fill="none" stroke={c.color} strokeWidth={w} strokeLinecap="round" opacity={op} />
            <path d={dPath} fill="none" stroke="#ffffff" strokeWidth={0.9} strokeLinecap="round" opacity={op * 0.5} />
            <circle cx={a.x} cy={a.y} r={sel ? 4.8 : 3.9} fill="#0f172a" opacity={op} stroke="#f8fafc" strokeWidth={1.1} />
            <circle cx={b.x} cy={b.y} r={sel ? 4.8 : 3.9} fill="#0f172a" opacity={op} stroke="#f8fafc" strokeWidth={1.1} />
            <circle cx={a.x} cy={a.y} r={sel ? 2.6 : 2.1} fill={c.color} opacity={op} />
            <circle cx={b.x} cy={b.y} r={sel ? 2.6 : 2.1} fill={c.color} opacity={op} />
            {sel && c.label && (
              <text
                x={control.x} y={control.y - 5} textAnchor="middle"
                fontFamily="var(--font-mono)" fontSize={10}
                stroke="var(--chrome-bg)" strokeWidth={3} paintOrder="stroke"
                style={{ fill: 'var(--chrome-fg)' }}
              >
                {c.label}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
});

/**
 * Live SVG rack editor. Shares the rack/device/cable drawing primitives used by export,
 * while keeping interaction and selection state in React.
 */
export function RackCanvas({
  rack,
  devices,
  cables,
  callouts = [],
  selectedId,
  selectedIds,
  selectedCableId,
  side,
  armed,
  reject,
  onPlaceAt,
  onDropPreset,
  onSelect,
  onMarquee,
  onConnectPorts,
  onSelectCable,
  onMoveTo,
  onQuickPlace,
  gestureApi,
  spaceHeld,
  deviceActions,
  cableActions,
}: {
  rack: Rack;
  devices: Device[];
  cables: RackCable[];
  /** Rack-scoped callouts (objects with rackScope === rack.id). */
  callouts?: TextObject[];
  selectedId: string | null;
  /** Full multi-selection (for bulk edit highlight). Falls back to selectedId when absent. */
  selectedIds?: Set<string>;
  /** Highlighted cable (from the schedule or a click), or null. */
  selectedCableId: string | null;
  /** Which mounting face to show. Devices on the other face are hidden. */
  side: 'front' | 'rear';
  /** True when a library preset is armed for placement (changes cursor + preview). */
  armed: boolean;
  /** Last rejected drop to flash (red slot + reason + pulse), or null. */
  reject: RejectInfo | null;
  onPlaceAt: (u: number) => void;
  /** A library chip was dragged + dropped onto a U (key = preset key). */
  onDropPreset: (key: string, u: number) => void;
  onSelect: (id: string | null, additive?: boolean) => void;
  /** Rubber-band selection result: device ids inside the box (additive when shift/cmd held). */
  onMarquee?: (ids: string[], additive: boolean) => void;
  /** Drag-to-cable: a cable was dragged from one port to another. */
  onConnectPorts?: (a: { deviceId: string; ifaceId: string }, b: { deviceId: string; ifaceId: string }) => void;
  onSelectCable: (id: string | null) => void;
  onMoveTo: (id: string, u: number) => void;
  /** Double-click an empty bay → place the armed or last-used preset (M4c). */
  onQuickPlace?: (u: number) => void;
  /** Filled with cancel/active so the router can Escape-cancel rack gestures. */
  gestureApi?: React.MutableRefObject<RackGestureApi | null>;
  /** Space+drag pans (contract fallback) — tracked by the designer's key stage. */
  spaceHeld?: boolean;
  /** Quick actions for the selected device (renders the floating toolbar). */
  deviceActions?: RackDeviceActions;
  /** Inline cable editing (renders the mini-controls at the cable midpoint). */
  cableActions?: RackCableActions;
}) {
  const cabinet = cabinetSize(rack);
  // Grow the viewBox to include the callout column (else the SVG's overflow:hidden
  // clips it — the export already unions these bounds; the live canvas must too).
  const width = callouts.reduce((w, o) => Math.max(w, o.x + o.width + 8), cabinet.width);
  const height = callouts.reduce((h, o) => Math.max(h, o.y + o.height + 8), cabinet.height);
  const origin = bayOrigin();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverU, setHoverU] = useState<number | null>(null);
  const [dragU, setDragU] = useState<number | null>(null); // external drag-from-library
  const [marqueeBox, setMarqueeBox] = useState<Box | null>(null);
  const [cablePt, setCablePt] = useState<{ x: number; y: number } | null>(null);
  // Click-to-cable (M4e): first tap on a jack arms it as the source; the
  // next tap on another jack connects — the low-dexterity path (FossFLOW's
  // proven default), gated on the same connect-mode pref as the flat canvas.
  const [pendingPort, setPendingPort] = useState<PortTarget | null>(null);
  // ── Input-machine adapter: ALL rack gestures (device move, marquee,
  // port-cable, pan) run on the pure machine in src/input/machine.ts. The
  // machine works in CLIENT px, so click-vs-drag is 4 CSS px at every zoom
  // (the old 6-SVG-unit threshold varied 20× across the zoom range), and the
  // old justMarqueed one-shot flag is replaced by the machine's expiring
  // click-swallow state.
  const machine = useRef<MachineState>(IDLE);
  const dispatchRef = useRef<
    (e: MachineEvent, mods?: { alt?: boolean; shift?: boolean }) => void
  >(() => {});
  const hoverURef = useRef<number | null>(null);
  const panPrev = useRef({ x: 0, y: 0 });

  // ── Pan / zoom viewport (mirrors the multi-rack canvas in RackRow) ───────────
  // The SVG is CSS-transformed; because clientToSvg/yToU read getBoundingClientRect(),
  // which already reflects the post-transform geometry, the hit-testing math needs no
  // changes. Wheel zooms toward the cursor; MIDDLE-mouse drags pan (left button is owned
  // by marquee / device-drag / port-cable, so panning must not steal it).
  const containerRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport>(IDENTITY);
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const rectOf = () => containerRef.current?.getBoundingClientRect();

  // True after any manual pan/zoom; auto-refits (rack switch, container
  // resize) never fight a viewport the user deliberately set. The ⊡ button
  // re-arms auto-fit.
  const userAdjusted = useRef(false);
  function fitNow() {
    userAdjusted.current = false;
    const r = rectOf();
    if (r) setVp(fit(width, height, r.width, r.height));
  }
  // Fit on mount AND whenever the rack (or its height) changes — switching
  // from a 12U to a 42U cabinet must never keep the old viewport.
  useEffect(() => {
    fitNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rack.id, rack.ruHeight]);
  // An armed click-to-cable source doesn't survive face/rack switches — its
  // jack may no longer be visible.
  useEffect(() => setPendingPort(null), [side, rack.id]);
  // Re-fit on container resize unless the user has taken over the viewport.
  // (Also tracks the container size for floating-toolbar placement.)
  const [csize, setCsize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setCsize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(() => {
      setCsize({ w: el.clientWidth, h: el.clientHeight });
      if (!userAdjusted.current) fitNow();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Router hook: Escape / Cmd+Z cancel whatever rack gesture is in flight —
  // straight through the machine (effects restore visuals + release capture).
  useEffect(() => {
    if (!gestureApi) return;
    gestureApi.current = {
      cancel: () => dispatchRef.current({ type: 'escape' }),
      active: () => machine.current.phase !== 'idle',
      clearArmed: () => {
        if (!pendingPort) return false;
        setPendingPort(null);
        return true;
      },
    };
    return () => {
      if (gestureApi) gestureApi.current = null;
    };
  });
  // Wheel contract (shared with the flat canvas): plain wheel PANS by default
  // per DA-DES-5.1, ctrl/pinch zooms at the cursor, and the Settings
  // wheelAction pref flips plain wheel to zoom for those who want it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // One-time migration hint for returning users: their wheel used to zoom.
      if (consumeRackWheelHint()) window.dispatchEvent(new CustomEvent(RACK_WHEEL_HINT_EVENT));
      userAdjusted.current = true;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Container-level pointer routing: the machine owns every gesture; the
  // container is the single event owner (svg events bubble up to it) and the
  // capture target, so moves/ups keep arriving off-element.
  const onContainerDown = (e: React.PointerEvent) => {
    if (machine.current.phase !== 'idle') {
      // The gesture's own down bubbles here after an svg-level arm — only a
      // genuinely NEW pointer is second-pointer policy.
      if (e.pointerId !== machine.current.pointerId) {
        dispatchRef.current({
          type: 'down',
          pointerId: e.pointerId,
          pointerType: e.pointerType as PointerKind,
          x: e.clientX,
          y: e.clientY,
        });
      }
      return;
    }
    // Pan fallbacks (always): middle-drag, right-drag, Space+left-drag.
    if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceHeld)) {
      e.preventDefault();
      dispatchRef.current({
        type: 'arm',
        gesture: 'pan',
        data: null,
        immediate: true,
        pointerId: e.pointerId,
        pointerType: e.pointerType as PointerKind,
        x: e.clientX,
        y: e.clientY,
      });
    }
  };
  const onContainerMove = (e: React.PointerEvent) => {
    if (machine.current.phase !== 'idle') {
      dispatchRef.current(
        { type: 'move', pointerId: e.pointerId, buttons: e.buttons, x: e.clientX, y: e.clientY },
        { shift: e.shiftKey },
      );
      return;
    }
    // Idle + armed preset: the placement preview follows the pointer.
    if (armed) setHoverU(yToU(e.clientY));
  };
  const onContainerUp = (e: React.PointerEvent) => {
    if (machine.current.phase !== 'idle') {
      dispatchRef.current({ type: 'up', pointerId: e.pointerId }, { shift: e.shiftKey });
    }
  };
  const onContainerCancel = () => dispatchRef.current({ type: 'cancel' });
  const zoomStep = (k: number) => {
    userAdjusted.current = true;
    const r = rectOf();
    setVp((v) => zoomTo(v, v.scale * k, r?.width ?? 800, r?.height ?? 600));
  };

  // Scene geometry per MODEL change, not per viewport frame: panel rects,
  // jack layouts, and the hit-test tables shared by the memoized scene, the
  // pointer handlers, and the floating toolbars. (The focus editor gets the
  // same memo boundary RackRow's RowScene got — rackScene.perf.test pins it.)
  const layout = useMemo<RackLayout>(() => {
    const mounted = devices.filter((d) => d.rackId === rack.id && d.ru != null);
    const portCenters = new Map<string, { x: number; y: number }>(); // `${devId}:${ifaceId}`
    const deviceRects: { id: string; box: Box }[] = [];
    const ports: PortTarget[] = [];
    const panels: ScenePanel[] = [];
    const ghosts: { d: Device; panel: Rect }[] = [];
    for (const d of mounted) {
      const r = deviceRect(rack, d);
      const panel: Rect = { x: origin.x + r.x, y: origin.y + r.y, w: r.w, h: r.h };
      if (slotOf(d).side === side) {
        deviceRects.push({ id: d.id, box: { x: panel.x, y: panel.y, w: panel.w, h: panel.h } });
        const jacks = devicePortLayout(d, panel);
        for (const j of jacks) {
          portCenters.set(`${d.id}:${j.ifaceId}`, { x: j.x + j.w / 2, y: j.y + j.h / 2 });
          ports.push({ deviceId: d.id, ifaceId: j.ifaceId, x: j.x, y: j.y, w: j.w, h: j.h });
        }
        panels.push({ d, panel, jacks });
      } else if (slotOf(d).mount !== 'rail') {
        // Ghosts (opposite face, rack-mounted) render BEHIND the live panels.
        ghosts.push({ d, panel });
      }
    }
    return { mounted, portCenters, deviceRects, ports, panels, ghosts };
    // origin is layout-constant (bayOrigin() has no inputs here).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rack, devices, side]);
  const { deviceRects, ports } = layout;

  /** Map a client point to SVG user-space coordinates (uniform scale via the viewBox). */
  const clientToSvg = (clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * width, y: ((clientY - r.top) / r.height) * height };
  };

  // Map a client Y to a 1-based U (U1 at bottom).
  const yToU = (clientY: number): number => {
    const svg = svgRef.current;
    if (!svg) return 1;
    const rect = svg.getBoundingClientRect();
    const scale = height / rect.height;
    const localY = (clientY - rect.top) * scale - origin.y;
    const fromTop = Math.floor(localY / U_PX);
    return Math.max(1, Math.min(rack.ruHeight, rack.ruHeight - fromTop));
  };

  // ── Per-gesture effect table (the machine owns lifecycle; this owns rack
  // semantics). Gestures: 'pan' | 'move' (device) | 'cable' | 'bay'
  // (marquee / armed placement / empty-click).
  type CableData = { source: PortTarget; devId: string; additive: boolean };
  type BayData = { armed: boolean; additive: boolean; sx: number; sy: number };
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
          panPrev.current = { x: ef.x, y: ef.y };
          userAdjusted.current = true;
        } else if (ef.gesture === 'move') {
          const startRu = (ef.data as { startRu: number }).startRu;
          hoverURef.current = startRu;
          setHoverU(startRu);
        }
        break;
      case 'update':
        if (ef.gesture === 'pan') {
          const prev = panPrev.current;
          panPrev.current = { x: ef.x, y: ef.y };
          setVp((v) => panBy(v, ef.x - prev.x, ef.y - prev.y));
        } else if (ef.gesture === 'move') {
          const u = yToU(ef.y);
          hoverURef.current = u;
          setHoverU(u);
        } else if (ef.gesture === 'cable') {
          setCablePt(clientToSvg(ef.x, ef.y));
        } else if (ef.gesture === 'bay') {
          const d = ef.data as BayData;
          if (d.armed) {
            setHoverU(yToU(ef.y));
          } else {
            const p = clientToSvg(ef.x, ef.y);
            setMarqueeBox(normalizeRect(d.sx, d.sy, p.x, p.y));
          }
        }
        break;
      case 'commit':
        markGestureComplete(); // earned quiet (M3c)
        if (ef.gesture === 'move') {
          const u = hoverURef.current;
          hoverURef.current = null;
          setHoverU(null);
          if (u != null) onMoveTo((ef.data as { id: string }).id, u);
        } else if (ef.gesture === 'cable') {
          const d = ef.data as CableData;
          const p = clientToSvg(ef.x, ef.y);
          const target = portAt(ports, p.x, p.y);
          if (
            onConnectPorts &&
            target &&
            !(target.deviceId === d.source.deviceId && target.ifaceId === d.source.ifaceId)
          ) {
            onConnectPorts(
              { deviceId: d.source.deviceId, ifaceId: d.source.ifaceId },
              { deviceId: target.deviceId, ifaceId: target.ifaceId },
            );
          }
          setCablePt(null);
        } else if (ef.gesture === 'bay') {
          const d = ef.data as BayData;
          if (d.armed) {
            onPlaceAt(yToU(ef.y)); // drag-while-armed places at the release U
          } else if (marqueeBox && onMarquee) {
            onMarquee(devicesInMarquee(deviceRects, marqueeBox), d.additive);
          }
          setMarqueeBox(null);
        }
        break;
      case 'cancel':
        if (ef.gesture === 'move') {
          hoverURef.current = null;
          setHoverU(null);
        } else if (ef.gesture === 'cable') {
          setCablePt(null);
        } else if (ef.gesture === 'bay') {
          setMarqueeBox(null);
        }
        break;
      case 'click':
        if (ef.gesture === 'cable') {
          const d = ef.data as CableData;
          setCablePt(null);
          // Click-to-cable (M4e), same pref as the flat canvas: tap one jack
          // to arm it, tap another to connect. 'drag' mode keeps taps as
          // plain device selection.
          if (getConnectMode() !== 'drag' && onConnectPorts) {
            if (
              pendingPort &&
              !(
                pendingPort.deviceId === d.source.deviceId &&
                pendingPort.ifaceId === d.source.ifaceId
              )
            ) {
              onConnectPorts(
                { deviceId: pendingPort.deviceId, ifaceId: pendingPort.ifaceId },
                { deviceId: d.source.deviceId, ifaceId: d.source.ifaceId },
              );
              setPendingPort(null);
              break;
            }
            setPendingPort(d.source);
          }
          onSelect(d.devId, d.additive);
        } else if (ef.gesture === 'bay') {
          const d = ef.data as BayData;
          setPendingPort(null); // empty click disarms click-to-cable
          if (d.armed) onPlaceAt(yToU(ef.y));
          else onSelectCable(null); // click empty space → clear the cable highlight
        }
        break;
      case 'pinchStart':
        userAdjusted.current = true;
        break;
      case 'pinchUpdate': {
        // Two-finger touch (M4a): centroid delta pans, distance ratio zooms
        // at the centroid. Machine coords are client px → container-relative
        // for the anchored zoom.
        const r = rectOf();
        const ox = r?.left ?? 0;
        const oy = r?.top ?? 0;
        const cx = (ef.a.x + ef.b.x) / 2 - ox;
        const cy = (ef.a.y + ef.b.y) / 2 - oy;
        const pcx = (ef.prevA.x + ef.prevB.x) / 2 - ox;
        const pcy = (ef.prevA.y + ef.prevB.y) / 2 - oy;
        const dist = Math.hypot(ef.a.x - ef.b.x, ef.a.y - ef.b.y);
        const prevDist = Math.hypot(ef.prevA.x - ef.prevB.x, ef.prevA.y - ef.prevB.y);
        // Touch points update in ALTERNATING events, so a straight two-finger
        // pan oscillates the distance slightly — a 1% deadband keeps pans
        // from creeping the zoom while real pinches (>1%/event) pass through.
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
        break; // swallowClick handled via machine state (no DOM click listener)
    }
  };
  dispatchRef.current = (e: MachineEvent, mods?: { alt?: boolean; shift?: boolean }) => {
    const r = reduce(machine.current, e, mods);
    machine.current = r.state;
    for (const ef of r.effects) runMachineEffect(ef);
  };

  /** Press on empty canvas (devices stopPropagation, so this is bay/background). */
  const onCanvasDown = (e: React.PointerEvent) => {
    if (machine.current.phase !== 'idle') return; // container routes second pointers
    if (e.button !== 0 || spaceHeld) return; // space+left = pan (container arms it)
    const p = clientToSvg(e.clientX, e.clientY);
    dispatchRef.current({
      type: 'arm',
      gesture: 'bay',
      data: {
        armed,
        additive: e.shiftKey || e.metaKey || e.ctrlKey,
        sx: p.x,
        sy: p.y,
      },
      pointerId: e.pointerId,
      pointerType: e.pointerType as PointerKind,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const onDevDown = (e: React.PointerEvent, d: Device) => {
    if (machine.current.phase !== 'idle') return; // container routes second pointers
    if (armed || spaceHeld) return; // placing/panning — the bay/container owns the press
    if (e.button !== 0) return; // middle/right bubble to the container pan
    e.stopPropagation();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    // Arbiter priority: a press on a port (jack) ARMS a cable drag, beating
    // device-move; below the 4 CSS px threshold it resolves as a tap-select.
    if (onConnectPorts) {
      const p = clientToSvg(e.clientX, e.clientY);
      const hit = portAt(ports, p.x, p.y);
      if (hit) {
        dispatchRef.current({
          type: 'arm',
          gesture: 'cable',
          data: { source: hit, devId: d.id, additive } satisfies CableData,
          swallowTrailingClick: true,
          pointerId: e.pointerId,
          pointerType: e.pointerType as PointerKind,
          x: e.clientX,
          y: e.clientY,
        });
        return;
      }
    }
    onSelect(d.id, additive);
    if (additive) return; // additive = building a multi-selection; no move
    dispatchRef.current({
      type: 'arm',
      gesture: 'move',
      data: { id: d.id, startRu: d.ru ?? 1 },
      immediate: true, // the drop preview tracks from the press (no threshold)
      pointerId: e.pointerId,
      pointerType: e.pointerType as PointerKind,
      x: e.clientX,
      y: e.clientY,
    });
  };

  // Anchor for the cable mini-controls: the selected cable's curve control
  // point (same bow math the scene draws with).
  const selCableControl = useMemo(() => {
    if (!selectedCableId) return null;
    const i = cables.findIndex((c) => c.id === selectedCableId);
    if (i < 0) return null;
    const c = cables[i]!;
    const a = layout.portCenters.get(`${c.aEnd.deviceId}:${c.aEnd.ifaceId}`);
    const b = layout.portCenters.get(`${c.bEnd.deviceId}:${c.bEnd.ifaceId}`);
    if (!a || !b) return null;
    return cablePath(a, b, i, false).control;
  }, [cables, selectedCableId, layout]);

  // Stable identities for the memoized scene (dispatchRef pattern): a scene
  // re-render must mean the MODEL changed, never that a closure was re-minted.
  const sceneApiRef = useRef({ onDevDown, onSelectCable });
  sceneApiRef.current = { onDevDown, onSelectCable };
  const onDevDownStable = useCallback(
    (e: React.PointerEvent, d: Device) => sceneApiRef.current.onDevDown(e, d),
    [],
  );
  const onSelectCableStable = useCallback(
    (id: string | null) => sceneApiRef.current.onSelectCable(id),
    [],
  );

  return (
    <div
      ref={containerRef}
      className={styles.rackEditCanvas}
      data-canvas-surface
      tabIndex={-1} /* programmatic focus target: Escape/menu-close land here */
      onPointerDown={onContainerDown}
      onPointerMove={onContainerMove}
      onPointerUp={onContainerUp}
      onPointerCancel={onContainerCancel}
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
        // Fires for EVERY released pointer — including the lifted finger the
        // machine itself just released (pinch → survivor pan). Only a loss of
        // the pointer the machine still OWNS is a real cancellation.
        if (machine.current.phase !== 'idle' && ownsPointer(machine.current, e.pointerId)) {
          dispatchRef.current({ type: 'lostcapture' });
        }
      }}
      onContextMenu={(e) => e.preventDefault() /* right-drag pans; no menu here */}
      onDoubleClick={(e) => {
        // Empty-bay double-click → quick place (M4c). Pointer capture lives on
        // this container, so the browser retargets the dblclick here and
        // e.target is NOT the element under the cursor — hit-test the point
        // instead to skip devices, cables, and floating chrome (zoom cluster,
        // device/cable toolbars — double-clicking "+" must not mount gear).
        if (!onQuickPlace || machine.current.phase !== 'idle') return;
        const under = document.elementFromPoint(e.clientX, e.clientY);
        if (!under || under.closest('[data-canvas-chrome]')) return;
        if (under.closest('g[role="button"]') || under.closest('g[style*="cursor: pointer"]')) return;
        onQuickPlace(yToU(e.clientY));
      }}
    >
    <svg
      ref={svgRef}
      data-testid="rack-canvas"
      className={styles.svg}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ transformOrigin: '0 0', transform: `translate(${vp.tx}px, ${vp.ty}px) scale(${vp.scale})` }}
      onPointerDown={onCanvasDown}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/rack-preset')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragU(yToU(e.clientY));
      }}
      onDragLeave={() => setDragU(null)}
      onDrop={(e) => {
        const key = e.dataTransfer.getData('text/rack-preset');
        setDragU(null);
        if (!key) return;
        e.preventDefault();
        onDropPreset(key, yToU(e.clientY));
      }}
    >
      <RackFocusScene
        rack={rack}
        cables={cables}
        side={side}
        selectedId={selectedId}
        selectedIds={selectedIds}
        selectedCableId={selectedCableId}
        layout={layout}
        onDevDown={onDevDownStable}
        onSelectCable={onSelectCableStable}
      />

      {/* Rack-scoped callouts + leaders — outside the memoized scene so editing
          one never re-renders 42U of faceplate art (W3e). */}
      {callouts.length > 0 && (
        <RackCalloutLayer
          callouts={callouts}
          deviceRect={(id) => {
            const dr = layout.deviceRects.find((r) => r.id === id);
            return dr ? { x: dr.box.x, y: dr.box.y, width: dr.box.w, height: dr.box.h } : null;
          }}
        />
      )}

      {/* empty-face hint — so flipping to a bare face never reads as "gear vanished".
          Anchored near the TOP of the bay (not its vertical center) so it stays visible
          without scrolling a tall 42U cabinet. */}
      {layout.panels.length === 0 && layout.ghosts.length === 0 && !armed && dragU == null && (
        <text
          x={origin.x + BAY_W / 2} y={origin.y + 110} textAnchor="middle"
          fontFamily="var(--font-ui)" fontSize={13} style={{ fill: 'var(--chrome-fg-muted)' }}
        >
          Nothing on the {side} face yet — drag gear from the left
        </text>
      )}

      {/* drop / move preview — click-arm, device-drag, OR drag-from-library */}
      {(() => {
        const previewU =
          dragU ?? (armed || machine.current.gesture === 'move' ? hoverU : null);
        if (previewU == null) return null;
        return (
          <rect
            x={origin.x + RAIL_PX} y={origin.y + (rack.ruHeight - previewU) * U_PX}
            width={BAY_W - RAIL_PX * 2} height={U_PX}
            rx={3} fill="color-mix(in srgb, var(--accent) 12%, transparent)"
            stroke="var(--accent)" strokeWidth={2} strokeDasharray="5 3" pointerEvents="none"
          />
        );
      })()}

      {/* rejected-drop feedback: red slot + reason, and a pulse at the nearest free U */}
      {reject && (
        <g pointerEvents="none">
          <rect
            x={origin.x + RAIL_PX} y={origin.y + uToY(rack, reject.u, reject.span)}
            width={BAY_W - RAIL_PX * 2} height={reject.span * U_PX}
            rx={3} fill="rgba(220,38,38,0.12)" stroke="#dc2626" strokeWidth={2}
          />
          <text
            x={origin.x + RAIL_PX + 8} y={origin.y + uToY(rack, reject.u, reject.span) + reject.span * U_PX / 2 + 4}
            fontFamily="var(--font-mono)" fontSize={11} style={{ fill: '#dc2626' }}
          >
            {reject.reason}
          </text>
          {reject.pulseU != null && (
            <rect
              className={styles.pulse}
              x={origin.x + RAIL_PX} y={origin.y + uToY(rack, reject.pulseU, reject.span)}
              width={BAY_W - RAIL_PX * 2} height={reject.span * U_PX}
              rx={3} fill="var(--accent)" stroke="var(--accent)" strokeWidth={2}
            />
          )}
        </g>
      )}
      {marqueeBox && (
        <rect
          className={styles.marquee}
          x={marqueeBox.x}
          y={marqueeBox.y}
          width={marqueeBox.w}
          height={marqueeBox.h}
          pointerEvents="none"
        />
      )}
      {/* Click-to-cable armed source: every jack shows its dot; the armed
          port carries an accent ring; the next tap connects (M4e). */}
      {pendingPort && machine.current.phase === 'idle' && (
        <g pointerEvents="none">
          {ports.map((pt, i) => {
            const c = portCenter(pt);
            return (
              <circle key={`arm-${i}`} cx={c.x} cy={c.y} r={3} fill="var(--accent)" opacity={0.55} />
            );
          })}
          <circle
            cx={portCenter(pendingPort).x}
            cy={portCenter(pendingPort).y}
            r={6.5}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
          />
        </g>
      )}
      {cablePt &&
        machine.current.gesture === 'cable' &&
        machine.current.phase === 'active' && (
          <g pointerEvents="none">
            {ports.map((pt, i) => {
              const c = portCenter(pt);
              return <circle key={`pt-${i}`} cx={c.x} cy={c.y} r={3} fill="var(--accent)" opacity={0.55} />;
            })}
            <line
              x1={portCenter((machine.current.data as { source: PortTarget }).source).x}
              y1={portCenter((machine.current.data as { source: PortTarget }).source).y}
              x2={cablePt.x}
              y2={cablePt.y}
              stroke="var(--accent)"
              strokeWidth={2}
              strokeDasharray="5 3"
            />
          </g>
        )}
    </svg>
      <div className={styles.zoomControls} data-canvas-chrome data-demote="chrome">
        <button onClick={() => zoomStep(1 / 1.2)} aria-label="Zoom out" title="Zoom out">−</button>
        <span>{Math.round(vp.scale * 100)}%</span>
        <button onClick={() => zoomStep(1.2)} aria-label="Zoom in" title="Zoom in">+</button>
        <button onClick={fitNow} aria-label="Fit to screen" title="Fit to screen">⊡</button>
      </div>
      {/* Floating device toolbar (M3): the primary quick-action path. Hidden
          while a gesture is active. SVG-user coords → container px is pure
          math (u * scale + translate), so it never lags the transform. */}
      {deviceActions &&
        selectedId &&
        machine.current.phase !== 'active' &&
        machine.current.phase !== 'pinch' &&
        (() => {
          const dr = deviceRects.find((r) => r.id === selectedId);
          if (!dr) return null;
          return (
            <RackDeviceToolbar
              bbox={{
                x: dr.box.x * vp.scale + vp.tx,
                y: dr.box.y * vp.scale + vp.ty,
                width: dr.box.w * vp.scale,
                height: dr.box.h * vp.scale,
              }}
              vw={csize.w}
              vh={csize.h}
              currentRackId={rack.id}
              actions={deviceActions}
            />
          );
        })()}
      {/* Cable mini-controls (M3): THE cable edit path — the schedule panel
          locates; this edits. Anchored below the curve's control point. */}
      {cableActions &&
        selectedCableId &&
        selCableControl &&
        machine.current.phase !== 'active' &&
        machine.current.phase !== 'pinch' &&
        (() => {
          const cable = cables.find((c) => c.id === selectedCableId);
          if (!cable) return null;
          const cx = (selCableControl as { x: number; y: number }).x * vp.scale + vp.tx;
          const cy = (selCableControl as { x: number; y: number }).y * vp.scale + vp.ty;
          return (
            <RackCableControls
              key={cable.id}
              anchor={{ x: cx - 10, y: cy - 10, width: 20, height: 20 }}
              vw={csize.w}
              vh={csize.h}
              cable={cable}
              actions={cableActions}
            />
          );
        })()}
    </div>
  );
}

/** Floating quick actions for the selected rack device. */
function RackDeviceToolbar({
  bbox,
  vw,
  vh,
  currentRackId,
  actions,
}: {
  bbox: { x: number; y: number; width: number; height: number };
  vw: number;
  vh: number;
  currentRackId: string;
  actions: RackDeviceActions;
}) {
  const [size, setSize] = useState({ width: 240, height: 36 });
  const pos = placeToolbar(bbox, size, { width: vw, height: vh });
  return (
    <SelectionToolbar
      left={pos.left}
      top={pos.top}
      label="Device actions"
      barRef={(el) => {
        if (
          el &&
          (Math.abs(el.offsetWidth - size.width) > 1 ||
            Math.abs(el.offsetHeight - size.height) > 1)
        ) {
          setSize({ width: el.offsetWidth, height: el.offsetHeight });
        }
      }}
    >
      <button title="Nudge up 1U" aria-label="Nudge up 1U" onClick={() => actions.nudge(1)}>
        <NexIcon name="arrow-up" />
      </button>
      <button
        title="Nudge down 1U"
        aria-label="Nudge down 1U"
        onClick={() => actions.nudge(-1)}
      >
        <NexIcon name="arrow-down" />
      </button>
      <ToolbarSep />
      <select
        value={currentRackId}
        onChange={(e) => actions.moveToRack(e.target.value)}
        disabled={actions.racks.length < 2}
        aria-label="Move to rack"
        title="Move to rack"
      >
        {actions.racks.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <ToolbarSep />
      <button
        style={{ width: 'auto', padding: '0 8px', fontSize: 11 }}
        title="Unmount to the tray"
        onClick={actions.unmount}
      >
        Unmount
      </button>
      <button title="Delete device" aria-label="Delete device" onClick={actions.remove}>
        <NexIcon name="trash" />
      </button>
    </SelectionToolbar>
  );
}

/** Inline cable editing: swatches, label, length (ft), delete. */
function RackCableControls({
  anchor,
  vw,
  vh,
  cable,
  actions,
}: {
  anchor: { x: number; y: number; width: number; height: number };
  vw: number;
  vh: number;
  cable: RackCable;
  actions: RackCableActions;
}) {
  const [size, setSize] = useState({ width: 320, height: 36 });
  const [lenInvalid, setLenInvalid] = useState(false);
  // cardAbove=true → prefer BELOW the curve (the spec's slot for cables).
  const pos = placeToolbar(anchor, size, { width: vw, height: vh }, true);

  const commitLength = (raw: string, el: HTMLInputElement) => {
    const v = raw.trim();
    if (v === '') {
      setLenInvalid(false);
      actions.setLength(null);
      return;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      setLenInvalid(true); // sev-error border; value not committed
      return;
    }
    setLenInvalid(false);
    actions.setLength(Math.round(n));
    el.value = String(Math.round(n));
  };

  return (
    <SelectionToolbar
      left={pos.left}
      top={pos.top}
      label="Cable actions"
      barRef={(el) => {
        if (
          el &&
          (Math.abs(el.offsetWidth - size.width) > 1 ||
            Math.abs(el.offsetHeight - size.height) > 1)
        ) {
          setSize({ width: el.offsetWidth, height: el.offsetHeight });
        }
      }}
    >
      {actions.colors.map((color) => (
        <button
          key={color}
          title={`Cable color: ${cableColorName(color)}`}
          aria-label={`Cable color: ${cableColorName(color)}`}
          aria-pressed={color === cable.color}
          onClick={() => actions.setColor(color)}
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            background: color,
            outline: color === cable.color ? '2px solid var(--accent)' : undefined,
            outlineOffset: 1,
          }}
        />
      ))}
      <ToolbarSep />
      <input
        aria-label="Cable label"
        placeholder="label"
        defaultValue={cable.label ?? ''}
        style={{ width: 88 }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            // Revert the FIELD only — the cable stays selected.
            e.stopPropagation();
            e.currentTarget.value = cable.label ?? '';
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          if (v !== (cable.label ?? '')) actions.setLabel(v);
        }}
      />
      <input
        aria-label="Cable length in feet"
        placeholder="ft"
        defaultValue={cable.lengthFt != null ? String(cable.lengthFt) : ''}
        className={lenInvalid ? toolbarStyles.invalid : undefined}
        style={{ width: 44 }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            e.currentTarget.value = cable.lengthFt != null ? String(cable.lengthFt) : '';
            setLenInvalid(false);
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => commitLength(e.currentTarget.value, e.currentTarget)}
      />
      <ToolbarSep />
      <button title="Delete cable" aria-label="Delete cable" onClick={actions.remove}>
        <NexIcon name="trash" />
      </button>
    </SelectionToolbar>
  );
}
