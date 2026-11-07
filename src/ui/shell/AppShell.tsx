import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NexIcon } from '@/ui/icons/NexIcon';
import { NexMapLogo } from '@/ui/deck/NexMapLogo';
import { getPanelOpen, setPanelOpen } from '@/lib/prefs';
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
  // Collapse is a CHOICE — it survives reloads (M3c). The narrow-viewport
  // auto-collapse is transient and never overwrites the saved preference.
  const [leftOpen, setLeftOpen] = useState(() => getPanelOpen('left', true));
  const [rightOpen, setRightOpen] = useState(() => getPanelOpen('right', true));

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const sync = () => {
      if (mq.matches) {
        setLeftOpen(false);
        setRightOpen(false);
      } else {
        setLeftOpen(getPanelOpen('left', true));
        setRightOpen(getPanelOpen('right', true));
      }
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const toggleLeft = () =>
    setLeftOpen((v) => {
      setPanelOpen('left', !v);
      return !v;
    });
  const toggleRight = () =>
    setRightOpen((v) => {
      setPanelOpen('right', !v);
      return !v;
    });

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
          <NexMapLogo size={26} />
        </div>
        {titleNode ?? <div className={styles.projectName}>{projectName}</div>}
        {!fullBleed && (
          <div className={styles.panelToggles}>
            <button
              className={styles.topbarBtn}
              onClick={toggleLeft}
              aria-pressed={leftOpen}
              title={leftOpen ? 'Hide library panel' : 'Show library panel'}
            >
              <NexIcon name="library" />
              <span>Library</span>
            </button>
            <button
              className={styles.topbarBtn}
              onClick={toggleRight}
              aria-pressed={rightOpen}
              title={rightOpen ? 'Hide inspector panel' : 'Show inspector panel'}
            >
              <NexIcon name="inspector" />
              <span>Inspector</span>
            </button>
          </div>
        )}
        <div className={styles.topbarSpacer} />
        <ActionStrip>{actions}</ActionStrip>
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
        <aside
          className={styles.right}
          aria-label="Properties inspector"
          data-demote="panel"
        >
          {right ?? <div className={styles.panelHeader}>Inspector</div>}
        </aside>
      )}

      {!fullBleed && bottom && <div className={styles.bottom}>{bottom}</div>}

      <footer className={styles.status}>{status}</footer>
    </div>
  );
}

/**
 * The topbar's action buttons. When they don't fit, the strip scrolls (touch,
 * trackpad, a plain mouse wheel, or Tab moving focus), and the edge with more
 * buttons beyond it fades so the overflow is visible.
 */
function ActionStrip({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.dataset.moreStart = String(el.scrollLeft > 1);
      el.dataset.moreEnd = String(el.scrollLeft < max - 1);
    };
    // A vertical wheel scrolls the strip sideways, but only when it can move.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    const ro = new ResizeObserver(update);
    const observeAll = () => {
      ro.observe(el);
      for (const child of el.children) ro.observe(child);
      update();
    };
    // Buttons come and go with the designer and selection.
    const mo = new MutationObserver(observeAll);
    mo.observe(el, { childList: true });
    el.addEventListener('scroll', update, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    observeAll();
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener('scroll', update);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div ref={ref} className={styles.topbarActions}>
      {children}
    </div>
  );
}
