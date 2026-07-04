import { useEffect, useRef, useState } from 'react';
import type { Device, Rack, RackCable } from '@/model/types';
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
  type MachineState,
  type MachineEvent,
  type Effect as MachineEffect,
  type PointerKind,
} from '@/input/machine';
import { fit, panBy, zoomAt, zoomTo, type Viewport, IDENTITY } from './viewport';
import { normalizeWheel, resolveWheel } from '@/input/wheel';
import { getWheelAction } from '@/lib/prefs';
import { consumeRackWheelHint, RACK_WHEEL_HINT_EVENT } from './wheelHint';

/** Cancel/inspect handle the keyboard router uses for in-flight rack gestures. */
export interface RackGestureApi {
  cancel: () => void;
  active: () => boolean;
}
import styles from './RackDesigner.module.css';

/**
 * Live SVG rack editor. Shares the rack/device/cable drawing primitives used by export,
 * while keeping interaction and selection state in React.
 */
export function RackCanvas({
  rack,
  devices,
  cables,
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
  gestureApi,
  spaceHeld,
}: {
  rack: Rack;
  devices: Device[];
  cables: RackCable[];
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
  /** Filled with cancel/active so the router can Escape-cancel rack gestures. */
  gestureApi?: React.MutableRefObject<RackGestureApi | null>;
  /** Space+drag pans (contract fallback) — tracked by the designer's key stage. */
  spaceHeld?: boolean;
}) {
  const { width, height } = cabinetSize(rack);
  const origin = bayOrigin();
  const bayH = rack.ruHeight * U_PX;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverU, setHoverU] = useState<number | null>(null);
  const [dragU, setDragU] = useState<number | null>(null); // external drag-from-library
  const [marqueeBox, setMarqueeBox] = useState<Box | null>(null);
  const [cablePt, setCablePt] = useState<{ x: number; y: number } | null>(null);
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
  // Re-fit on container resize unless the user has taken over the viewport.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
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

  const mounted = devices.filter((d) => d.rackId === rack.id && d.ru != null);
  const portCenters = new Map<string, { x: number; y: number }>(); // `${devId}:${ifaceId}`
  const deviceRects: { id: string; box: Box }[] = []; // selectable device panels, in SVG space
  const ports: PortTarget[] = []; // every visible jack, in SVG space, for drag-to-cable hit-testing

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
          onSelect(d.devId, d.additive); // tap on a jack → just select the device
          setCablePt(null);
        } else if (ef.gesture === 'bay') {
          const d = ef.data as BayData;
          if (d.armed) onPlaceAt(yToU(ef.y));
          else onSelectCable(null); // click empty space → clear the cable highlight
        }
        break;
      default:
        break; // pinch*/swallowClick arrive with M4a
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

  const cssVar = (name: string): string => `var(${name})`;

  /** Live device panel as SVG JSX (themeable). */
  const renderPanel = (d: Device) => {
    const r = deviceRect(rack, d);
    const panel: Rect = { x: origin.x + r.x, y: origin.y + r.y, w: r.w, h: r.h };
    const isSel = d.id === selectedId || (selectedIds?.has(d.id) ?? false);
    deviceRects.push({ id: d.id, box: { x: panel.x, y: panel.y, w: panel.w, h: panel.h } });

    // Jack/NIC centers feed cable endpoints; the shared art draws onto these same rects.
    const jacks = devicePortLayout(d, panel);
    for (const j of jacks) {
      portCenters.set(`${d.id}:${j.ifaceId}`, { x: j.x + j.w / 2, y: j.y + j.h / 2 });
      ports.push({ deviceId: d.id, ifaceId: j.ifaceId, x: j.x, y: j.y, w: j.w, h: j.h });
    }

    return (
      <g
        key={d.id}
        className={styles.devhit}
        onPointerDown={(e) => onDevDown(e, d)}
        role="button"
        tabIndex={0}
        aria-label={`${d.name}, U${d.ru}${(d.ruSpan ?? 1) > 1 ? `–U${(d.ru ?? 0) + (d.ruSpan ?? 1) - 1}` : ''}`}
      >
        {/* realistic device art (shared, hex SVG strings) */}
        <g dangerouslySetInnerHTML={{ __html: deviceFaceParts(d, panel, side).join('') }} />
        {/* transparent hit area so the whole panel drags/selects */}
        <rect x={panel.x} y={panel.y} width={panel.w} height={panel.h} fill="transparent" />
        {/* per-jack markers: hit-testing uses portAt(); these exist so e2e
            specs (and devtools) can FIND ports — the old "no stable
            selectors" excuse for skipping cabling e2e is retired */}
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
            fill="none" style={{ stroke: cssVar('--accent'), strokeWidth: 2 }} pointerEvents="none" />
        )}
      </g>
    );
  };

  /** A device on the OTHER face. Full-depth gear shows its rear hardware; shallow gear
   *  remains a muted occupancy hint. Non-interactive; editing lives on the mounted face. */
  const renderGhost = (d: Device) => {
    const r = deviceRect(rack, d);
    const panel: Rect = { x: origin.x + r.x, y: origin.y + r.y, w: r.w, h: r.h };
    return (
      <g key={`ghost-${d.id}`} pointerEvents="none" aria-hidden="true">
        <title>{`${d.name} — mounted on the ${slotOf(d).side} face`}</title>
        <g dangerouslySetInnerHTML={{ __html: deviceOppositeFaceParts(d, panel, side).join('') }} />
      </g>
    );
  };

  // Ghosts (opposite face, rack-mounted) render BEHIND the live panels.
  const ghosts = mounted
    .filter((d) => slotOf(d).side !== side && slotOf(d).mount !== 'rail')
    .map(renderGhost);
  const panels = mounted.filter((d) => slotOf(d).side === side).map(renderPanel);

  return (
    <div
      ref={containerRef}
      className={styles.rackEditCanvas}
      onPointerDown={onContainerDown}
      onPointerMove={onContainerMove}
      onPointerUp={onContainerUp}
      onPointerCancel={onContainerCancel}
      onLostPointerCapture={() => {
        if (machine.current.phase !== 'idle') dispatchRef.current({ type: 'lostcapture' });
      }}
      onContextMenu={(e) => e.preventDefault() /* right-drag pans; no menu here */}
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
            fontFamily="var(--font-mono)" fontSize={9} style={{ fill: '#64748b' }}>{u}</text>
        );
      })}

      {/* opposite-face ghosts (behind), then live devices */}
      {ghosts}
      {panels}

      {/* empty-face hint — so flipping to a bare face never reads as "gear vanished".
          Anchored near the TOP of the bay (not its vertical center) so it stays visible
          without scrolling a tall 42U cabinet. */}
      {panels.length === 0 && ghosts.length === 0 && !armed && dragU == null && (
        <text
          x={origin.x + BAY_W / 2} y={origin.y + 110} textAnchor="middle"
          fontFamily="var(--font-ui)" fontSize={13} style={{ fill: 'var(--chrome-fg-muted)' }}
        >
          Nothing on the {side} face yet — drag gear from the left
        </text>
      )}

      {/* cables: haloed, bowed, selectable curves. Each cable bows by a different
          amount so parallel runs separate; a contrasting halo keeps crossings legible;
          selecting one (here or in the schedule) highlights it and dims the rest. */}
      {cables.map((c, i) => {
        const a = portCenters.get(`${c.aEnd.deviceId}:${c.aEnd.ifaceId}`);
        const b = portCenters.get(`${c.bEnd.deviceId}:${c.bEnd.ifaceId}`);
        if (!a || !b) return null;
        const sel = c.id === selectedCableId;
        const anySel = selectedCableId != null;
        const { d: dPath, control } = cablePath(a, b, i, false);
        const op = anySel ? (sel ? 1 : 0.16) : 0.94;
        const w = sel ? 4.4 : 3.1;
        return (
          <g
            key={c.id}
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
      <div className={styles.zoomControls}>
        <button onClick={() => zoomStep(1 / 1.2)} aria-label="Zoom out" title="Zoom out">−</button>
        <span>{Math.round(vp.scale * 100)}%</span>
        <button onClick={() => zoomStep(1.2)} aria-label="Zoom in" title="Zoom in">+</button>
        <button onClick={fitNow} aria-label="Fit to screen" title="Fit to screen">⊡</button>
      </div>
    </div>
  );
}
