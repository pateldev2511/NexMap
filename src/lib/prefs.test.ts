import { describe, it, expect, beforeEach } from 'vitest';
import { getMotionLevel, setMotionLevel, applyMotionLevel } from './prefs';

describe('living-motion level pref', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.motion;
  });

  it('defaults to full when unset or invalid', () => {
    expect(getMotionLevel()).toBe('full');
    localStorage.setItem('nexmap.motionLevel', 'nonsense');
    expect(getMotionLevel()).toBe('full');
  });

  it('persists the choice and reflects it onto <html data-motion>', () => {
    setMotionLevel('subtle');
    expect(getMotionLevel()).toBe('subtle');
    expect(document.documentElement.dataset.motion).toBe('subtle');
    setMotionLevel('off');
    expect(getMotionLevel()).toBe('off');
    expect(document.documentElement.dataset.motion).toBe('off');
  });

  it('applyMotionLevel sets the attribute without writing storage', () => {
    applyMotionLevel('off');
    expect(document.documentElement.dataset.motion).toBe('off');
    expect(localStorage.getItem('nexmap.motionLevel')).toBeNull();
  });
});
