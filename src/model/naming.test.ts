import { describe, it, expect } from 'vitest';
import { uniqueName, planDeduplicateNames, planNameDevices } from './naming';
import { createDevice } from './schema';
import type { Device, DeviceType } from './types';

const L = 'layer';
const dev = (name: string): Device => createDevice('server', 0, 0, L, { name });
const typed = (type: DeviceType, name: string): Device => createDevice(type, 0, 0, L, { name });
/** Lowest device id, matching planDeduplicateNames' "who keeps the name" rule. */
const lowestId = (ds: Device[]) => [...ds].sort((a, b) => (a.id < b.id ? -1 : 1))[0]!;

describe('uniqueName', () => {
  it('keeps the base name when nothing clashes', () => {
    expect(uniqueName('Server', [])).toBe('Server');
    expect(uniqueName('Server', ['Router', 'Switch'])).toBe('Server');
  });

  it('numbers from 2 once the base is taken', () => {
    expect(uniqueName('Server', ['Server'])).toBe('Server 2');
    expect(uniqueName('Server', ['Server', 'Server 2'])).toBe('Server 3');
  });

  it('fills the lowest free gap, not just the end', () => {
    // "Server 2" is free even though "Server 3" is taken.
    expect(uniqueName('Server', ['Server', 'Server 3'])).toBe('Server 2');
  });

  it('treats the base and its numbered forms independently', () => {
    // Base is free even if a numbered form exists.
    expect(uniqueName('Server', ['Server 2'])).toBe('Server');
  });
});

describe('planDeduplicateNames', () => {
  it('keeps the lowest-id device and renames the rest', () => {
    const a = dev('Core');
    const b = dev('Core');
    const plan = planDeduplicateNames([a, b]);
    const keeper = lowestId([a, b]);
    const moved = a.id === keeper.id ? b : a;
    expect(plan).toEqual([{ deviceId: moved.id, name: 'Core 2' }]);
  });

  it('renames two of three sharers to distinct, numbered names', () => {
    const ds = [dev('Core'), dev('Core'), dev('Core')];
    const plan = planDeduplicateNames(ds);
    expect(plan).toHaveLength(2);
    const names = plan.map((p) => p.name);
    expect(names).toEqual(['Core 2', 'Core 3']);
    expect(new Set(names).size).toBe(2);
    // The lowest-id device keeps "Core" (is not renamed).
    expect(plan.some((p) => p.deviceId === lowestId(ds).id)).toBe(false);
  });

  it('groups case-insensitively, like the duplicate-name validator', () => {
    const a = dev('Core');
    const b = dev('core');
    const plan = planDeduplicateNames([a, b]);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.deviceId).toBe(lowestId([a, b]).id === a.id ? b.id : a.id);
  });

  it('never re-mints a name that already exists, case-insensitively', () => {
    // Two "Core" plus an existing "core 2" → the mover must skip to "Core 3".
    const a = dev('Core');
    const b = dev('Core');
    const c = dev('core 2');
    const plan = planDeduplicateNames([a, b, c]);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.name).toBe('Core 3');
  });

  it('leaves blank names alone (that is the no-name nudge, not a duplicate)', () => {
    const a = dev('   ');
    const b = dev('');
    expect(planDeduplicateNames([a, b])).toEqual([]);
  });

  it('is a no-op when every name is already distinct', () => {
    expect(planDeduplicateNames([dev('Core'), dev('Edge')])).toEqual([]);
  });
});

describe('planNameDevices', () => {
  it('labels a blank device with its type default', () => {
    const a = typed('switch', '');
    const plan = planNameDevices([a]);
    expect(plan).toEqual([{ deviceId: a.id, name: 'Switch' }]);
  });

  it('treats whitespace-only names as blank', () => {
    const a = typed('router', '   ');
    expect(planNameDevices([a])).toEqual([{ deviceId: a.id, name: 'Router' }]);
  });

  it('numbers same-type blanks so the batch stays distinct', () => {
    const a = typed('switch', '');
    const b = typed('switch', '');
    const plan = planNameDevices([a, b]);
    expect(plan.map((p) => p.name)).toEqual(['Switch', 'Switch 2']);
  });

  it('never collides with a name already on the board', () => {
    // A named "Switch" already exists → the blank switch must become "Switch 2".
    const named = typed('switch', 'Switch');
    const blank = typed('switch', '');
    const plan = planNameDevices([named, blank]);
    expect(plan).toEqual([{ deviceId: blank.id, name: 'Switch 2' }]);
  });

  it('leaves already-named devices untouched', () => {
    expect(planNameDevices([dev('Core'), typed('router', 'Edge')])).toEqual([]);
  });

  it('does not create a duplicate-name warning for mixed types', () => {
    const plan = planNameDevices([typed('switch', ''), typed('server', '')]);
    expect(plan.map((p) => p.name)).toEqual(['Switch', 'Server']);
  });
});
