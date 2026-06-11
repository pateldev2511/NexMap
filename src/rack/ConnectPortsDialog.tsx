import { useMemo, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import type { Device } from '@/model/types';
import { isPortCabled } from './rackCables';
import styles from './RackDesigner.module.css';

/** Contrast-safe 8-swatch cable palette (the locked manual-color decision). */
export const CABLE_COLORS = [
  '#2563eb', '#16a34a', '#dc2626', '#f59e0b',
  '#7c3aed', '#06b6d4', '#6b7280', '#111827',
] as const;

/**
 * List-first port cabling (eng + design decision). Pick source device+port, dest
 * device+port, color, optional label/length. Fully keyboard-operable; no pixel-hunting.
 */
export function ConnectPortsDialog({
  rackId,
  onClose,
}: {
  rackId: string;
  onClose: () => void;
}) {
  const s = useProjectStore.getState;
  // Cross-rack capable: every mounted device with ports, from ANY rack. The dialog groups
  // them by rack so a cable can span cabinets.
  const racks = s().racksAll();
  const rackName = useMemo(() => new Map(racks.map((r) => [r.id, r.name])), [racks]);
  const devices = useMemo(
    () => s().devicesAll().filter((d) => d.rackId != null && (d.interfaces?.length ?? 0) > 0),
    [s],
  );
  // devices grouped by rack, current rack first, for the <optgroup> layout.
  const byRack = useMemo(() => {
    const groups = new Map<string, Device[]>();
    for (const d of devices) {
      const k = d.rackId!;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(d);
    }
    return [...groups.entries()].sort(([a], [b]) => (a === rackId ? -1 : b === rackId ? 1 : 0));
  }, [devices, rackId]);
  const cables = s().rackCablesAll();

  const inCurrent = devices.filter((d) => d.rackId === rackId);
  const [aDev, setADev] = useState(inCurrent[0]?.id ?? devices[0]?.id ?? '');
  const [aPort, setAPort] = useState('');
  const [bDev, setBDev] = useState(inCurrent[1]?.id ?? devices[1]?.id ?? devices[0]?.id ?? '');
  const [bPort, setBPort] = useState('');
  const [color, setColor] = useState<string>(CABLE_COLORS[0]);
  const [label, setLabel] = useState('');
  const [lengthFt, setLengthFt] = useState('');
  const [err, setErr] = useState('');

  const portsOf = (devId: string): { id: string; name: string; used: boolean }[] => {
    const dev: Device | undefined = devices.find((d) => d.id === devId);
    return (dev?.interfaces ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      used: isPortCabled(cables, devId, i.id),
    }));
  };

  const submit = () => {
    setErr('');
    if (!aDev || !aPort || !bDev || !bPort) {
      setErr('Pick a source and destination port.');
      return;
    }
    const id = s().connectRackCable(
      { deviceId: aDev, ifaceId: aPort },
      { deviceId: bDev, ifaceId: bPort },
      color,
      label.trim() || undefined,
    );
    if (id == null) {
      setErr('That connection is invalid (same port, or a port is already cabled).');
      return;
    }
    const len = Number(lengthFt);
    if (lengthFt.trim() && Number.isFinite(len) && len > 0) {
      s().updateRackCable(id, { lengthFt: undefined }, { lengthFt: len });
    }
    onClose();
  };

  const PortSelect = ({
    dev,
    setDev,
    port,
    setPort,
    title,
  }: {
    dev: string;
    setDev: (v: string) => void;
    port: string;
    setPort: (v: string) => void;
    title: string;
  }) => (
    <div className={styles.field}>
      <label>{title}</label>
      <select value={dev} onChange={(e) => { setDev(e.target.value); setPort(''); }}>
        {byRack.map(([rid, ds]) => (
          <optgroup key={rid} label={rackName.get(rid) ?? 'Rack'}>
            {ds.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <select value={port} onChange={(e) => setPort(e.target.value)}>
        <option value="">Select port…</option>
        {portsOf(dev).map((p) => (
          <option key={p.id} value={p.id} disabled={p.used}>
            {p.name}{p.used ? ' (cabled)' : ''}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Connect ports">
        <div className={styles.dhead}>Connect ports</div>
        <div className={styles.dbody}>
          {devices.length < 2 ? (
            <div className={styles.err}>Add at least two devices with ports to the rack first.</div>
          ) : (
            <>
              <PortSelect dev={aDev} setDev={setADev} port={aPort} setPort={setAPort} title="From" />
              <PortSelect dev={bDev} setDev={setBDev} port={bPort} setPort={setBPort} title="To" />
              <div className={styles.field}>
                <label>Cable color</label>
                <div className={styles.swatches}>
                  {CABLE_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`${styles.swatch} ${color === c ? styles.on : ''}`}
                      style={{ background: c }}
                      aria-label={`color ${c}`}
                      aria-pressed={color === c}
                      onClick={() => setColor(c)}
                    />
                  ))}
                </div>
              </div>
              <div className={styles.field}>
                <label>Label (optional)</label>
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. uplink" />
              </div>
              <div className={styles.field}>
                <label>Length in ft (optional — recommended for cross-rack runs)</label>
                <input value={lengthFt} onChange={(e) => setLengthFt(e.target.value)} inputMode="numeric" placeholder="e.g. 10" />
              </div>
              {err && <div className={styles.err}>{err}</div>}
            </>
          )}
        </div>
        <div className={styles.dfoot}>
          <button className={styles.btn} onClick={onClose}>Cancel</button>
          <button
            className={`${styles.btn} ${styles.primary}`}
            onClick={submit}
            disabled={devices.length < 2}
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}
