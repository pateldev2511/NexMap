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
import { normalizeRect, devicesInMarquee, MARQUEE_THRESHOLD, type Box } from './marquee';
import { portAt, portCenter, type PortTarget } from './portHit';
import { fit, panBy, zoomAt, zoomTo, type Viewport, IDENTITY } from './viewport';
import { normalizeWheel, resolveWheel } from '@/input/wheel';
import { getWheelAction } from '@/lib/prefs';
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
}) {
  const { width, height } = cabinetSize(rack);
  const origin = bayOrigin();
  const bayH = rack.ruHeight * U_PX;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverU, setHoverU] = useState<number | null>(null);
  const [dragU, setDragU] = useState<number | null>(null); // external drag-from-library
  const drag = useRef<{ id: string; startY: number; startRu: number } | null>(null);
  // Marquee (rubber-band) selection. `pending` records the press; it only becomes a real
  // marquee after crossing MARQUEE_THRESHOLD, so a plain empty click stays a click.
  const marquee = useRef<{ sx: number; sy: number; active: boolean } | null>(null);
  const justMarqueed = useRef(false);
  const [marqueeBox, setMarqueeBox] = useState<Box | null>(null);
  // Drag-to-cable: a press on a port arms a cable; it only becomes a drag after crossing the
  // threshold (so a tap on a jack still selects the device), then release on another port
  // connects them.
  const cableDrag = useRef<{ source: PortTarget; devId: string; additive: boolean; sx: number; sy: number; active: boolean } | null>(null);
  const [cablePt, setCablePt] = useState<{ x: number; y: number } | null>(null);

  // ── Pan / zoom viewport (mirrors the multi-rack canvas in RackRow) ───────────
  // The SVG is CSS-transformed; because clientToSvg/yToU read getBoundingClientRect(),
  // which already reflects the post-transform geometry, the hit-testing math needs no
  // changes. Wheel zooms toward the cursor; MIDDLE-mouse drags pan (left button is owned
  // by marquee / device-drag / port-cable, so panning must not steal it).
  const containerRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport>(IDENTITY);
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const pan = useRef({ active: false, sx: 0, sy: 0, tx: 0, ty: 0 });
  const rectOf = () => containerRef.current?.getBoundingClientRect();

  function fitNow() {
    const r = rectOf();
    if (r) setVp(fit(width, height, r.width, r.height));
  }
  // Fit once on mount (content + container measured by then).
  useEffect(() => {
    fitNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Wheel contract (shared with the flat canvas): plain wheel PANS by default
  // per DA-DES-5.1, ctrl/pinch zooms at the cursor, and the Settings
  // wheelAction pref flips plain wheel to zoom for those who want it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
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

  const onPanDown = (e: React.PointerEvent) => {
    // Middle OR right drag pans (left button is the editing gesture; the
    // contract's pan fallbacks apply on every canvas).
    if (e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    pan.current = { active: true, sx: e.clientX, sy: e.clientY, tx: vpRef.current.tx, ty: vpRef.current.ty };
    containerRef.current?.setPointerCapture?.(e.pointerId);
  };
  const onPanMove = (e: React.PointerEvent) => {
    if (!pan.current.active) return;
    setVp((v) => ({ ...v, tx: pan.current.tx + (e.clientX - pan.current.sx), ty: pan.current.ty + (e.clientY - pan.current.sy) }));
  };
  const onPanUp = (e: React.PointerEvent) => {
    if (!pan.current.active) return;
    pan.current.active = false;
    containerRef.current?.releasePointerCapture?.(e.pointerId);
  };
  const zoomStep = (k: number) => {
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

  const onBayMove = (e: React.PointerEvent) => {
    if (cableDrag.current) {
      const p = clientToSvg(e.clientX, e.clientY);
      if (!cableDrag.current.active) {
        if (Math.abs(p.x - cableDrag.current.sx) + Math.abs(p.y - cableDrag.current.sy) <= MARQUEE_THRESHOLD) return;
        cableDrag.current.active = true;
      }
      setCablePt(p);
      return;
    }
    if (drag.current) {
      onSelectNudge(e);
      return;
    }
    if (marquee.current) {
      const p = clientToSvg(e.clientX, e.clientY);
      if (!marquee.current.active) {
        if (Math.abs(p.x - marquee.current.sx) + Math.abs(p.y - marquee.current.sy) <= MARQUEE_THRESHOLD) return;
        marquee.current.active = true; // crossed the threshold → it's a real marquee, capture
        svgRef.current?.setPointerCapture?.(e.pointerId);
      }
      setMarqueeBox(normalizeRect(marquee.current.sx, marquee.current.sy, p.x, p.y));
      return;
    }
    if (armed) setHoverU(yToU(e.clientY));
  };

  /** Press on empty canvas (devices stopPropagation, so this is bay/background). */
  const onCanvasDown = (e: React.PointerEvent) => {
    if (armed || e.button !== 0 || !onMarquee) return; // placing or no marquee consumer
    const p = clientToSvg(e.clientX, e.clientY);
    marquee.current = { sx: p.x, sy: p.y, active: false };
  };
  const onSelectNudge = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setHoverU(yToU(e.clientY));
  };
  const onBayClick = (e: React.MouseEvent) => {
    // A marquee just finished on this press — swallow the trailing click so it doesn't
    // also clear the cable highlight.
    if (justMarqueed.current) {
      justMarqueed.current = false;
      return;
    }
    // Compute the U directly from the click, not from hover state — so a tap or a
    // click-without-prior-move still lands reliably.
    if (armed) onPlaceAt(yToU(e.clientY));
    else onSelectCable(null); // click empty space → clear the highlighted cable
  };

  const onDevDown = (e: React.PointerEvent, d: Device) => {
    if (armed) return; // placing — let the bay handle the click
    e.stopPropagation();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    // Arbiter priority: a press on a port (jack) ARMS a cable drag, beating device-move. It
    // only becomes a real drag past the threshold (onBayMove); a tap falls through to select.
    if (onConnectPorts) {
      const p = clientToSvg(e.clientX, e.clientY);
      const hit = portAt(ports, p.x, p.y);
      if (hit) {
        cableDrag.current = { source: hit, devId: d.id, additive, sx: p.x, sy: p.y, active: false };
        svgRef.current?.setPointerCapture?.(e.pointerId); // capture on SVG so moves track across devices
        return;
      }
    }
    onSelect(d.id, additive);
    if (additive) return; // additive = building a multi-selection; don't start a drag/move
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { id: d.id, startY: e.clientY, startRu: d.ru ?? 1 };
    setHoverU(d.ru ?? 1);
  };
  const onDevUp = (e?: React.PointerEvent) => {
    if (cableDrag.current) {
      const cd = cableDrag.current;
      if (cd.active && onConnectPorts) {
        const p = e ? clientToSvg(e.clientX, e.clientY) : null;
        const target = p ? portAt(ports, p.x, p.y) : null;
        if (target && !(target.deviceId === cd.source.deviceId && target.ifaceId === cd.source.ifaceId)) {
          onConnectPorts(
            { deviceId: cd.source.deviceId, ifaceId: cd.source.ifaceId },
            { deviceId: target.deviceId, ifaceId: target.ifaceId },
          );
        }
        justMarqueed.current = true; // a real drag happened — swallow the trailing click
      } else {
        onSelect(cd.devId, cd.additive); // tap on a jack → just select the device
      }
      cableDrag.current = null;
      setCablePt(null);
      return;
    }
    if (drag.current && hoverU != null) {
      onMoveTo(drag.current.id, hoverU);
    }
    drag.current = null;
    setHoverU(null);
    if (marquee.current?.active && marqueeBox && onMarquee) {
      const ids = devicesInMarquee(deviceRects, marqueeBox);
      const additive = !!(e && (e.shiftKey || e.metaKey || e.ctrlKey));
      onMarquee(ids, additive);
      justMarqueed.current = true; // suppress the trailing click's cable-clear
    }
    marquee.current = null;
    setMarqueeBox(null);
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
        onPointerUp={onDevUp}
        role="button"
        tabIndex={0}
        aria-label={`${d.name}, U${d.ru}${(d.ruSpan ?? 1) > 1 ? `–U${(d.ru ?? 0) + (d.ruSpan ?? 1) - 1}` : ''}`}
      >
        {/* realistic device art (shared, hex SVG strings) */}
        <g dangerouslySetInnerHTML={{ __html: deviceFaceParts(d, panel, side).join('') }} />
        {/* transparent hit area so the whole panel drags/selects */}
        <rect x={panel.x} y={panel.y} width={panel.w} height={panel.h} fill="transparent" />
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
      onPointerDown={onPanDown}
      onPointerMove={onPanMove}
      onPointerUp={onPanUp}
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
      onPointerMove={onBayMove}
      onClick={onBayClick}
      onPointerUp={onDevUp}
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
        const previewU = dragU ?? (armed || drag.current ? hoverU : null);
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
      {cablePt && cableDrag.current?.active && (
        <g pointerEvents="none">
          {ports.map((pt, i) => {
            const c = portCenter(pt);
            return <circle key={`pt-${i}`} cx={c.x} cy={c.y} r={3} fill="var(--accent)" opacity={0.55} />;
          })}
          <line
            x1={portCenter(cableDrag.current.source).x}
            y1={portCenter(cableDrag.current.source).y}
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
