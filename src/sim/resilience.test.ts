import { describe, it, expect } from 'vitest';
import { findSpofs, planHardening } from './resilience';
import { createDevice, createLink } from '@/model/schema';
import type { Device, DeviceType } from '@/model/types';

const L = 'layer';
const dev = (type: DeviceType, name: string): Device => createDevice(type, 0, 0, L, { name });
const link = (a: Device, b: Device) => createLink(a.id, b.id, L);

describe('findSpofs', () => {
  it('flags a mid-chain device and the sole egress, ranked worst-first', () => {
    // router(up) -> switch(core) -> server(down). The router is the only egress, so
    // losing it isolates everything (2); losing the switch isolates just the server (1).
    const up = dev('router', 'Up');
    const core = dev('switch', 'Core');
    const down = dev('server', 'Down');
    const spofs = findSpofs([up, core, down], [link(up, core), link(core, down)]);
    expect(spofs.map((s) => s.deviceId)).toEqual([up.id, core.id]);
    expect(spofs.map((s) => s.isolates)).toEqual([2, 1]);
  });

  it('does not flag a device whose neighbors have a parallel path', () => {
    // up -> c1 -> down and up -> c2 -> down: either core can die, down still reaches up.
    const up = dev('router', 'Up');
    const c1 = dev('switch', 'C1');
    const c2 = dev('switch', 'C2');
    const down = dev('server', 'Down');
    const links = [link(up, c1), link(c1, down), link(up, c2), link(c2, down)];
    const spofs = findSpofs([up, c1, c2, down], links);
    // Neither core is a SPOF; only the sole router (its loss isolates all three) is.
    expect(spofs.map((s) => s.deviceId)).toEqual([up.id]);
    expect(spofs[0]!.isolates).toBe(3);
  });

  it('reports no SPOFs for a fully redundant design', () => {
    // Dual routers cross-linked, server dual-homed to both — no single cut vertex.
    const r1 = dev('router', 'R1');
    const r2 = dev('router', 'R2');
    const srv = dev('server', 'Srv');
    const links = [link(r1, r2), link(srv, r1), link(srv, r2)];
    expect(findSpofs([r1, r2, srv], links)).toEqual([]);
  });

  it('ignores unlinked devices and an empty graph', () => {
    expect(findSpofs([dev('server', 'Lonely')], [])).toEqual([]);
    expect(findSpofs([], [])).toEqual([]);
  });

  it('does not flag a leaf, though its upstream is still a SPOF', () => {
    const up = dev('router', 'Up');
    const leaf = dev('end-user', 'PC');
    const spofs = findSpofs([up, leaf], [link(up, leaf)]);
    // Losing the leaf isolates no one else; losing its sole upstream router isolates
    // the leaf. So the router is flagged, the leaf is not.
    expect(spofs.map((s) => s.deviceId)).toEqual([up.id]);
    expect(spofs.some((s) => s.deviceId === leaf.id)).toBe(false);
  });
});

describe('planHardening', () => {
  it('twins every internal SPOF, worst-first, carrying its neighbors', () => {
    const up = dev('router', 'Up');
    const core = dev('switch', 'Core');
    const down = dev('server', 'Down');
    const plan = planHardening([up, core, down], [link(up, core), link(core, down)]);
    expect(plan.steps.map((s) => s.deviceId)).toEqual([up.id, core.id]);
    expect(plan.skippedExternal).toEqual([]);
    // The core's twin must re-connect to both the router and the server.
    const coreStep = plan.steps.find((s) => s.deviceId === core.id)!;
    expect([...coreStep.neighborIds].sort()).toEqual([down.id, up.id].sort());
  });

  it('skips an external ISP (a second provider is a deliberate choice)', () => {
    // isp -> switch -> server. The ISP is the SOLE egress, so its loss isolates both
    // (it's a real SPOF) — but hardening must not silently add a second ISP.
    const isp = dev('isp', 'Internet');
    const sw = dev('switch', 'SW');
    const srv = dev('server', 'Srv');
    const links = [link(isp, sw), link(sw, srv)];
    const plan = planHardening([isp, sw, srv], links);
    expect(plan.skippedExternal).toEqual([isp.id]);
    // The internal switch is twinned; the ISP is reported, not twinned.
    expect(plan.steps.map((s) => s.deviceId)).toEqual([sw.id]);
    expect(plan.steps.some((s) => s.deviceId === isp.id)).toBe(false);
  });

  it('plans nothing for a fully redundant design', () => {
    const r1 = dev('router', 'R1');
    const r2 = dev('router', 'R2');
    const srv = dev('server', 'Srv');
    const plan = planHardening([r1, r2, srv], [link(r1, r2), link(srv, r1), link(srv, r2)]);
    expect(plan.steps).toEqual([]);
    expect(plan.skippedExternal).toEqual([]);
  });
});
