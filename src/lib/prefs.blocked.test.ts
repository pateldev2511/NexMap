/**
 * #37: a denied storage policy makes even reading `window.localStorage` throw.
 * Preferences must fall back to in-memory defaults instead of taking the app down.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearPrefs,
  getConnectMode,
  getMotionLevel,
  getPanelOpen,
  getReduceMotion,
  getWheelAction,
  prefsPersistent,
  readPref,
  removePref,
  resetPrefsMemoryForTests,
  setConnectMode,
  setMotionLevel,
  storedPrefCount,
  writePref,
} from './prefs';

const denied = () => new DOMException('The operation is insecure.', 'SecurityError');

beforeEach(() => {
  localStorage.clear();
  resetPrefsMemoryForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetPrefsMemoryForTests();
});

describe('blocked storage (#37)', () => {
  it('a throwing localStorage getter yields defaults and session-only values', () => {
    const desc = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw denied();
      },
    });
    try {
      expect(readPref('nexmap.theme')).toBeNull();
      expect(getMotionLevel()).toBe('full');
      expect(getPanelOpen('left', true)).toBe(true);
      expect(storedPrefCount()).toBe(0);
      // Writes don't throw; they hold for the session.
      expect(writePref('nexmap.theme', 'dark')).toBe(false);
      setMotionLevel('subtle');
      expect(readPref('nexmap.theme')).toBe('dark');
      expect(getMotionLevel()).toBe('subtle');
      expect(prefsPersistent()).toBe(false);
      expect(() => removePref('nexmap.theme')).not.toThrow();
      expect(readPref('nexmap.theme')).toBeNull();
      expect(() => clearPrefs()).not.toThrow();
    } finally {
      Object.defineProperty(window, 'localStorage', desc);
    }
  });

  it('throwing reads fall back to defaults', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw denied();
    });
    expect(getConnectMode()).toBe('both');
    expect(getWheelAction()).toBe('pan');
    expect(getReduceMotion()).toBe(false);
  });

  it('throwing writes (quota/denied) keep the value in memory for the session', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => setConnectMode('drag')).not.toThrow();
    expect(getConnectMode()).toBe('drag');
    expect(prefsPersistent()).toBe(false);
  });

  it('a working storage persists and reports so', () => {
    expect(writePref('nexmap.theme', 'dark')).toBe(true);
    expect(localStorage.getItem('nexmap.theme')).toBe('dark');
    expect(prefsPersistent()).toBe(true);
  });
});
