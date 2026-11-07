/**
 * Small localStorage-backed preferences. Phase 2 introduces the connect-mode
 * preference; Phase 7 will grow this into a full settings surface.
 *
 * Every storage access in the app goes through readPref/writePref/removePref
 * (#37): a denied storage policy makes even reading `window.localStorage` throw
 * SecurityError, and that used to happen during first render, so the app never
 * mounted. Blocked or full storage falls back to an in-memory map — preferences
 * then last for this session only, and `prefsPersistent()` says so.
 */
import type { WheelAction } from '../input/wheel';

/** Session values that couldn't reach storage (written while it was blocked/full). */
const memory = new Map<string, string>();
let storageFailed = false;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    storageFailed = true;
    return null;
  }
}

export function readPref(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    storageFailed = true;
    return null;
  }
}

/** Store a preference. Returns whether it reached real storage (false = memory only). */
export function writePref(key: string, value: string): boolean {
  try {
    const s = storage();
    if (s) {
      s.setItem(key, value);
      memory.delete(key);
      return true;
    }
  } catch {
    storageFailed = true;
  }
  memory.set(key, value);
  return false;
}

export function removePref(key: string): void {
  memory.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {
    storageFailed = true;
  }
}

/** Forget every preference (Settings → clear local data). */
export function clearPrefs(): void {
  memory.clear();
  try {
    storage()?.clear();
  } catch {
    storageFailed = true;
  }
}

/** Number of stored entries (0 when storage is unreadable). */
export function storedPrefCount(): number {
  try {
    return storage()?.length ?? 0;
  } catch {
    storageFailed = true;
    return 0;
  }
}

/**
 * Whether preferences survive a reload. Probes once with a throwaway key, so a
 * storage that reads fine but refuses writes is caught too.
 */
export function prefsPersistent(): boolean {
  if (storageFailed) return false;
  const probe = 'nexmap.probe';
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return true;
  } catch {
    storageFailed = true;
    return false;
  }
}

/** Test hook: drop session-only values and the failure latch. */
export function resetPrefsMemoryForTests(): void {
  memory.clear();
  storageFailed = false;
}

export type ConnectMode = 'both' | 'click' | 'drag';

const KEY = 'nexmap.connectMode';

export function getConnectMode(): ConnectMode {
  const v = readPref(KEY);
  return v === 'click' || v === 'drag' ? v : 'both';
}

export function setConnectMode(mode: ConnectMode): void {
  writePref(KEY, mode);
}


const WHEEL_KEY = 'nexmap.wheelAction';

/**
 * What a plain (unmodified) wheel/two-finger scroll does on every canvas.
 * 'pan' is the default and matches DA-DES-5.1; 'zoom' is the explicit opt-in
 * that restores wheel-zoom (ctrl/pinch zooms in both modes regardless).
 */
export function getWheelAction(): WheelAction {
  const v = readPref(WHEEL_KEY);
  return v === 'zoom' ? 'zoom' : 'pan';
}

export function setWheelAction(action: WheelAction): void {
  writePref(WHEEL_KEY, action);
}

export type PanelId = 'left' | 'right' | 'bottom';

/** Panel open/closed state survives reloads (M3c: collapse is a choice). */
export function getPanelOpen(panel: PanelId, fallback: boolean): boolean {
  const v = readPref(`nexmap.panel.${panel}`);
  return v === null ? fallback : v === '1';
}

export function setPanelOpen(panel: PanelId, open: boolean): void {
  writePref(`nexmap.panel.${panel}`, open ? '1' : '0');
}

const RM_KEY = 'nexmap.reduceMotion';

export function getReduceMotion(): boolean {
  return readPref(RM_KEY) === '1';
}

export function setReduceMotion(on: boolean): void {
  writePref(RM_KEY, on ? '1' : '0');
  applyReduceMotion(on);
}

/** Apply the manual reduced-motion override (composes with prefers-reduced-motion). */
export function applyReduceMotion(on: boolean): void {
  document.documentElement.dataset.reduceMotion = on ? 'true' : 'false';
}

/**
 * How lively the canvas feels: `full` is the designed experience (flowing link
 * packets, pulsing LEDs, live screens); `subtle` keeps only the gentle breathing
 * and drops the traveling packets/sweeps; `off` freezes the whole living layer
 * while leaving ordinary UI transitions alone. This is a taste dial — the master
 * accessibility switch is still Reduced motion / prefers-reduced-motion, which
 * freezes everything regardless of this setting.
 */
export type MotionLevel = 'off' | 'subtle' | 'full';

const MOTION_KEY = 'nexmap.motionLevel';

export function getMotionLevel(): MotionLevel {
  const v = readPref(MOTION_KEY);
  return v === 'off' || v === 'subtle' ? v : 'full';
}

export function setMotionLevel(level: MotionLevel): void {
  writePref(MOTION_KEY, level);
  applyMotionLevel(level);
}

/** Reflect the living-motion level onto <html data-motion> for the CSS gates. */
export function applyMotionLevel(level: MotionLevel): void {
  document.documentElement.dataset.motion = level;
}
