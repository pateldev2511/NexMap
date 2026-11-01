import { describe, expect, it } from 'vitest';
import { createDevice, createInterface, createLink, createRackCable, createSubnet } from './schema';
import { createPlacementRule, evaluateCustomRules, explainOffenders, planPortRetag } from './invariants';
import { describePortVlan, portVlans } from './portVlan';
import type { Device, Link } from './types';

const L = 'layer';
const cctv = createSubnet('10.20.0.0/24', { name: 'CCTV', vlanId: 20 });

/** SW1 with access port Gi0/3 (VLAN `swVlan`) patched to a camera at `ip`. */
function patched(swVlan: number | undefined, ip = '10.20.0.10', link: Partial<Link> = {}) {
  const gi = createInterface('Gi0/3', swVlan ? { vlan: swVlan } : {});
  const sw = createDevice('switch', 0, 0, L, { name: 'SW1', interfaces: [gi] });
  const eth = createInterface('eth0');
  const cam = createDevice('camera', 0, 0, L, { name: 'Cam1', role: 'camera', managementIp: ip, interfaces: [eth] });
  const l = createLink(sw.id, cam.id, L, { sourceIfaceId: gi.id, targetIfaceId: eth.id, ...link });
  return { sw, cam, gi, eth, l, ctx: { devices: [sw, cam] as Device[], links: [l], subnets: [cctv] } };
}

describe('portVlans', () => {
  it('reads the far access port, the device’s own port, and a single VLAN on the link', () => {
    const { cam, ctx } = patched(10, '10.20.0.10', { vlan: '30' });
    expect(portVlans(cam.id, ctx.devices, ctx.links).map(describePortVlan)).toEqual([
      'SW1 Gi0/3 is on VLAN 10',
      'its link to SW1 is tagged VLAN 30',
    ]);
  });

  it('skips trunks, untagged ports and multi-VLAN link labels', () => {
    const trunk = patched(10, undefined, { mode: 'trunk' });
    expect(portVlans(trunk.cam.id, ...devLinks(trunk))).toEqual([]);
    const p = patched(undefined, '10.20.0.10', { vlan: '10,20' });
    expect(portVlans(p.cam.id, p.ctx.devices, p.ctx.links)).toEqual([]);
  });
});

function devLinks(p: ReturnType<typeof patched>): [Device[], Link[]] {
  return [p.ctx.devices, p.ctx.links];
}

describe('VLAN rules read the port', () => {
  const rule = createPlacementRule('camera', 'VLAN 20');

  it('right address on the wrong access port breaks the rule, and says where', () => {
    const { cam, ctx } = patched(10);
    const [v] = evaluateCustomRules([rule], ctx);
    expect(v!.objectIds).toEqual([cam.id]);
    expect(explainOffenders(rule.id, [cam.id], ctx, [rule])[0]!.reason).toBe('SW1 Gi0/3 is on VLAN 10');
  });

  it('both wrong: both reasons', () => {
    const { cam, ctx } = patched(10, '10.10.0.5');
    expect(explainOffenders(rule.id, [cam.id], ctx, [rule])[0]!.reason).toBe(
      '10.10.0.5 is in no subnet, not VLAN 20; SW1 Gi0/3 is on VLAN 10',
    );
  });

  it('a matching or untagged port meets the rule; a subnet rule ignores ports', () => {
    expect(evaluateCustomRules([rule], patched(20).ctx)).toEqual([]);
    expect(evaluateCustomRules([rule], patched(undefined).ctx)).toEqual([]);
    expect(evaluateCustomRules([createPlacementRule('camera', 'CCTV')], patched(10).ctx)).toEqual([]);
  });

  it('plans to retag each wrong tag once, never a trunk', () => {
    const { gi, sw, l, ctx } = patched(10, '10.20.0.10', { vlan: '10' });
    const plan = planPortRetag(rule, ctx.devices, ctx.links);
    expect(plan.map((p) => [p.tag.on, p.vlan])).toEqual([
      [{ deviceId: sw.id, ifaceId: gi.id }, 20],
      [{ linkId: l.id }, 20],
    ]);
    expect(planPortRetag(rule, ...devLinks(patched(10, '10.20.0.10', { mode: 'trunk' })))).toEqual([]);
    expect(planPortRetag(createPlacementRule('camera', 'CCTV'), ctx.devices, ctx.links)).toEqual([]);
  });
});

describe('patch cables count as port evidence', () => {
  const rule = createPlacementRule('camera', 'VLAN 20');
  /** SW1 Gi0/3 (VLAN `swVlan`) patched to the camera's eth0 by a rack cable — no logical link. */
  function cabled(swVlan: number) {
    const gi = createInterface('Gi0/3', { vlan: swVlan });
    const sw = createDevice('switch', 0, 0, L, { name: 'SW1', interfaces: [gi] });
    const eth = createInterface('eth0');
    const cam = createDevice('camera', 0, 0, L, { name: 'Cam1', role: 'camera', managementIp: '10.20.0.10', interfaces: [eth] });
    const cable = createRackCable({ deviceId: sw.id, ifaceId: gi.id }, { deviceId: cam.id, ifaceId: eth.id }, '#22d3ee');
    return { sw, cam, gi, eth, cable, ctx: { devices: [sw, cam] as Device[], links: [] as Link[], subnets: [cctv], rackCables: [cable] } };
  }

  it('a camera patched into a VLAN 10 port breaks a VLAN 20 rule, with no link drawn', () => {
    const { cam, ctx } = cabled(10);
    expect(evaluateCustomRules([rule], ctx)[0]!.objectIds).toEqual([cam.id]);
    expect(explainOffenders(rule.id, [cam.id], ctx, [rule])[0]!.reason).toBe('SW1 Gi0/3 is on VLAN 10');
    expect(evaluateCustomRules([rule], cabled(20).ctx)).toEqual([]);
    // Callers that leave cables out see no port evidence (the address is fine).
    expect(evaluateCustomRules([rule], { ...ctx, rackCables: undefined })).toEqual([]);
  });

  it('a port reached by both a link and a cable is one piece of evidence, retagged once', () => {
    const { sw, cam, gi, eth, cable, ctx } = cabled(10);
    const l = createLink(sw.id, cam.id, L, { sourceIfaceId: gi.id, targetIfaceId: eth.id });
    expect(portVlans(cam.id, ctx.devices, [l], [cable])).toHaveLength(1);
    expect(planPortRetag(rule, ctx.devices, [l], [cable]).map((p) => p.tag.on)).toEqual([{ deviceId: sw.id, ifaceId: gi.id }]);
  });
});
