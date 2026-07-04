import { useEffect } from 'react';
import { isQuietEarned, onQuietEarned } from '@/input/quiet';

/**
 * M3c demotion driver. Writes two attributes on <html>:
 *   data-quiet="true"        — 4s without pointer activity over any chrome,
 *                              AND quiet has been earned (first completed
 *                              gesture). Chrome surfaces drop to 60%.
 *   data-canvas-hover="true" — the pointer is over a canvas surface; the
 *                              persistent panels soften to 85%.
 * CSS in global.css consumes these (opacity only, hover/focus restores,
 * the reduced-motion kill switch makes transitions instant).
 */
export const QUIET_DELAY_MS = 4000;

export function useQuietChrome(): void {
  useEffect(() => {
    const root = document.documentElement;
    let timer: number | null = null;
    let lastQuiet = '';
    let lastHover = '';

    const write = (key: 'quiet' | 'canvasHover', v: boolean) => {
      const s = v ? 'true' : 'false';
      if (key === 'quiet' ? lastQuiet === s : lastHover === s) return;
      if (key === 'quiet') lastQuiet = s;
      else lastHover = s;
      root.dataset[key] = s;
    };

    const arm = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (isQuietEarned()) write('quiet', true);
      }, QUIET_DELAY_MS);
    };

    const onMove = (e: PointerEvent) => {
      const t = e.target as Element | null;
      write('canvasHover', !!t?.closest?.('[data-canvas-surface]'));
      // Activity over chrome wakes it and restarts the idle clock; working
      // on the canvas lets chrome keep quieting — that is the point.
      if (t?.closest?.('[data-demote], [data-canvas-chrome]')) {
        write('quiet', false);
        arm();
      }
    };

    const offEarn = onQuietEarned(arm);
    window.addEventListener('pointermove', onMove, { passive: true });
    arm();
    return () => {
      offEarn();
      window.removeEventListener('pointermove', onMove);
      if (timer != null) window.clearTimeout(timer);
      delete root.dataset.quiet;
      delete root.dataset.canvasHover;
    };
  }, []);
}
