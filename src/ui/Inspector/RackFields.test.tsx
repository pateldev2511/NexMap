/** #81: RackFields must not re-render on store changes that leave the racks alone. */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { Profiler } from 'react';
import { RackFields } from './Inspector';
import { useProjectStore } from '@/store/projectStore';

const s = () => useProjectStore.getState();
beforeEach(() => s().newProject('2026-01-01T00:00:00.000Z'));

describe('Inspector · RackFields subscription', () => {
  it('re-renders on a rack change, not on an unrelated one', () => {
    const rackId = s().addRack('Rack A');
    s().addDeviceAt('server', 0, 0);
    const dev = s().devicesAll()[0]!;
    let renders = 0;
    render(
      <Profiler id="rf" onRender={() => renders++}>
        <RackFields device={dev} set={() => {}} endEdit={() => {}} />
      </Profiler>,
    );
    const base = renders;
    act(() => { s().addDeviceAt('switch', 300, 0); });
    act(() => { s().addDeviceAt('router', 600, 0); });
    expect(renders).toBe(base);
    act(() => { s().updateRack(rackId, { name: 'Rack A' }, { name: 'Rack B' }); });
    expect(renders).toBeGreaterThan(base);
  });
});
