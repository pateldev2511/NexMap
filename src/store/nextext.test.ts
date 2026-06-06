/**
 * Store-level tests for applyNexText: it replaces the diagram atomically, aborts on
 * parse errors without mutating, and is a single undo entry.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';

const NOW = '2026-01-01T00:00:00.000Z';
const s = () => useProjectStore.getState();

beforeEach(() => s().newProject(NOW));

describe('applyNexText', () => {
  it('builds devices, links, subnets, and vlans from text', () => {
    const r = s().applyNexText(
      ['router R1', 'switch SW1', 'R1 - SW1 vlan=10', 'subnet 10.0.0.0/24 name=Core', 'vlan 10 name=Users'].join('\n'),
    );
    expect(r.ok).toBe(true);
    expect(s().devicesAll().map((d) => d.name).sort()).toEqual(['R1', 'SW1']);
    expect(s().linksAll()).toHaveLength(1);
    expect(s().subnetsAll()[0]?.cidr).toBe('10.0.0.0/24');
    expect(s().vlansAll()[0]?.vlanId).toBe(10);
  });

  it('REPLACES existing content rather than merging', () => {
    s().addDeviceAt('firewall', 0, 0);
    expect(s().devicesAll()).toHaveLength(1);
    s().applyNexText('router R1\nswitch SW1');
    const names = s().devicesAll().map((d) => d.name).sort();
    expect(names).toEqual(['R1', 'SW1']); // firewall gone
  });

  it('aborts without mutating when there are parse errors', () => {
    s().applyNexText('router R1');
    const before = s().devicesAll().length;
    const r = s().applyNexText('frobnicator X1'); // unknown type → error
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(s().devicesAll()).toHaveLength(before); // unchanged
  });

  it('is a single undoable transaction', () => {
    s().applyNexText('router R1\nswitch SW1\nR1 - SW1');
    expect(s().devicesAll()).toHaveLength(2);
    s().undo();
    expect(s().devicesAll()).toHaveLength(0);
  });

  it('returns warnings for auto-created nodes but still applies', () => {
    const r = s().applyNexText('R1 - SW1');
    expect(r.ok).toBe(true);
    expect(r.diagnostics.filter((d) => d.severity === 'warn').length).toBeGreaterThan(0);
    expect(s().devicesAll()).toHaveLength(2);
  });
});
