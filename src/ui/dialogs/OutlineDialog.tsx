import { useMemo, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { defaultDeviceName } from '@/model/schema';
import { NexIcon } from '@/ui/icons/NexIcon';
import styles from './ImportDialog.module.css';

/**
 * Accessible topology outline. The canvas is visual; this is the keyboard- and
 * screen-reader-friendly alternative representation: every device, grouped by
 * layer, with its connections, as a list of buttons. Activating one selects the
 * device and centers the canvas on it (focusObject), so it doubles as fast
 * jump-navigation for large diagrams.
 */
export function OutlineDialog({ onClose }: { onClose: () => void }) {
  const rev = useProjectStore((s) => s.rev);
  const store = useProjectStore.getState;
  const [q, setQ] = useState('');

  const groups = useMemo(() => {
    void rev;
    const st = store();
    const devices = st.devicesAll();
    const links = st.linksAll();
    const nameOf = (id: string) => st.getDevice(id)?.name || '(unknown)';

    // device id → sorted unique names of connected devices
    const conn = new Map<string, Set<string>>();
    for (const l of links) {
      (conn.get(l.sourceId) ?? conn.set(l.sourceId, new Set()).get(l.sourceId)!).add(
        nameOf(l.targetId),
      );
      (conn.get(l.targetId) ?? conn.set(l.targetId, new Set()).get(l.targetId)!).add(
        nameOf(l.sourceId),
      );
    }

    const term = q.trim().toLowerCase();
    const match = (d: (typeof devices)[number]) =>
      !term ||
      [d.name, d.managementIp, d.role, defaultDeviceName(d.type)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));

    const byLayer = new Map<string, typeof devices>();
    for (const d of devices) {
      if (!match(d)) continue;
      (byLayer.get(d.layerId) ?? byLayer.set(d.layerId, []).get(d.layerId)!).push(d);
    }

    return st
      .layersAll()
      .map((layer) => ({
        layer,
        devices: (byLayer.get(layer.id) ?? []).sort((a, b) =>
          (a.name || '').localeCompare(b.name || ''),
        ),
      }))
      .filter((g) => g.devices.length > 0)
      .map((g) => ({
        ...g,
        rows: g.devices.map((d) => ({
          id: d.id,
          name: d.name || defaultDeviceName(d.type),
          type: defaultDeviceName(d.type),
          ip: d.managementIp,
          links: [...(conn.get(d.id) ?? [])].sort(),
        })),
      }));
  }, [q, rev, store]);

  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  function jump(id: string) {
    store().focusObject(id);
    onClose();
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Topology outline"
      >
        <div className={styles.head}>
          <h2>Topology outline</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <NexIcon name="close" />
          </button>
        </div>
        <div className={styles.body}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter devices…"
            aria-label="Filter devices"
            autoFocus
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 10px',
              borderRadius: 7,
              border: '1px solid var(--chrome-border)',
              background: 'var(--canvas-bg)',
              color: 'var(--chrome-fg)',
              marginBottom: 10,
            }}
          />
          <div style={{ fontSize: 11, color: 'var(--chrome-fg-muted)', marginBottom: 8 }}>
            {total} device{total === 1 ? '' : 's'}
          </div>

          {total === 0 && (
            <div style={{ color: 'var(--chrome-fg-muted)', fontSize: 13 }}>
              No devices{q ? ' match your filter' : ' yet'}.
            </div>
          )}

          {groups.map((g) => (
            <div key={g.layer.id} role="group" aria-label={g.layer.name} style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--chrome-fg-muted)',
                  margin: '4px 0 6px',
                }}
              >
                {g.layer.name}
              </div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {g.rows.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => jump(r.id)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        border: '1px solid transparent',
                        background: 'transparent',
                        color: 'var(--chrome-fg)',
                        borderRadius: 7,
                        padding: '7px 9px',
                        cursor: 'pointer',
                        display: 'block',
                      }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                      onBlur={(e) => (e.currentTarget.style.borderColor = 'transparent')}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = 'var(--canvas-bg)')
                      }
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</span>
                      <span style={{ color: 'var(--chrome-fg-muted)', fontSize: 12 }}>
                        {' · '}
                        {r.type}
                        {r.ip ? ` · ${r.ip}` : ''}
                      </span>
                      <div style={{ fontSize: 11, color: 'var(--chrome-fg-muted)', marginTop: 2 }}>
                        {r.links.length === 0
                          ? 'No connections'
                          : `Connects to: ${r.links.join(', ')}`}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
