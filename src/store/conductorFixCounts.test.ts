/**
 * conductorFixCounts: the proactive-palette read that dry-runs every safe fixer
 * and reports how many changes each would make on the current design. Pure — it
 * must never mutate the model.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

beforeEach(() => s().newProject(NOW));

describe('conductorFixCounts', () => {
  it('is all-zero on a clean, empty project', () => {
    const counts = s().conductorFixCounts();
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });

  it('counts the changes each applicable fixer would make', () => {
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('switch', 200, 0);
    const c = s().addDeviceAt('server', 400, 0);
    s().addSubnet('10.0.0.0/24');
    s().updateDevice(a, {}, { name: 'Core', managementIp: '10.0.0.5' });
    s().updateDevice(b, {}, { name: 'Core', managementIp: '10.0.0.5' }); // dup name + dup ip
    s().updateDevice(c, {}, { name: '', managementIp: '192.168.9.9' }); // blank name + orphan ip
    s().addVlan(10, 'Eng');
    s().addVlan(10, 'Fin'); // dup vlan id

    const counts = s().conductorFixCounts();
    expect(counts['dedupe-names']).toBe(1); // one device re-numbered off "Core"
    expect(counts['name-unnamed']).toBe(1); // the blank server
    expect(counts['dedupe-vlans']).toBe(1); // one VLAN moved off 10
    expect(counts['dedupe-ips']).toBe(1); // one of the .5 pair re-homed
    expect(counts['cover-orphans']).toBe(1); // a /24 for 192.168.9.x
    expect(counts['prune-links']).toBe(0);
    expect(counts['clear-ifaces']).toBe(0);
  });

  it('does not mutate the model (pure read)', () => {
    const a = s().addDeviceAt('switch', 0, 0);
    const b = s().addDeviceAt('switch', 200, 0);
    s().updateDevice(a, {}, { name: 'Core', managementIp: '10.0.0.5' });
    s().updateDevice(b, {}, { name: 'Core', managementIp: '10.0.0.5' });
    const revBefore = s().rev;

    s().conductorFixCounts();
    s().conductorFixCounts();

    expect(s().rev).toBe(revBefore);
    // names and IPs untouched — a read, not a fix
    const names = s().devicesAll().map((d) => d.name);
    expect(names.filter((x) => x === 'Core')).toHaveLength(2);
  });
});
