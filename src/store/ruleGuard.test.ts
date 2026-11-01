/**
 * Rule guard: once an edit settles, a declared rule that held and now doesn't gets
 * a banner naming the step — for any edit, not just deletes — and the banner
 * retracts itself if the rule holds again.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const s = () => useProjectStore.getState();
beforeEach(() => {
  s().newProject('2026-01-01T00:00:00.000Z');
  useProjectStore.setState({ flash: null });
});

/** Two cameras in CCTV (VLAN 20), the rule declared and met, the guard settled. */
function setup() {
  const cctv = s().addSubnet('10.20.0.0/24');
  s().updateSubnet(cctv, {}, { name: 'CCTV', vlanId: 20 });
  const cams = ['10.20.0.10', '10.20.0.11'].map((ip) => {
    const id = s().addDeviceAt('camera', 0, 0);
    s().updateDevice(id, {}, { role: 'camera', managementIp: ip });
    s().endEdit();
    return id;
  });
  s().addCustomRule('placement', 'camera', 'VLAN 20', 0);
  s().runValidation();
  useProjectStore.setState({ flash: null });
  return cams;
}

describe('rule guard', () => {
  it('an edit that breaks a held rule says so once it settles — not mid-typing', () => {
    const [cam] = setup();
    s().updateDevice(cam!, { managementIp: '10.20.0.10' }, { managementIp: '10.10.0.10' });
    s().runValidation(); // the debounced pass while the field still has focus
    expect(s().flash).toBeNull();
    s().endEdit(); // blur
    expect(s().flash).toBe('That edit broke Every “camera” is on VLAN 20. ⌘Z puts it back.');
  });

  it('retracts its banner when the rule holds again', () => {
    const [cam] = setup();
    s().updateDevice(cam!, { managementIp: '10.20.0.10' }, { managementIp: '10.2.0.10' }); // a typo
    s().endEdit();
    expect(s().flash).toMatch(/^That edit broke/);
    // The typo got fixed: the rule holds again, so the warning goes.
    s().updateDevice(cam!, { managementIp: '10.2.0.10' }, { managementIp: '10.20.0.10' });
    s().endEdit();
    expect(s().flash).toBeNull();
  });

  it('an undo that breaks a rule is put back with redo', () => {
    const [cam] = setup();
    s().updateDevice(cam!, { managementIp: '10.20.0.10' }, { managementIp: '10.20.0.50' });
    s().endEdit();
    s().updateDevice(cam!, { managementIp: '10.20.0.50' }, { managementIp: '10.10.0.50' });
    s().endEdit();
    s().updateDevice(cam!, { managementIp: '10.10.0.50' }, { managementIp: '10.20.0.60' }); // fixed again
    s().endEdit();
    useProjectStore.setState({ flash: null });
    s().undo(); // back to 10.10.0.50
    s().runValidation();
    expect(s().flash).toBe('That undo broke Every “camera” is on VLAN 20. ⌘⇧Z puts it back.');
  });

  it('declaring a broken rule is not an edit that broke it', () => {
    setup();
    s().addCustomRule('count', 'camera', '', 3);
    s().runValidation();
    expect(s().flash).toBe('Declared At least 3 “camera” — 1 short.');
  });

  it('opening another document is not an edit', () => {
    setup();
    s().newProject('2026-01-02T00:00:00.000Z');
    s().runValidation();
    expect(s().flash).toBeNull();
  });

  it('a rule already broken stays quiet when an edit leaves it broken', () => {
    const [cam] = setup();
    s().addCustomRule('count', 'camera', '', 3); // broken from the start
    s().runValidation();
    useProjectStore.setState({ flash: null });
    s().updateDevice(cam!, {}, { name: 'Lobby cam' });
    s().endEdit();
    expect(s().flash).toBeNull();
  });
});
