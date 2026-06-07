import { useState } from 'react';
import { getConnectMode, setConnectMode, type ConnectMode } from '@/lib/prefs';
import { NexIcon } from '@/ui/icons/NexIcon';
import styles from './ImportDialog.module.css';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'File',
    items: [
      ['Ctrl/Cmd + N', 'New project'],
      ['Ctrl/Cmd + O', 'Open .nexmap'],
      ['Ctrl/Cmd + S', 'Save'],
      ['Ctrl/Cmd + E', 'Export'],
    ],
  },
  {
    title: 'Edit',
    items: [
      ['Ctrl/Cmd + Z', 'Undo'],
      ['Ctrl/Cmd + Shift + Z', 'Redo'],
      ['Ctrl/Cmd + A', 'Select all'],
      ['Ctrl/Cmd + D', 'Duplicate selection'],
      ['Double-click text', 'Edit text on canvas'],
      ['Delete / Backspace', 'Delete selection'],
    ],
  },
  {
    title: 'Canvas',
    items: [
      ['Ctrl/Cmd + K', 'Command palette'],
      ['V', 'Select tool'],
      ['C', 'Connect tool'],
      ['Ctrl/Cmd + F', 'Find device'],
      ['Ctrl/Cmd + Shift + L', 'Auto-layout (tidy)'],
      ['Scroll / two-finger', 'Pan'],
      ['Ctrl/Cmd + Scroll', 'Zoom'],
      ['Space + drag', 'Pan'],
      ['Right / Middle-drag', 'Pan'],
      ['Ctrl/Cmd + 0', 'Fit to screen'],
      ['2', 'Zoom to selection'],
      ['Ctrl/Cmd + +/-', 'Zoom in / out'],
      ['Alt (hold)', 'Suspend grid snap'],
      ['Esc', 'Deselect / cancel'],
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [connect, setConnect] = useState<ConnectMode>(() => getConnectMode());
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2>Keyboard shortcuts &amp; settings</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <NexIcon name="close" />
          </button>
        </div>
        <div className={styles.body}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            {GROUPS.map((g) => (
              <div key={g.title}>
                <div
                  style={{
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--chrome-fg-muted)',
                    marginBottom: 6,
                  }}
                >
                  {g.title}
                </div>
                {g.items.map(([key, desc]) => (
                  <div
                    key={key}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '3px 0',
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: 'var(--chrome-fg-muted)' }}>{desc}</span>
                    <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 18,
              paddingTop: 14,
              borderTop: '1px solid var(--chrome-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--chrome-fg-muted)' }}>
              Connect behavior:
            </span>
            <select
              value={connect}
              onChange={(e) => {
                const m = e.target.value as ConnectMode;
                setConnect(m);
                setConnectMode(m);
              }}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--chrome-border)',
                background: 'var(--canvas-bg)',
                color: 'var(--chrome-fg)',
              }}
            >
              <option value="both">Click or drag</option>
              <option value="drag">Drag only</option>
              <option value="click">Click only</option>
            </select>
          </div>
        </div>
        <div className={styles.foot}>
          <button className={`${styles.btn} ${styles.primary}`} onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
