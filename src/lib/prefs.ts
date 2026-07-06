/**
 * Small localStorage-backed preferences. Phase 2 introduces the connect-mode
 * preference; Phase 7 will grow this into a full settings surface.
 */
import type { WheelAction } from '../input/wheel';

export type ConnectMode = 'both' | 'click' | 'drag';

const KEY = 'nexmap.connectMode';

export function getConnectMode(): ConnectMode {
  const v = localStorage.getItem(KEY);
  return v === 'click' || v === 'drag' ? v : 'both';
}

export function setConnectMode(mode: ConnectMode): void {
  localStorage.setItem(KEY, mode);
}


const WHEEL_KEY = 'nexmap.wheelAction';

/**
 * What a plain (unmodified) wheel/two-finger scroll does on every canvas.
 * 'pan' is the default and matches DA-DES-5.1; 'zoom' is the explicit opt-in
 * that restores wheel-zoom (ctrl/pinch zooms in both modes regardless).
 */
export function getWheelAction(): WheelAction {
  const v = localStorage.getItem(WHEEL_KEY);
  return v === 'zoom' ? 'zoom' : 'pan';
}

export function setWheelAction(action: WheelAction): void {
  localStorage.setItem(WHEEL_KEY, action);
}

export type PanelId = 'left' | 'right' | 'bottom';

/** Panel open/closed state survives reloads (M3c: collapse is a choice). */
export function getPanelOpen(panel: PanelId, fallback: boolean): boolean {
  const v = localStorage.getItem(`nexmap.panel.${panel}`);
  return v === null ? fallback : v === '1';
}

export function setPanelOpen(panel: PanelId, open: boolean): void {
  localStorage.setItem(`nexmap.panel.${panel}`, open ? '1' : '0');
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
