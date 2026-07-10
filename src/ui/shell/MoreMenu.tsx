import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { keyboardRouter } from '@/input/router';
import { NexIcon } from '@/ui/icons/NexIcon';
import styles from './AppShell.module.css';

/**
 * Top-bar "More" dropdown. The panel is PORTALED to <body> and positioned
 * `fixed` from the trigger's viewport rect — never `position:absolute` inside
 * the topbar. Why: `.topbarActions` is an `overflow-x:auto` scroll container
 * (the v0.6.2 CI fix), and an absolutely-positioned child is clipped by it, so
 * the old `<details>` panel opened invisibly. A body portal escapes every
 * ancestor clip by construction.
 *
 * Closes on: item click (children call onClose), outside pointerdown
 * (capture-phase, so it beats canvas gesture handlers), Escape (router overlay,
 * so it stacks correctly with other overlays), and viewport resize/scroll
 * (the anchor rect would otherwise go stale).
 */
export function MoreMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  };

  // Position synchronously before paint so the panel never flashes at 0,0.
  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);

    // Outside pointerdown closes. Capture phase + a panel/trigger containment
    // check so a press inside the menu (or on the trigger) doesn't self-close,
    // and canvas handlers never see the closing press.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', close);
    // Any scroll (topbar, page) staleness-closes rather than chase the anchor.
    window.addEventListener('scroll', close, true);
    const offEsc = keyboardRouter.registerOverlay((e) => {
      if (e.key === 'Escape') {
        close();
        return true;
      }
      return false; // let every other key fall through to the app
    });
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      offEsc();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        className={styles.topbarBtn}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <NexIcon name="settings" />
        <span>More</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={styles.menuPanel}
            style={{ position: 'fixed', top: pos.top, right: pos.right }}
            role="menu"
            data-canvas-chrome
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}
