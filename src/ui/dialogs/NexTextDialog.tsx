import { useMemo, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { parseNexText, serializeNexText, type Diagnostic } from '@/lib/nextext';
import styles from './NexTextDialog.module.css';

const STARTER = `# NexText — describe your network, then Apply.
# <type> <name> [key=value]   |   A - B   |   subnet <cidr>   |   vlan <id>

router R1 vendor=Cisco
switch SW1
server Web1 ip=10.0.0.10

R1 - SW1 vlan=10
SW1 - Web1 bandwidth=1G

subnet 10.0.0.0/24 name=Core gateway=10.0.0.1 vlan=10
vlan 10 name=Users
`;

/**
 * NexText editor. Type a network as text → laid-out, validated diagram. Applying
 * REPLACES the current diagram (one undoable step), so we confirm when there's
 * existing content. Diagnostics update live; Apply is blocked while errors exist.
 */
export function NexTextDialog({ onClose }: { onClose: () => void }) {
  const store = useProjectStore;
  const hasContent = useProjectStore((s) => s.devicesAll().length > 0);

  const initial = useMemo(() => {
    const s = store.getState();
    const devices = s.devicesAll();
    if (devices.length === 0) return STARTER;
    return serializeNexText({
      devices,
      links: s.linksAll(),
      subnets: s.subnetsAll(),
      vlans: s.vlansAll(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [src, setSrc] = useState(initial);
  const [applied, setApplied] = useState<string | null>(null);

  const diagnostics: Diagnostic[] = useMemo(() => parseNexText(src).diagnostics, [src]);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warns = diagnostics.filter((d) => d.severity === 'warn');

  const apply = () => {
    if (errors.length > 0) return;
    if (hasContent && !window.confirm('Replace the current diagram with this NexText? You can undo this.')) {
      return;
    }
    const result = store.getState().applyNexText(src);
    if (result.ok) {
      const w = result.diagnostics.filter((d) => d.severity === 'warn').length;
      setApplied(w > 0 ? `Applied with ${w} warning${w === 1 ? '' : 's'}.` : 'Applied.');
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2>NexText — text to diagram</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={styles.body}>
          <div className={styles.hint}>
            One statement per line. Devices: <code>router R1</code>. Links:{' '}
            <code>R1 - SW1 vlan=10</code> (use <code>-&gt;</code> for a direction). Also{' '}
            <code>subnet 10.0.0.0/24</code> and <code>vlan 10 name=Users</code>. Applying
            replaces the current diagram.
          </div>
          <textarea
            className={styles.editor}
            value={src}
            spellCheck={false}
            onChange={(e) => {
              setSrc(e.target.value);
              setApplied(null);
            }}
            aria-label="NexText source"
          />
          {diagnostics.length > 0 && (
            <div className={styles.diagnostics}>
              {diagnostics.map((d, i) => (
                <div key={i} className={`${styles.diag} ${styles[d.severity]}`}>
                  <span className={styles.lineBadge}>line {d.line}</span>
                  <span>{d.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className={styles.foot}>
          <span className={styles.footMsg}>
            {errors.length > 0
              ? `${errors.length} error${errors.length === 1 ? '' : 's'} — fix to apply`
              : applied
                ? applied
                : warns.length > 0
                  ? `${warns.length} warning${warns.length === 1 ? '' : 's'}`
                  : 'Ready'}
          </span>
          <button className={styles.btn} onClick={onClose}>
            Close
          </button>
          <button
            className={`${styles.btn} ${styles.primary}`}
            onClick={apply}
            disabled={errors.length > 0}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
