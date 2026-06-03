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
