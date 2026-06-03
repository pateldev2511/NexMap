import type { ReactNode } from 'react';
import styles from './AppShell.module.css';

interface AppShellProps {
  /** Center canvas surface — the primary region. */
  canvas: ReactNode;
  /** Left object library. */
  left?: ReactNode;
  /** Right properties inspector. */
  right?: ReactNode;
  /** Top bar trailing actions (e.g. theme toggle, perf-harness link). */
  actions?: ReactNode;
  /** Collapsible bottom data panel (inventory, links, validation). */
  bottom?: ReactNode;
  /** Status bar content (zoom, autosave, validation summary). */
  status?: ReactNode;
  projectName?: string;
  /** Optional node rendered in place of the static project name (e.g. editable title). */
  titleNode?: ReactNode;
}

/**
 * Canvas-primary editor shell (design review §5). The canvas dominates; the
 * left/right panels are recessive chrome; the bottom data panel is collapsed by
 * default and not yet mounted (arrives with M5/M8).
 */
export function AppShell({
  canvas,
  left,
  right,
  actions,
  bottom,
  status,
  projectName = 'Untitled NexMap Project',
  titleNode,
}: AppShellProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          Nex<span>Map</span>
        </div>
        {titleNode ?? <div className={styles.projectName}>{projectName}</div>}
        <div className={styles.topbarSpacer} />
        <div className={styles.topbarActions}>{actions}</div>
      </header>

      <aside className={styles.left} aria-label="Object library">
        {left ?? <div className={styles.panelHeader}>Library</div>}
      </aside>

      <main className={styles.canvas} aria-label="Design canvas">
        {canvas}
      </main>

      <aside className={styles.right} aria-label="Properties inspector">
        {right ?? <div className={styles.panelHeader}>Inspector</div>}
      </aside>

      {bottom && <div className={styles.bottom}>{bottom}</div>}

      <footer className={styles.status}>{status}</footer>
    </div>
  );
}
