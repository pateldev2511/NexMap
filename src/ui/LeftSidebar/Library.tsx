import { useMemo, useState } from 'react';
import type { DeviceType } from '@/model/types';
import { IsoIcon } from '@/canvas/IsoIcon';
import { FlatIcon } from '@/canvas/FlatIcon';
import { deviceVisual } from '@/canvas/deviceVisuals';
import { useProjectStore } from '@/store/projectStore';
import { defaultDeviceName } from '@/model/schema';
import { NexIcon } from '@/ui/icons/NexIcon';
import styles from './Library.module.css';

/**
 * Object library (design review DA-DES-1.2). Category accordions with a "Common"
 * group expanded by default so a new user isn't hit with ~45 items at once. Items
 * drag onto the canvas (HTML5 DnD); the canvas creates a snapped, selected device.
 */
interface Group {
  name: string;
  types: DeviceType[];
  defaultOpen?: boolean;
}

const GROUPS: Group[] = [
  {
    name: 'Common',
    defaultOpen: true,
    types: [
      'router',
      'switch',
      'firewall',
      'access-point',
      'server',
      'cloud',
      'end-user',
      'generic',
    ],
  },
  { name: 'Network', types: ['wireless-controller', 'load-balancer', 'isp'] },
  { name: 'Compute & Storage', types: ['vm', 'container', 'storage'] },
  { name: 'Endpoints', types: ['printer', 'iot', 'camera'] },
  { name: 'Physical', types: ['rack', 'patch-panel', 'ups'] },
  {
    name: 'Cloud',
    types: [
      'vpc',
      'cloud-subnet',
      'internet-gateway',
      'nat-gateway',
      'route-table',
      'security-group',
      'vpn-gateway',
      'k8s',
      'managed-db',
      'object-storage',
    ],
  },
];

function LibraryItem({ type, iso }: { type: DeviceType; iso: boolean }) {
  const visual = deviceVisual(type);
  return (
    <div
      className={styles.item}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/nexmap-device', type);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={`Drag to add ${defaultDeviceName(type)}`}
    >
      <span className={styles.swatch}>
        {/* Match the active canvas projection: flat tiles in 2D, 3D models in iso. */}
        <svg width="34" height="26" viewBox="0 0 34 26" aria-hidden="true">
          {iso ? (
            <IsoIcon type={type} accent={visual.accent} cx={17} cy={11} size={19} />
          ) : (
            <FlatIcon type={type} accent={visual.accent} cx={17} cy={13} size={18} />
          )}
        </svg>
      </span>
      <span className={styles.itemLabel}>{defaultDeviceName(type)}</span>
    </div>
  );
}

export function Library() {
  const iso = useProjectStore((s) => s.projection) === 'iso';
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(GROUPS.filter((g) => g.defaultOpen).map((g) => g.name)),
  );

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return GROUPS;
    return GROUPS.map((g) => ({
      ...g,
      types: g.types.filter((t) => defaultDeviceName(t).toLowerCase().includes(q)),
    })).filter((g) => g.types.length > 0);
  }, [q]);

  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className={styles.library}>
      <input
        className={styles.search}
        placeholder="Search components"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search components"
      />
      <div className={styles.scroll}>
        {filtered.length === 0 && (
          <div className={styles.empty}>
            No components match “{query}”. Try a different term.
          </div>
        )}
        {filtered.map((g) => {
          const isOpen = q.length > 0 || open.has(g.name);
          return (
            <div key={g.name} className={styles.group}>
              <button className={styles.groupHeader} onClick={() => toggle(g.name)}>
                <span>{g.name}</span>
                <NexIcon name={isOpen ? 'chevron-down' : 'chevron-up'} />
              </button>
              {isOpen && (
                <div className={styles.grid}>
                  {g.types.map((t) => (
                    <LibraryItem key={t} type={t} iso={iso} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
