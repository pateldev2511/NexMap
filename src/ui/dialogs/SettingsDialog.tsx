import { useEffect, useState } from 'react';
import {
  getConnectMode,
  setConnectMode,
  getReduceMotion,
  setReduceMotion,
  type ConnectMode,
} from '@/lib/prefs';
import { canWriteBack, canOpenPicker } from '@/persistence/fsaccess';
import styles from './ImportDialog.module.css';

/**
 * Settings + diagnostics (Phase 7). Persisted prefs (connect behavior, reduced
 * motion), browser-capability status, storage usage, and a destructive
 * clear-local-data action — the honest "your data is local" control surface.
 */
export function SettingsDialog({
  theme,
  onToggleTheme,
  onClose,
}: {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onClose: () => void;
}) {
  const [connect, setConnect] = useState<ConnectMode>(() => getConnectMode());
  const [reduceMotion, setRM] = useState(() => getReduceMotion());
  const [usage, setUsage] = useState<string>('…');
  const fsAvailable = canWriteBack || canOpenPicker;
  const idbAvailable = typeof indexedDB !== 'undefined';

  useEffect(() => {
    const nav = navigator as Navigator & { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } };
    nav.storage?.estimate?.().then((e) => {
      const used = e.usage ?? 0;
      const quota = e.quota ?? 0;
      const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
      setUsage(quota ? `${mb(used)} of ${mb(quota)}` : mb(used));
    }).catch(() => setUsage('unavailable'));
  }, []);

  async function clearData() {
    if (!confirm('Delete ALL local NexMap data (autosaves + preferences)? This cannot be undone. Export your project first if you want to keep it.')) return;
    try {
      localStorage.clear();
      if (idbAvailable) await new Promise<void>((res) => {
        const r = indexedDB.deleteDatabase('nexmap');
        r.onsuccess = r.onerror = r.onblocked = () => res();
      });
    } finally {
      location.reload();
    }
  }

  const Status = ({ ok, label }: { ok: boolean; label: string }) => (
    <div style={{ display: 'flex', gap: 8, fontSize: 12, padding: '2px 0' }}>
      <span style={{ color: ok ? 'var(--sev-info)' : 'var(--sev-warn)' }}>{ok ? '✓' : '⚠'}</span>
      <span>{label}</span>
    </div>
  );

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 94vw)' }}>
        <div className={styles.head}>
          <h2>Settings</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className={styles.body}>
          <div className={styles.mapGrid} style={{ gridTemplateColumns: '160px 1fr' }}>
            <label>Theme</label>
            <button className={styles.kindBtn} onClick={onToggleTheme} style={{ width: 'fit-content' }}>
              {theme === 'light' ? '☀ Light' : '☽ Dark'}
            </button>

            <label>Connect behavior</label>
            <select
              value={connect}
              onChange={(e) => { const m = e.target.value as ConnectMode; setConnect(m); setConnectMode(m); }}
            >
              <option value="both">Click or drag</option>
              <option value="drag">Drag only</option>
              <option value="click">Click only</option>
            </select>

            <label>Reduced motion</label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
              <input
                type="checkbox"
                checked={reduceMotion}
                onChange={(e) => { setRM(e.target.checked); setReduceMotion(e.target.checked); }}
              />
              Minimize animations
            </label>
          </div>

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--chrome-border)' }}>
            <div className={styles.summary} style={{ fontWeight: 600 }}>Browser capabilities</div>
            <Status ok={fsAvailable} label={fsAvailable ? 'File System Access — Save writes back to your file' : 'No File System Access — Save downloads a new file each time'} />
            <Status ok={idbAvailable} label={idbAvailable ? 'IndexedDB — autosave & recovery enabled' : 'IndexedDB unavailable — autosave is OFF (export often!)'} />
            <div style={{ fontSize: 12, color: 'var(--chrome-fg-muted)', padding: '2px 0' }}>
              Local storage used: {usage}
            </div>
          </div>

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--chrome-border)' }}>
            <div className={styles.summary}>
              All NexMap data stays on this device. Clearing browser data or using a
              private window can erase autosaves — export a <code>.nexmap</code> file to keep work.
            </div>
            <button
              className={styles.btn}
              style={{ borderColor: 'var(--sev-error)', color: 'var(--sev-error)' }}
              onClick={clearData}
            >
              Clear all local data…
            </button>
          </div>
        </div>
        <div className={styles.foot}>
          <button className={`${styles.btn} ${styles.primary}`} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
