/** A validation finding opens the field that needs repair, and the field clears with it (#45). */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BottomPanel } from './BottomPanel';
import { Inspector } from '@/ui/Inspector/Inspector';
import { useProjectStore } from '@/store/projectStore';

const s = () => useProjectStore.getState();
beforeEach(() => {
  localStorage.clear(); // the panel's open state persists; start collapsed every time
  s().newProject('2026-01-01T00:00:00.000Z');
});

function openValidation() {
  fireEvent.click(screen.getByRole('button', { name: /^Validation/ }));
}

describe('Validation · open the field to fix', () => {
  it('takes an invalid subnet CIDR to its IP Plan field, which clears once corrected', () => {
    const id = s().addSubnet('10.0.0.0/33');
    s().runValidation();
    render(<BottomPanel />);
    openValidation();
    fireEvent.click(screen.getByRole('button', { name: '"10.0.0.0/33" is not a valid subnet CIDR.' }));

    // One action: the IP Plan tab is showing and the CIDR field has focus, marked.
    const cidr = screen.getByLabelText('Subnet CIDR') as HTMLInputElement;
    expect(document.activeElement).toBe(cidr);
    expect(cidr.getAttribute('aria-invalid')).toBe('true');
    expect(cidr.dataset.tip).toBe('"10.0.0.0/33" is not a valid subnet CIDR.');

    fireEvent.change(cidr, { target: { value: '10.0.0.0/24' } });
    act(() => s().runValidation());
    expect(s().subnetsAll().find((x) => x.id === id)!.cidr).toBe('10.0.0.0/24');
    expect(cidr.getAttribute('aria-invalid')).toBeNull();
    expect(cidr.dataset.tip).toBeUndefined();
    expect(s().issues.some((i) => i.code === 'invalid-subnet-cidr')).toBe(false);
    // The subnet's next finding (no gateway) now marks the gateway field instead.
    expect(screen.getByLabelText('Gateway').getAttribute('aria-invalid')).toBe('true');
  });

  it('takes a gateway finding to the gateway field', () => {
    const id = s().addSubnet('10.0.0.0/24');
    s().updateSubnet(id, { gateway: undefined }, { gateway: '192.0.2.1' });
    s().runValidation();
    render(<BottomPanel />);
    openValidation();
    fireEvent.click(screen.getByRole('button', { name: /^Gateway 192\.0\.2\.1 is outside/ }));
    expect(document.activeElement).toBe(screen.getByLabelText('Gateway'));
  });

  it('lists each device holding a duplicate IP and opens the exact address field', async () => {
    const r1 = s().addDeviceAt('router', 0, 0);
    const sw = s().addDeviceAt('switch', 200, 0);
    s().updateDevice(r1, {}, { name: 'R1', managementIp: '2001:db8::1' });
    s().updateDevice(sw, {}, { name: 'SW1', interfaces: [{ id: 'p1', name: 'Gi0/1', ip: '2001:0db8:0:0:0:0:0:1/64' }] });
    s().runValidation();
    render(
      <>
        <BottomPanel />
        <Inspector />
      </>,
    );
    openValidation();
    const chips = ['R1 · management IP', 'SW1 · Gi0/1'].map((name) => screen.getByRole('button', { name }));
    fireEvent.click(chips[1]!);
    expect([...s().selection]).toEqual([sw]);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Interface IP')));

    fireEvent.click(chips[0]!);
    expect([...s().selection]).toEqual([r1]);
    await waitFor(() =>
      expect((document.activeElement as HTMLInputElement).value).toBe('2001:db8::1'),
    );
  });

  it('shows both VLANs of a duplicate VLAN ID and opens either one', () => {
    s().addVlan(10, 'Users');
    const second = s().addVlan(11, 'Voice');
    s().updateVlan(second, { vlanId: 11 }, { vlanId: 10 });
    s().runValidation();
    render(<BottomPanel />);
    openValidation();
    fireEvent.click(screen.getByRole('button', { name: 'Voice (10)' }));
    const ids = screen.getAllByLabelText('VLAN ID');
    expect(document.activeElement).toBe(ids[1]);
    expect(ids.map((el) => el.getAttribute('aria-invalid'))).toEqual(['true', 'true']);
  });

  it('still jumps to a device on the canvas for a device finding', () => {
    const a = s().addDeviceAt('router', 0, 0);
    s().updateDevice(a, {}, { name: '' });
    s().runValidation();
    render(<BottomPanel />);
    openValidation();
    const before = s().focusTick;
    fireEvent.click(screen.getByRole('button', { name: 'Device has no name.' }));
    expect(s().focusTarget).toBe(a);
    expect(s().focusTick).toBe(before + 1);
  });
});
