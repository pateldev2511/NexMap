import { useRef } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { deviceVisual } from '@/canvas/deviceVisuals';
import type { Device, Rack } from '@/model/types';
import styles from './RackView.module.css';

const SLOT_H = 18; // px per rack unit

/**
 * Rack elevation view (Phase 6). Renders each rack as a vertical frame (U1 at the
 * bottom) with mounted devices at their RU positions. Drag a device vertically to
 * change its RU (snapped, undoable). Click selects (inspector edits the rest).
 */
export function RackView() {
  useProjectStore((s) => s.rev);
  const selection = useProjectStore((s) => s.selection);
  const s = useProjectStore.getState;
  const racks = s().racksAll();
  const devices = s().devicesAll();

  if (racks.length === 0) {
    return (
      <div className={styles.root}>
        <div className={styles.empty}>
          No racks yet. Add a rack in the Racks panel, then assign devices to it
          (Rack placement in the inspector).
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.racks}>
        {racks.map((rack) => (
          <RackFrame key={rack.id} rack={rack} devices={devices} selection={selection} />
        ))}
      </div>
    </div>
  );
}

function RackFrame({
  rack,
  devices,
  selection,
}: {
  rack: Rack;
  devices: Device[];
  selection: Set<string>;
}) {
  const slotsRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; startY: number; startRu: number } | null>(null);
  const s = useProjectStore.getState;
  const mounted = devices.filter((d) => d.rackId === rack.id && d.ru != null);
  const innerH = rack.ruHeight * SLOT_H;

  const onPointerDown = (e: React.PointerEvent, d: Device) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    s().select([d.id]);
    drag.current = { id: d.id, startY: e.clientY, startRu: d.ru ?? 1 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dU = Math.round((drag.current.startY - e.clientY) / SLOT_H); // up = +U
    const span = s().getDevice(drag.current.id)?.ruSpan ?? 1;
    const ru = Math.max(1, Math.min(rack.ruHeight - span + 1, drag.current.startRu + dU));
    const cur = s().getDevice(drag.current.id);
    if (cur && cur.ru !== ru) s().updateDevice(drag.current.id, { ru: cur.ru }, { ru });
  };
  const onPointerUp = () => {
    if (drag.current) {
      s().endEdit();
      s().runValidation();
      drag.current = null;
    }
  };

  return (
    <div className={styles.rack}>
      <div className={styles.rackName}>
        {rack.name} · {rack.ruHeight}U
      </div>
      <div className={styles.frame}>
        <div className={styles.units}>
          {Array.from({ length: rack.ruHeight }, (_, i) => (
            <div key={i} className={styles.unit} style={{ height: SLOT_H }}>
              {i + 1}
            </div>
          ))}
        </div>
        <div
          ref={slotsRef}
          className={styles.slots}
          style={{ height: innerH }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {mounted.map((d) => {
            const span = d.ruSpan ?? 1;
            const top = (rack.ruHeight - (d.ru! + span - 1)) * SLOT_H;
            return (
              <div
                key={d.id}
                className={`${styles.device} ${selection.has(d.id) ? styles.selected : ''}`}
                style={{ top, height: span * SLOT_H - 1, background: deviceVisual(d.type).accent }}
                onPointerDown={(e) => onPointerDown(e, d)}
                title={`${d.name} — U${d.ru}${span > 1 ? `–U${d.ru! + span - 1}` : ''}`}
              >
                <span className={styles.deviceName}>{d.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
