/**
 * Multi-rack ROW view (schema v3). Renders every rack side by side in ONE interactive SVG
 * so cross-rack cables can be drawn between cabinets. Each rack shows BOTH faces as two
 * adjacent columns (Front | Rear) so nothing on the back is hidden. This is the overview:
 * devices are labeled blocks (not port-level detail — that lives in the focused editor).
 * Click a rack/device to focus + select it; reorder cabinets with the ◀ ▶ chevrons.
 * Per-rack U + power/weight budget is shown inline. (Cross-rack device moves are done via
 * the "Move to rack" control in the focused editor's selection panel.)
 */
import { useRef, useState, useEffect } from 'react';
import type { Device, Rack, RackCable } from '@/model/types';
import { fit, panBy, zoomAt, zoomTo, type Viewport, IDENTITY } from './viewport';
import { normalizeWheel, resolveWheel } from '@/input/wheel';
import { getWheelAction } from '@/lib/prefs';
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
import { isFullDepth, slotOf } from './rackModel';
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
  onMoveDeviceToRack?: (deviceId: string, rackId: string) => void;
}

/** Gap between the front and rear columns of the SAME rack (tighter than between racks). */
const FACE_GAP = 22;

export function RackRow({
  racks, devices, cables, activeRackId, selectedId, selectedIds, searchHits, showRear, colorBy,
  onFocusRack, onSelect, onReorder, onMoveDeviceToRack,
}: RackRowProps) {
  const [dragRackId, setDragRackId] = useState<string | null>(null);
  // Front (and optionally rear) column per rack, laid out left-to-right.
  let x = 0;
  let height = 0;
  const cols = racks.map((rack) => {
    const size = cabinetSize(rack);
    const frontX = x;
    const rearX = showRear ? x + size.width + FACE_GAP : x;
    x = (showRear ? rearX + size.width : frontX + size.width) + RACK_GUTTER;
    height = Math.max(height, size.height);
    return { rack, frontX, rearX, size };
  });
  const width = Math.max(0, x - RACK_GUTTER);

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
      // Whole face is a click target → drill into the focused editor. Device clicks
      // stopPropagation and select instead.
      <g
        key={`${rack.id}-${face}`}
        data-rack-face={`${rack.id}-${face}`}
        onClick={() => onFocusRack(rack.id)}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('text/rack-device')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDragRackId(rack.id);
        }}
        onDragLeave={() => setDragRackId((id) => (id === rack.id ? null : id))}
        onDrop={(e) => {
          const deviceId = e.dataTransfer.getData('text/rack-device');
          setDragRackId(null);
          if (!deviceId) return;
          e.preventDefault();
          onMoveDeviceToRack?.(deviceId, rack.id);
        }}
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
          <text key={u} x={origin.x - 23} y={origin.y + uLabelCenterY(rack, u) + 3} textAnchor="end" fontSize={8} fontFamily="var(--font-mono)" fill="#64748b">{u}</text>
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
          const hit = searchHits.has(d.id);
          return (
            <g
              key={d.id}
              {...({ draggable: true } as Record<string, unknown>)}
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.setData('text/rack-device', d.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDragRackId(null)}
              onClick={(e) => {
                e.stopPropagation();
                const additive = e.shiftKey || e.metaKey || e.ctrlKey;
                onSelect(d.id, additive);
                if (!additive) onFocusRack(rack.id); // shift/cmd builds a selection without drilling in
              }}
              style={{ cursor: 'grab' }}
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

  // ── Pan / zoom viewport ─────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport>(IDENTITY);
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const pan = useRef({ active: false, sx: 0, sy: 0, tx: 0, ty: 0, moved: false });
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

  function onPointerDown(e: React.PointerEvent) {
    // Left pans behind a 4px threshold (click-to-drill survives); middle and
    // right pan too (the contract's always-on fallbacks).
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    // Don't capture the pointer yet — capturing on pointerdown retargets the click to the
    // container and would break click-to-drill-in on rack faces. Capture only once an actual
    // drag starts (in onPointerMove past the threshold).
    pan.current = { active: true, sx: e.clientX, sy: e.clientY, tx: vpRef.current.tx, ty: vpRef.current.ty, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!pan.current.active) return;
    const dx = e.clientX - pan.current.sx;
    const dy = e.clientY - pan.current.sy;
    if (!pan.current.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      pan.current.moved = true;
      containerRef.current?.setPointerCapture?.(e.pointerId); // capture only for a real pan
    }
    if (pan.current.moved) setVp((v) => ({ ...v, tx: pan.current.tx + dx, ty: pan.current.ty + dy }));
  }
  const suppressMenu = useRef(false);
  function onPointerUp(e: React.PointerEvent) {
    pan.current.active = false;
    containerRef.current?.releasePointerCapture?.(e.pointerId);
    if (e.button !== 0) {
      // Right: suppress the imminent contextmenu after a real pan. Middle:
      // nothing follows — reset so `moved` can't swallow a later left click.
      suppressMenu.current = pan.current.moved && e.button === 2;
      pan.current.moved = false;
    }
  }
  // If the pointer actually dragged, swallow the click so a pan doesn't also focus a rack.
  function onClickCapture(e: React.MouseEvent) {
    if (pan.current.moved) { e.stopPropagation(); pan.current.moved = false; }
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

  return (
    <div
      ref={containerRef}
      className={styles.panCanvas}
      data-canvas-surface
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClickCapture={onClickCapture}
      onContextMenu={onContextMenu}
    >
      <svg
        width={width}
        height={height + 18}
        className={styles.svg}
        style={{ transformOrigin: '0 0', transform: `translate(${vp.tx}px, ${vp.ty}px) scale(${vp.scale})` }}
        role="img"
        aria-label="All racks"
      >
        <g dangerouslySetInnerHTML={{ __html: RACK_ART_DEFS }} />
        {cols.map((c, i) => {
          const b = rackBudget(c.rack, devices);
          const bayH = c.rack.ruHeight * U_PX;
          const groupRight = (showRear ? c.rearX : c.frontX) + c.size.width;
          return (
            <g key={c.rack.id}>
              {renderFace(c.rack, c.frontX, 'front')}
              {showRear && renderFace(c.rack, c.rearX, 'rear')}
              {/* reorder chevrons over the rack group */}
              {i > 0 && (
                <text x={c.frontX + 10} y={c.size.height + 14} fontSize={13} fill="var(--accent)" style={{ cursor: 'pointer' }} onClick={() => onReorder(c.rack.id, -1)} aria-label="Move rack left">◀</text>
              )}
              {i < cols.length - 1 && (
                <text x={groupRight - 16} y={c.size.height + 14} fontSize={13} fill="var(--accent)" style={{ cursor: 'pointer' }} onClick={() => onReorder(c.rack.id, 1)} aria-label="Move rack right">▶</text>
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
