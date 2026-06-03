import type { CanvasMode } from '@/store/projectStore';
import styles from './CanvasToolbar.module.css';

interface Props {
  mode: CanvasMode;
  onMode: (m: CanvasMode) => void;
}

/** Floating canvas mode switcher (design review DA-DES-5.4). Esc returns to Select. */
export function CanvasToolbar({ mode, onMode }: Props) {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Canvas tools">
      <button
        className={`${styles.tool} ${mode === 'select' ? styles.active : ''}`}
        onClick={() => onMode('select')}
        title="Select (V)"
        aria-pressed={mode === 'select'}
      >
        ⬚ <span className={styles.key}>V</span>
      </button>
      <button
        className={`${styles.tool} ${mode === 'connect' ? styles.active : ''}`}
        onClick={() => onMode('connect')}
        title="Connect (C)"
        aria-pressed={mode === 'connect'}
      >
        ⤴ <span className={styles.key}>C</span>
      </button>
    </div>
  );
}
