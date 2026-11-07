/** Flow HUD names its destination and lets you pick one; the verdict follows (#46). */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FlowHud } from './FlowOverlay';
import { useProjectStore } from '@/store/projectStore';
import { createDevice, createLink } from '@/model/schema';
import type { DeviceType } from '@/model/types';

const s = () => useProjectStore.getState();
beforeEach(() => {
  s().newProject('2026-01-01T00:00:00.000Z');
  s().setFlowMode(false);
});

const dev = (type: DeviceType, name: string) => createDevice(type, 0, 0, 'L', { name });
const isp = dev('isp', 'ISP');
const router = dev('router', 'R1');
const sw = dev('switch', 'SW1');
const pc = dev('end-user', 'PC');
const devices = [isp, router, sw, pc];
const links = [createLink(isp.id, router.id, 'L'), createLink(router.id, sw.id, 'L'), createLink(sw.id, pc.id, 'L')];

function hud(failed: string[]) {
  return <FlowHud devices={devices} links={links} failed={failed} onExit={() => {}} onReset={() => {}} />;
}

describe('Flow HUD · destination', () => {
  it('shows the active exits, then the chosen destination, as an accessible verdict', () => {
    const { rerender } = render(hud([isp.id]));
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Holding — nothing lost its path to the network.1 failed · 0 newly unreachable');
    const select = screen.getByLabelText('Destination to measure reachability to') as HTMLSelectElement;
    expect(select.selectedOptions[0]!.textContent).toBe('any exit: ISP, R1');
    // Exits are offered first, then other linked devices.
    expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Exits', 'Other devices']);

    fireEvent.change(select, { target: { value: isp.id } });
    expect(s().flowTarget).toBe(isp.id);
    rerender(hud([isp.id]));
    expect(status.textContent).toBe('ISP is down — 3 devices lost their path to it.1 failed · 3 newly unreachable');

    // Reversible: back to any exit.
    fireEvent.change(select, { target: { value: '' } });
    expect(s().flowTarget).toBeNull();
    rerender(hud([isp.id]));
    expect(status.textContent).toMatch(/^Holding/);
  });

  it('forgets the destination when Flow is left', () => {
    act(() => {
      s().setFlowMode(true);
      s().setFlowTarget(router.id);
    });
    act(() => s().setFlowMode(false));
    expect(s().flowTarget).toBeNull();
  });
});
