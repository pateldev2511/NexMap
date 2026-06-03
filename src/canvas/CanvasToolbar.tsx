import type { CanvasMode } from '@/store/projectStore';
import styles from './CanvasToolbar.module.css';

interface Props {
  mode: CanvasMode;
  onMode: (m: CanvasMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onHelp: () => void;
}

/**
 * Floating canvas toolbar (Phase 1, FossFLOW-inspired). Tools on the left, history
 * + help on the right. Esc returns to Select. Text/Zone/Shape/Lasso tools land in
 * later Phase 1 batches as their interactions are built.
 */
export function CanvasToolbar({ mode, onMode, canUndo, canRedo, onUndo, onRedo, onHelp }: Props) {
  const tool = (m: CanvasMode, glyph: string, key: string, title: string) => (
    <button
      className={`${styles.tool} ${mode === m ? styles.active : ''}`}
      onClick={() => onMode(m)}
      title={`${title} (${key})`}
      aria-pressed={mode === m}
    >
      {glyph} <span className={styles.key}>{key}</span>
    </button>
  );

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Canvas tools">
      {tool('select', '⬚', 'V', 'Select')}
      {tool('lasso', '◌', 'Q', 'Lasso select')}
      {tool('pan', '✋', 'H', 'Pan')}
      {tool('connect', '⤴', 'C', 'Connect')}
      {tool('text', 'T', 'T', 'Text note')}
      {tool('shape', '▭', 'R', 'Zone / shape')}
      <span className={styles.divider} />
      <button className={styles.icon} onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo">
        ↶
      </button>
      <button className={styles.icon} onClick={onRedo} disabled={!canRedo} title="Redo (⌘⇧Z)" aria-label="Redo">
        ↷
      </button>
      <span className={styles.divider} />
      <button className={styles.icon} onClick={onHelp} title="Keyboard shortcuts (?)" aria-label="Help">
        ?
      </button>
    </div>
  );
}
