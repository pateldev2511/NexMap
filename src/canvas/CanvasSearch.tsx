import { useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { defaultDeviceName } from '@/model/schema';
import styles from './CanvasSearch.module.css';

/**
 * Canvas search (⌘F): find a device by name / IP / role / type / vendor and jump
 * to it. Arrow keys navigate, Enter jumps-and-selects, Esc closes. Read-only —
 * never mutates the model, so it's safe to leave open while editing.
 */
export function CanvasSearch({ onClose }: { onClose: () => void }) {
  const rev = useProjectStore((s) => s.rev);
  const store = useProjectStore.getState;
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    void rev;
    const term = q.trim().toLowerCase();
    const matches = store()
      .devicesAll()
      .filter((d) => {
        if (!term) return true;
        return [
          d.name,
          d.managementIp,
          d.role,
          d.vendor,
          d.model,
          defaultDeviceName(d.type),
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term));
      });
    // Stable, useful ordering: by name.
    matches.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return matches.slice(0, 50);
  }, [q, rev, store]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  const jump = (id?: string) => {
    if (id) store().focusObject(id);
  };

  return (
    <div className={styles.wrap} role="dialog" aria-label="Find device">
      <input
        ref={inputRef}
        className={styles.input}
        placeholder="Find device by name, IP, role…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            jump(results[active]?.id);
          }
        }}
      />
      <div className={styles.count}>
        {results.length} match{results.length === 1 ? '' : 'es'}
      </div>
      <div className={styles.list}>
        {results.map((d, i) => (
          <button
            key={d.id}
            className={`${styles.item} ${i === active ? styles.active : ''}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => jump(d.id)}
          >
            <span className={styles.name}>{d.name || '(unnamed)'}</span>
            <span className={styles.meta}>
              {[defaultDeviceName(d.type), d.managementIp].filter(Boolean).join(' · ')}
            </span>
          </button>
        ))}
        {results.length === 0 && <div className={styles.empty}>No matches</div>}
      </div>
    </div>
  );
}
