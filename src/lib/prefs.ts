/**
 * Small localStorage-backed preferences. Phase 2 introduces the connect-mode
 * preference; Phase 7 will grow this into a full settings surface.
 */
export type ConnectMode = 'both' | 'click' | 'drag';

const KEY = 'nexmap.connectMode';

export function getConnectMode(): ConnectMode {
  const v = localStorage.getItem(KEY);
  return v === 'click' || v === 'drag' ? v : 'both';
}

export function setConnectMode(mode: ConnectMode): void {
  localStorage.setItem(KEY, mode);
}

const RM_KEY = 'nexmap.reduceMotion';

export function getReduceMotion(): boolean {
  return localStorage.getItem(RM_KEY) === '1';
}

export function setReduceMotion(on: boolean): void {
  localStorage.setItem(RM_KEY, on ? '1' : '0');
  applyReduceMotion(on);
}

/** Apply the manual reduced-motion override (composes with prefers-reduced-motion). */
export function applyReduceMotion(on: boolean): void {
  document.documentElement.dataset.reduceMotion = on ? 'true' : 'false';
}
