import { useRef, useState } from 'react';
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
  selectedCableId,
  side,
  armed,
  reject,
  onPlaceAt,
  onDropPreset,
  onSelect,
  onSelectCable,
  onMoveTo,
}: {
  rack: Rack;
  devices: Device[];
  cables: RackCable[];
  selectedId: string | null;
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
  onSelect: (id: string | null) => void;
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

  const mounted = devices.filter((d) => d.rackId === rack.id && d.ru != null);
  const portCenters = new Map<string, { x: number; y: number }>(); // `${devId}:${ifaceId}`

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
    if (drag.current) {
      onSelectNudge(e);
      return;
    }
    if (armed) setHoverU(yToU(e.clientY));
  };
  const onSelectNudge = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setHoverU(yToU(e.clientY));
  };
  const onBayClick = (e: React.MouseEvent) => {
    // Compute the U directly from the click, not from hover state — so a tap or a
    // click-without-prior-move still lands reliably.
    if (armed) onPlaceAt(yToU(e.clientY));
    else onSelectCable(null); // click empty space → clear the highlighted cable
  };

  const onDevDown = (e: React.PointerEvent, d: Device) => {
    if (armed) return; // placing — let the bay handle the click
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    onSelect(d.id);
    drag.current = { id: d.id, startY: e.clientY, startRu: d.ru ?? 1 };
    setHoverU(d.ru ?? 1);
  };
  const onDevUp = () => {
    if (drag.current && hoverU != null) {
      onMoveTo(drag.current.id, hoverU);
    }
    drag.current = null;
    setHoverU(null);
  };

  const cssVar = (name: string): string => `var(${name})`;

  /** Live device panel as SVG JSX (themeable). */
  const renderPanel = (d: Device) => {
    const r = deviceRect(rack, d);
    const panel: Rect = { x: origin.x + r.x, y: origin.y + r.y, w: r.w, h: r.h };
    const isSel = d.id === selectedId;

    // Jack/NIC centers feed cable endpoints; the shared art draws onto these same rects.
    const jacks = devicePortLayout(d, panel);
    for (const j of jacks) {
      portCenters.set(`${d.id}:${j.ifaceId}`, { x: j.x + j.w / 2, y: j.y + j.h / 2 });
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
    <svg
      ref={svgRef}
      data-testid="rack-canvas"
      className={styles.svg}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
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
    </svg>
  );
}
