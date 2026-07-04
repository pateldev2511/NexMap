import { useEffect, useRef } from 'react';
import { keyboardRouter } from '@/input/router';
import styles from './ContextMenu.module.css';

export interface MenuItem {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  separatorBefore?: boolean;
}

/**
 * Lightweight canvas context menu (Phase 1). Positioned at the cursor, dismisses
 * on outside click / Escape / scroll. Items are computed by the caller based on
 * what's under the pointer (device vs empty canvas).
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // Escape via the router's OVERLAY layer — the menu is the innermost
    // thing, so it closes before any gesture/mode/selection Escape runs.
    const unregister = keyboardRouter.registerOverlay((e) => {
      if (e.key === 'Escape') {
        onClose();
        return true;
      }
      return false;
    });
    window.addEventListener('mousedown', onDown);
    window.addEventListener('wheel', onClose, { passive: true });
    return () => {
      unregister();
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('wheel', onClose);
    };
  }, [onClose]);

  // Keep the menu on-screen.
  const left = Math.max(8, Math.min(x, window.innerWidth - 200));
  const top = Math.max(8, Math.min(y, window.innerHeight - items.length * 30 - 16));

  return (
    <div ref={ref} className={styles.menu} style={{ left, top }} role="menu">
      {items.map((item, i) => (
        <div key={i}>
          {item.separatorBefore && <div className={styles.sep} />}
          <button
            className={styles.item}
            disabled={item.disabled}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            role="menuitem"
          >
            <span>{item.label}</span>
            {item.shortcut && <span className={styles.shortcut}>{item.shortcut}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}
