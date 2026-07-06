import { useRef, useEffect, type ReactNode, type KeyboardEvent } from 'react';
import styles from './SelectionToolbar.module.css';

/**
 * Generic shell for the floating selection toolbar (M3): positioned by
 * toolbarPlace.ts, marked data-canvas-chrome so canvas wheel handlers ignore
 * it, a REAL roving tabindex (one Tab stop for the whole toolbar, arrows move
 * within — the WAI-ARIA toolbar pattern, not 14 Tab stops), and Escape
 * returns focus to the canvas WITHOUT clearing the selection
 * (stopPropagation keeps it from the keyboard router's innermost chain).
 */
export function SelectionToolbar({
  left,
  top,
  label,
  children,
  barRef,
}: {
  left: number;
  top: number;
  label: string;
  children: ReactNode;
  /** Lets the owner measure the rendered size for placement. */
  barRef?: React.Ref<HTMLDivElement>;
}) {
  const localRef = useRef<HTMLDivElement | null>(null);

  const focusables = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>('button, input, select')].filter(
      (el) => !(el as HTMLButtonElement).disabled,
    );

  /** One Tab stop: only `active` keeps tabIndex 0, the rest go to -1. */
  const setRoving = (active: HTMLElement | null) => {
    const root = localRef.current;
    if (!root) return;
    const items = focusables(root);
    const stop = active && items.includes(active) ? active : items[0] ?? null;
    for (const el of items) el.tabIndex = el === stop ? 0 : -1;
  };

  // Re-assert after every render — the button matrix enables/disables per
  // selection, and a newly-disabled element must not remain the Tab stop.
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    setRoving(localRef.current?.contains(active) ? active : null);
  });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      // Back to the canvas (containers carry tabIndex=-1), not document.body —
      // a blur() stranded keyboard users at the top of the page.
      const surface = localRef.current?.closest<HTMLElement>('[data-canvas-surface]');
      if (surface) surface.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const root = localRef.current;
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLElement>('button, input, select')].filter(
      (el) => !(el as HTMLButtonElement).disabled,
    );
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    // Roving focus only between buttons — arrow keys inside text inputs edit text.
    if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;
    e.preventDefault();
    const i = Math.max(0, items.indexOf(active as HTMLElement));
    const next = e.key === 'ArrowRight' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      ref={(el) => {
        localRef.current = el;
        if (typeof barRef === 'function') barRef(el);
        else if (barRef) (barRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }}
      className={styles.bar}
      style={{ left, top }}
      role="toolbar"
      aria-label={label}
      data-canvas-chrome
      onKeyDown={onKeyDown}
      onFocus={(e) => setRoving(e.target as HTMLElement)}
      onPointerDown={(e) => e.stopPropagation() /* toolbar presses never reach the canvas */}
    >
      {children}
    </div>
  );
}

export function ToolbarSep() {
  return <span className={styles.sep} />;
}

export const toolbarStyles = styles;
