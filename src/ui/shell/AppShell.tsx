import { useEffect, useState, type ReactNode } from 'react';
import { NexIcon } from '@/ui/icons/NexIcon';
import { ErrorBoundary } from './ErrorBoundary';
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
  /**
   * Full-bleed canvas: hide the left/right network panels + their toggles so a
   * self-contained editor (e.g. the Rack Designer, which has its own library +
   * sidebar) gets the entire canvas region. Bottom panel is also suppressed.
   */
  fullBleed?: boolean;
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
  fullBleed = false,
}: AppShellProps) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const sync = () => {
      if (mq.matches) {
        setLeftOpen(false);
        setRightOpen(false);
      } else {
        setLeftOpen(true);
        setRightOpen(true);
      }
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const collapseLeft = fullBleed || !leftOpen;
  const collapseRight = fullBleed || !rightOpen;

  return (
    <div
      className={`${styles.shell} ${collapseLeft ? styles.leftClosed : ''} ${
        collapseRight ? styles.rightClosed : ''
      }`}
    >
      <header className={styles.topbar}>
        <div className={styles.brand}>
          Nex<span>Map</span>
        </div>
        {titleNode ?? <div className={styles.projectName}>{projectName}</div>}
        {!fullBleed && (
          <div className={styles.panelToggles}>
            <button
              className={styles.topbarBtn}
              onClick={() => setLeftOpen((v) => !v)}
              aria-pressed={leftOpen}
              title={leftOpen ? 'Hide library panel' : 'Show library panel'}
            >
              <NexIcon name="library" />
              <span>Library</span>
            </button>
            <button
              className={styles.topbarBtn}
              onClick={() => setRightOpen((v) => !v)}
              aria-pressed={rightOpen}
              title={rightOpen ? 'Hide inspector panel' : 'Show inspector panel'}
            >
              <NexIcon name="inspector" />
              <span>Inspector</span>
            </button>
          </div>
        )}
        <div className={styles.topbarSpacer} />
        <div className={styles.topbarActions}>{actions}</div>
      </header>

      {!fullBleed && (
        <aside className={styles.left} aria-label="Object library">
          {left ?? <div className={styles.panelHeader}>Library</div>}
        </aside>
      )}

      <main className={styles.canvas} aria-label="Design canvas">
        <ErrorBoundary>{canvas}</ErrorBoundary>
      </main>

      {!fullBleed && (
        <aside className={styles.right} aria-label="Properties inspector">
          {right ?? <div className={styles.panelHeader}>Inspector</div>}
        </aside>
      )}

      {!fullBleed && bottom && <div className={styles.bottom}>{bottom}</div>}

      <footer className={styles.status}>{status}</footer>
    </div>
  );
}
