// Starter rack templates come out of the box with their power drawn sensibly.
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from './projectStore';
import { RACK_TEMPLATES } from '@/rack/rackTemplates';
import { rackInsights } from '@/rack/rackInsights';
import { pduFeedCoverage } from '@/rack/rackPower';

const s = () => useProjectStore.getState();
beforeEach(() => {
  s().newProject('2026-01-01T00:00:00.000Z');
});

describe('rack templates — power', () => {
  it.each(RACK_TEMPLATES.map((t) => [t.id, t] as const))('%s: every feed its gear needs has a PDU with outlets to spare', (_id, t) => {
    const ids = s().applyRackTemplate(t);
    const racks = s().racksAll().filter((r) => ids.includes(r.id));
    const devices = s().devicesAll().filter((d) => d.rackId && ids.includes(d.rackId));
    expect(rackInsights({ racks, devices, cables: [] }).filter((i) => i.action === 'add-pdu')).toEqual([]);
  });

  it('the redundant enterprise racks put every cord on both feeds, one full-height PDU each', () => {
    const t = RACK_TEMPLATES.find((x) => x.id === 'ent-core-42u')!;
    const [rackId] = s().applyRackTemplate(t);
    const devices = s().devicesAll().filter((d) => d.rackId === rackId);
    const pdus = devices.filter((d) => d.mount === 'rail');
    expect(pdus.map((d) => [d.name, d.powerFeed, d.bay, d.ruSpan])).toEqual([
      ['pdu-a', 'A', 'right', 42],
      ['pdu-b', 'B', 'left', 42],
    ]);
    const [a, b] = pduFeedCoverage({ id: rackId! }, devices);
    expect(a!.cords).toBe(b!.cords); // dual-corded: one cord per feed
    expect(a!.cords).toBeLessThanOrEqual(a!.outlets);
  });

  it.each(RACK_TEMPLATES.map((t) => [t.id, t] as const))('%s: no strip or UPS gives out, now or if a feed fails', (_id, t) => {
    const ids = s().applyRackTemplate(t);
    const racks = s().racksAll().filter((r) => ids.includes(r.id));
    const devices = s().devicesAll().filter((d) => d.rackId && ids.includes(d.rackId));
    expect(rackInsights({ racks, devices, cables: [] }).filter((i) => i.action === 'review-pdu' && i.severity !== 'info').map((i) => i.title)).toEqual([]);
  });

  it('the enterprise racks back feed A and feed B with a UPS each', () => {
    const t = RACK_TEMPLATES.find((x) => x.id === 'ent-core-42u')!;
    const [rackId] = s().applyRackTemplate(t);
    const ups = s().devicesAll().filter((d) => d.rackId === rackId && d.type === 'ups' && d.mount !== 'rail');
    expect(ups.map((d) => [d.name, d.powerFeed ?? 'A']).sort()).toEqual([['ups-a', 'A'], ['ups-b', 'B']]);
  });
});
