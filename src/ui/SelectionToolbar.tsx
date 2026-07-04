import { useRef, type ReactNode, type KeyboardEvent } from 'react';
import styles from './SelectionToolbar.module.css';

/**
 * Generic shell for the floating selection toolbar (M3): positioned by
 * toolbarPlace.ts, marked data-canvas-chrome so canvas wheel handlers ignore
 * it, roving arrow-key focus, and Escape returns focus to the canvas WITHOUT
 * clearing the selection (stopPropagation keeps it from the keyboard
 * router's innermost chain).
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

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      (document.activeElement as HTMLElement | null)?.blur();
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
