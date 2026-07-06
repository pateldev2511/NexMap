import { useEffect, useRef } from 'react';
import type { DeviceType } from '@/model/types';
import { defaultDeviceName } from '@/model/schema';
import { keyboardRouter } from '@/input/router';
import styles from './QuickCreateMenu.module.css';

/**
 * In-canvas device picker (M4b/M4c): opened by double-clicking empty canvas
 * or by dropping a connection on empty space (FigJam's quick-create). Small,
 * keyboard-first, closes on Escape or click-away, never a full dialog.
 */
export const QUICK_CREATE_TYPES: DeviceType[] = [
  'router',
  'switch',
  'firewall',
  'server',
  'access-point',
  'load-balancer',
  'storage',
  'end-user',
  'cloud',
];

export function QuickCreateMenu({
  left,
  top,
  vw,
  vh,
  title,
  onPick,
  onClose,
}: {
  left: number;
  top: number;
  vw: number;
  vh: number;
  title: string;
  onPick: (type: DeviceType) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Clamp inside the canvas (estimated box; small enough that estimate ≈ real).
  // Coarse pointers get 44px rows (see the CSS) — the estimate must match or
  // the clamp lets the taller menu run off-screen.
  const coarse =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const W = coarse ? 200 : 176;
  const H = 34 + QUICK_CREATE_TYPES.length * (coarse ? 44 : 26);
  const cl = Math.max(8, Math.min(left, vw - W - 8));
  const ct = Math.max(8, Math.min(top, vh - H - 8));

  useEffect(() => {
    menuRef.current?.querySelector('button')?.focus();
    // On close (pick, Escape, click-away) the focused button unmounts, which
    // would strand keyboard focus at document.body — hand it back to the
    // canvas container instead.
    const surface = menuRef.current?.closest<HTMLElement>('[data-canvas-surface]');
    return () => surface?.focus?.();
  }, []);

  // Router overlay while open: without this, Delete/Cmd+Z/tool-mode keys fall
  // through to the canvas BEHIND the menu (deleting the selection, popping the
  // history entry the pending pick depends on). Escape closes here even if
  // focus escaped the menu. Returning true only stops the ROUTER — the menu's
  // own React handlers and native button activation are unaffected. Tab stays
  // free so keyboard users can leave.
  useEffect(() => {
    return keyboardRouter.registerOverlay((e) => {
      if (e.key === 'Escape') {
        onClose();
        return true;
      }
      return e.key !== 'Tab';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* click-away backdrop — a stray click closes, it never creates */}
      <div className={styles.backdrop} onPointerDown={onClose} />
      <div
        ref={menuRef}
        className={styles.menu}
        style={{ left: cl, top: ct }}
        role="menu"
        aria-label={title}
        data-canvas-chrome
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const items = [...(menuRef.current?.querySelectorAll('button') ?? [])];
            const i = items.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              e.key === 'ArrowDown'
                ? (i + 1) % items.length
                : (i - 1 + items.length) % items.length;
            items[next]?.focus();
          }
        }}
      >
        <div className={styles.title}>{title}</div>
        {QUICK_CREATE_TYPES.map((t) => (
          <button key={t} role="menuitem" onClick={() => onPick(t)}>
            {defaultDeviceName(t)}
          </button>
        ))}
      </div>
    </>
  );
}
