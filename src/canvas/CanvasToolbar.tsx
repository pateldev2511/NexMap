import type { CanvasMode, Projection } from '@/store/projectStore';
import { NexIcon, type NexIconName } from '@/ui/icons/NexIcon';
import styles from './CanvasToolbar.module.css';

interface Props {
  mode: CanvasMode;
  onMode: (m: CanvasMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onHelp: () => void;
  projection: Projection;
  onToggleProjection: () => void;
  onAutoLayout: () => void;
}

/**
 * Floating canvas toolbar. NexMap uses custom SVG controls here so the editor
 * chrome matches the device icon system instead of falling back to text glyphs.
 */
export function CanvasToolbar({
  mode,
  onMode,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onHelp,
  projection,
  onToggleProjection,
  onAutoLayout,
}: Props) {
  const iso = projection === 'iso';
  const tool = (m: CanvasMode, icon: NexIconName, key: string, title: string) => (
    <button
      className={`${styles.tool} ${mode === m ? styles.active : ''}`}
      onClick={() => onMode(m)}
      title={`${title} (${key})`}
      aria-pressed={mode === m}
      // Earned-quiet demotes per BUTTON so the active tool never dims (M3c).
      data-demote={mode === m ? undefined : 'chrome-item'}
    >
      <NexIcon name={icon} className={styles.toolIcon} />
      <span className={styles.key}>{key}</span>
    </button>
  );

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Canvas tools" data-canvas-chrome>
      {tool('select', 'select', 'V', 'Select')}
      {tool('lasso', 'lasso', 'Q', 'Lasso select')}
      {tool('pan', 'pan', 'H', 'Pan')}
      {tool('connect', 'connect', 'C', 'Connect')}
      {tool('text', 'text', 'T', 'Text note')}
      {tool('shape', 'shape', 'R', 'Zone / shape')}
      <span className={styles.divider} />
      <button
        className={`${styles.tool} ${iso ? styles.active : ''}`}
        data-demote={iso ? undefined : 'chrome-item'}
        onClick={onToggleProjection}
        title={iso ? 'Switch to flat view' : 'Switch to isometric view'}
        aria-pressed={iso}
        aria-label="Toggle isometric view"
      >
        <NexIcon name="iso" className={styles.toolIcon} />
        <span className={styles.key}>{iso ? 'ISO' : '2D'}</span>
      </button>
      <button
        className={styles.icon}
        onClick={onAutoLayout}
        title="Auto-layout - tidy the diagram (Cmd+Shift+L)"
        aria-label="Auto-layout"
      >
        <NexIcon name="auto-layout" />
      </button>
      <span className={styles.divider} />
      <button
        className={styles.icon}
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Cmd+Z)"
        aria-label="Undo"
      >
        <NexIcon name="undo" />
      </button>
      <button
        className={styles.icon}
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Cmd+Shift+Z)"
        aria-label="Redo"
      >
        <NexIcon name="redo" />
      </button>
      <span className={styles.divider} />
      <button
        className={styles.icon}
        onClick={onHelp}
        title="Keyboard shortcuts (?)"
        aria-label="Help"
      >
        <NexIcon name="help" />
      </button>
    </div>
  );
}
