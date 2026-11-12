import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { saveDocument } from '@/persistence/fsaccess';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
  /** What this guards, for the message and the log ("the canvas", "NexMap"). */
  label?: string;
  /** `full` fills the nearest positioned ancestor; `panel` is a compact in-panel message. */
  variant?: 'full' | 'panel';
  /** `full` only: cover the whole viewport (the app-root boundary has no positioned parent). */
  viewport?: boolean;
  /** When any of these change while showing the fallback, the boundary resets itself. */
  resetKeys?: readonly unknown[];
  /** Extra fallback actions, e.g. "Exit presentation". Rendered first-class beside Try again. */
  extraActions?: ReactNode;
}
interface State {
  error: Error | null;
}

const sameKeys = (a: readonly unknown[] = [], b: readonly unknown[] = []) =>
  a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/**
 * Contains a render-time error to the region it guards, so one failing panel shows
 * a recoverable message instead of white-screening the app. The model lives in a
 * module-scoped store (not React state), so a render crash does not discard it; the
 * full fallback can also save the current project to a file, fully locally.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Console only: nothing is sent anywhere.
    console.error(`[NexMap] ${this.props.label ?? 'A region'} crashed:`, error);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && !sameKeys(prev.resetKeys, this.props.resetKeys)) this.reset();
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { label, variant = 'full', viewport, extraActions } = this.props;
    if (variant === 'panel') {
      return <PanelFallback label={label} onRetry={this.reset} />;
    }
    return (
      <FullFallback
        label={label}
        message={error.message}
        viewport={viewport}
        extraActions={extraActions}
        onRetry={this.reset}
      />
    );
  }
}

function PanelFallback({ label, onRetry }: { label?: string; onRetry: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);
  return (
    <div role="alert" className={styles.panel} data-testid="panel-error">
      <div className={styles.panelTitle}>This panel hit an error</div>
      {label && <div>{label}</div>}
      <button ref={btn} type="button" className={styles.btn} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function FullFallback({
  label,
  message,
  viewport,
  extraActions,
  onRetry,
}: {
  label?: string;
  message: string;
  viewport?: boolean;
  extraActions?: ReactNode;
  onRetry: () => void;
}) {
  const first = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Autosave is per tab: a view-only tab (another tab is the editor) does not write.
  let viewOnly = false;
  try {
    viewOnly = useProjectStore.getState().readOnly;
  } catch {
    /* the fallback must never throw */
  }

  useEffect(() => {
    first.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);

  async function saveCopy() {
    setStatus('Saving…');
    try {
      const doc = useProjectStore.getState().getDocument();
      const saved = await saveDocument(doc, null);
      setStatus(`Saved a copy as ${saved.fileName}.`);
    } catch (e) {
      // A cancelled picker is not a failure.
      if ((e as DOMException)?.name === 'AbortError') setStatus(null);
      else setStatus('Could not save a copy from here. Reload and try File → Save.');
    }
  }

  return (
    <div
      role="alert"
      className={`${styles.full} ${viewport ? styles.viewport : ''}`}
      data-testid="full-error"
    >
      <div className={styles.title}>
        {label ? `Something went wrong in ${label}.` : 'Something went wrong.'}
      </div>
      <div className={styles.detail}>{message}</div>
      <div className={styles.note}>
        Nothing was uploaded; the project is still in memory in this tab. Save a copy to
        keep a file of it before you reload.
        {viewOnly
          ? ' This tab is view-only, so it is not saving changes.'
          : ' This browser also keeps a local draft that it offers to recover after a reload.'}
      </div>
      <div className={styles.actions} ref={first}>
        <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={onRetry}>
          Try again
        </button>
        {extraActions}
        <button type="button" className={styles.btn} onClick={() => void saveCopy()}>
          Save a copy (.nexmap)
        </button>
        <button type="button" className={styles.btn} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
      {status && (
        <div role="status" className={styles.status}>
          {status}
        </div>
      )}
    </div>
  );
}
