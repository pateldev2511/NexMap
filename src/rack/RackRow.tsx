/**
 * Multi-rack ROW view (schema v3). Renders every rack side by side in ONE interactive SVG
 * so cross-rack cables can be drawn between cabinets. Each rack shows BOTH faces as two
 * adjacent columns (Front | Rear) so nothing on the back is hidden. This is the overview:
 * devices are labeled blocks (not port-level detail — that lives in the focused editor).
 * Click a rack/device to focus + select it; reorder cabinets with the ◀ ▶ chevrons.
 * Per-rack U + power/weight budget is shown inline. (Cross-rack device moves are done via
 * the "Move to rack" control in the focused editor's selection panel.)
 */
import type { Device, Rack, RackCable } from '@/model/types';
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
import { slotOf } from './rackModel';
import { rackBudget } from './rackBudget';
import styles from './RackDesigner.module.css';

export interface RackRowProps {
  racks: Rack[];
  devices: Device[];
  cables: RackCable[];
  selectedId: string | null;
  searchHits: Set<string>;
  onFocusRack: (rackId: string) => void;
  onSelect: (deviceId: string | null) => void;
  onReorder: (rackId: string, dir: -1 | 1) => void;
}

/** Gap between the front and rear columns of the SAME rack (tighter than between racks). */
const FACE_GAP = 22;

export function RackRow({
  racks, devices, cables, selectedId, searchHits,
  onFocusRack, onSelect, onReorder,
}: RackRowProps) {
  // Two columns per rack (front, rear). Lay them out left-to-right.
  let x = 0;
  let height = 0;
  const cols = racks.map((rack) => {
    const size = cabinetSize(rack);
    const frontX = x;
    const rearX = x + size.width + FACE_GAP;
    x = rearX + size.width + RACK_GUTTER;
    height = Math.max(height, size.height);
    return { rack, frontX, rearX, size };
  });
  const width = Math.max(0, x - RACK_GUTTER);

  // deviceId → its face-column origin offset + center, for cable routing.
  const center = new Map<string, { x: number; y: number }>();
  const rackOf = new Map<string, string>();
  for (const c of cols) {
    for (const d of devices) {
      if (d.rackId !== c.rack.id || d.ru == null) continue;
      const colX = slotOf(d).side === 'rear' ? c.rearX : c.frontX;
      const origin = bayOrigin(colX);
      const r = deviceRect(c.rack, d);
      center.set(d.id, { x: origin.x + r.x + r.w / 2, y: origin.y + r.y + r.h / 2 });
      rackOf.set(d.id, c.rack.id);
    }
  }

  const renderFace = (rack: Rack, originX: number, face: 'front' | 'rear') => {
    const origin = bayOrigin(originX);
    const bayH = rack.ruHeight * U_PX;
    const size = cabinetSize(rack);
    return (
      <g key={`${rack.id}-${face}`}>
        <rect
          x={originX + 1} y={1} width={size.width - 2} height={size.height - 2} rx={10}
          fill="var(--chrome-bg)" stroke="var(--chrome-border)" strokeWidth={1.5}
          onClick={() => onFocusRack(rack.id)} style={{ cursor: 'pointer' }}
        />
        <rect x={origin.x} y={origin.y} width={BAY_W} height={bayH} rx={4} fill="var(--canvas-bg)" stroke="var(--chrome-border)" />
        <text x={origin.x} y={FRAME_PAD - 2} fontSize={11} fontWeight={700} fill="var(--chrome-fg)">{rack.name} · {face}</text>
        {/* U ticks (every 5) */}
        {Array.from({ length: rack.ruHeight }, (_, k) => k + 1).filter((u) => u % 5 === 0 || u === 1).map((u) => (
          <text key={u} x={origin.x - 6} y={origin.y + uLabelCenterY(rack, u) + 3} textAnchor="end" fontSize={8} fontFamily="var(--font-mono)" fill="var(--chrome-fg-muted)">{u}</text>
        ))}
        {/* devices on this face */}
        {devices.filter((d) => d.rackId === rack.id && d.ru != null && slotOf(d).side === face).map((d) => {
          const r = deviceRect(rack, d);
          const sel = d.id === selectedId;
          const hit = searchHits.has(d.id);
          return (
            <g key={d.id} onClick={(e) => { e.stopPropagation(); onSelect(d.id); onFocusRack(rack.id); }} style={{ cursor: 'pointer' }}>
              <rect
                x={origin.x + r.x} y={origin.y + r.y} width={r.w} height={r.h} rx={3}
                fill="var(--rack-chassis, #2b323b)"
                stroke={sel ? 'var(--accent)' : hit ? '#f59e0b' : 'var(--rack-chassis-bd, #10131b)'}
                strokeWidth={sel || hit ? 2 : 1}
              />
              <text x={origin.x + r.x + 6} y={origin.y + r.y + r.h / 2 + 4} fontSize={11} fontFamily="var(--font-mono)" fill="#eef2f7">{d.name}</text>
            </g>
          );
        })}
      </g>
    );
  };

  return (
    <div className={styles.rowScroll}>
      <svg width={width} height={height + 18} className={styles.svg} role="img" aria-label="All racks">
        {cols.map((c, i) => {
          const b = rackBudget(c.rack, devices);
          const bayH = c.rack.ruHeight * U_PX;
          const groupRight = c.rearX + c.size.width;
          return (
            <g key={c.rack.id}>
              {renderFace(c.rack, c.frontX, 'front')}
              {renderFace(c.rack, c.rearX, 'rear')}
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
          const pa = center.get(c.aEnd.deviceId);
          const pb = center.get(c.bEnd.deviceId);
          if (!pa || !pb) return null;
          const crossRack = rackOf.get(c.aEnd.deviceId) !== rackOf.get(c.bEnd.deviceId);
          const mx = (pa.x + pb.x) / 2 + (crossRack ? 0 : ((idx % 6) - 2.5) * 14);
          const my = crossRack ? Math.min(pa.y, pb.y) - 36 - (idx % 5) * 10 : (pa.y + pb.y) / 2;
          const d = `M ${pa.x} ${pa.y} Q ${mx} ${my} ${pb.x} ${pb.y}`;
          return (
            <g key={c.id} pointerEvents="none">
              <path d={d} fill="none" stroke="var(--chrome-bg)" strokeWidth={4} strokeLinecap="round" opacity={0.85} />
              <path d={d} fill="none" stroke={c.color} strokeWidth={2} strokeLinecap="round" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
