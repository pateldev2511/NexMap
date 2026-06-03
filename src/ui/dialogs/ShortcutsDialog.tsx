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
      ['Delete / Backspace', 'Delete selection'],
    ],
  },
  {
    title: 'Canvas',
    items: [
      ['V', 'Select tool'],
      ['C', 'Connect tool'],
      ['Scroll / two-finger', 'Pan'],
      ['Ctrl/Cmd + Scroll', 'Zoom'],
      ['Space + drag', 'Pan'],
      ['Ctrl/Cmd + 0', 'Fit to screen'],
      ['Ctrl/Cmd + +/-', 'Zoom in / out'],
      ['Alt (hold)', 'Suspend grid snap'],
      ['Esc', 'Deselect / cancel'],
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2>Keyboard shortcuts</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={styles.body}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            {GROUPS.map((g) => (
              <div key={g.title}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--chrome-fg-muted)', marginBottom: 6 }}>
                  {g.title}
                </div>
                {g.items.map(([key, desc]) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0', fontSize: 12 }}>
                    <span style={{ color: 'var(--chrome-fg-muted)' }}>{desc}</span>
                    <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{key}</kbd>
                  </div>
                ))}
              </div>
            ))}
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
