import { describe, it, expect } from 'vitest';
import { blastRadius, networkAnchor, egressNodes } from './blastRadius';
import { createDevice, createLink } from '@/model/schema';
import type { Device, DeviceType } from '@/model/types';

const L = 'layer';
const dev = (type: DeviceType, name: string): Device =>
  createDevice(type, 0, 0, L, { name });
const link = (a: Device, b: Device) => createLink(a.id, b.id, L);

describe('egress / anchor selection', () => {
  it('prefers an egress-role device over a plain hub', () => {
    const isp = dev('isp', 'ISP');
    const sw = dev('switch', 'SW');
    const srv = dev('server', 'SRV');
    const links = [link(isp, sw), link(sw, srv), link(sw, srv)];
    expect(networkAnchor([isp, sw, srv], links)).toBe(isp.id);
  });

  it('falls back to the highest-degree node when there is no egress device', () => {
    const hub = dev('switch', 'HUB');
    const a = dev('end-user', 'A');
    const b = dev('end-user', 'B');
    const c = dev('end-user', 'C');
    const links = [link(hub, a), link(hub, b), link(hub, c)];
    expect(egressNodes([hub, a, b, c], links)).toEqual([hub.id]);
  });
});

describe('blastRadius', () => {
  it('isolates everything downstream of a failed chain link', () => {
    const isp = dev('isp', 'ISP');
    const sw = dev('switch', 'SW');
    const srv = dev('server', 'SRV');
    const devices = [isp, sw, srv];
    const links = [link(isp, sw), link(sw, srv)];
    const r = blastRadius(devices, links, [sw.id]);
    expect([...r.isolated]).toEqual([srv.id]);
    expect(r.survived.has(isp.id)).toBe(true);
    expect(r.survived.has(srv.id)).toBe(false);
  });

  it('a hub is a single point of failure — pulling it isolates every leaf', () => {
    const hub = dev('switch', 'HUB');
    const a = dev('end-user', 'A');
    const b = dev('end-user', 'B');
    const c = dev('end-user', 'C');
    const devices = [hub, a, b, c];
    const links = [link(hub, a), link(hub, b), link(hub, c)];
    const r = blastRadius(devices, links, [hub.id]);
    expect(r.isolated).toEqual(new Set([a.id, b.id, c.id]));
    expect(r.deadLinks.size).toBe(3);
  });

  it('redundant egress survives losing one uplink but not both', () => {
    const isp1 = dev('isp', 'ISP1');
    const isp2 = dev('isp', 'ISP2');
    const core = dev('switch', 'CORE');
    const srv = dev('server', 'SRV');
    const devices = [isp1, isp2, core, srv];
    const links = [link(isp1, core), link(isp2, core), link(core, srv)];
    expect(blastRadius(devices, links, [isp1.id]).isolated.size).toBe(0);
    const both = blastRadius(devices, links, [isp1.id, isp2.id]);
    expect(both.isolated).toEqual(new Set([core.id, srv.id]));
  });

  it('a redundant ring loses nothing when one node drops', () => {
    const r0 = dev('router', 'R');
    const a = dev('switch', 'A');
    const b = dev('switch', 'B');
    const c = dev('switch', 'C');
    const devices = [r0, a, b, c];
    // ring: R-A-B-C-R
    const links = [link(r0, a), link(a, b), link(b, c), link(c, r0)];
    expect(blastRadius(devices, links, [a.id]).isolated.size).toBe(0);
  });

  it('lights up a longer backup path as rerouted when the primary fails', () => {
    const r0 = dev('router', 'R');
    const a = dev('switch', 'A');
    const c = dev('server', 'C');
    const x = dev('switch', 'X');
    const y = dev('switch', 'Y');
    const devices = [r0, a, c, x, y];
    const primary2 = link(a, c);
    const rx = link(r0, x);
    const xy = link(x, y);
    const yc = link(y, c); // Y–C: not on a shortest path until A fails
    const links = [link(r0, a), primary2, rx, xy, yc];
    const res = blastRadius(devices, links, [a.id]);
    expect(res.isolated.size).toBe(0); // C survives via R–X–Y–C
    expect(res.survived.has(c.id)).toBe(true);
    // the WHOLE backup path lights up, so you watch the full detour
    expect(res.rerouted).toEqual(new Set([rx.id, xy.id, yc.id]));
    expect(res.rerouted.has(primary2.id)).toBe(false); // the dead primary is not a reroute
  });

  it('no new backup lights up when redundant paths were already primary (ECMP)', () => {
    const isp1 = dev('isp', 'ISP1');
    const isp2 = dev('isp', 'ISP2');
    const core = dev('switch', 'CORE');
    const srv = dev('server', 'SRV');
    const links = [link(isp1, core), link(isp2, core), link(core, srv)];
    const r = blastRadius([isp1, isp2, core, srv], links, [isp1.id]);
    expect(r.isolated.size).toBe(0);
    expect(r.rerouted.size).toBe(0);
  });

  it('no failure means no casualties', () => {
    const isp = dev('isp', 'ISP');
    const sw = dev('switch', 'SW');
    const r = blastRadius([isp, sw], [link(isp, sw)], []);
    expect(r.isolated.size).toBe(0);
    expect(r.failed.size).toBe(0);
  });

  it('devices already disconnected from egress are not counted as new casualties', () => {
    const isp = dev('isp', 'ISP');
    const sw = dev('switch', 'SW');
    const island = dev('server', 'ISLAND');
    const island2 = dev('end-user', 'ISLAND2');
    const devices = [isp, sw, island, island2];
    // isp-sw is the reachable network; island-island2 is a separate segment with no egress
    const links = [link(isp, sw), link(island, island2)];
    const r = blastRadius(devices, links, [sw.id]);
    expect(r.isolated.size).toBe(0); // island pair was never reachable from egress
  });

  it('is pure — repeated calls give identical results and do not mutate inputs', () => {
    const isp = dev('isp', 'ISP');
    const sw = dev('switch', 'SW');
    const devices = [isp, sw];
    const links = [link(isp, sw)];
    const a = blastRadius(devices, links, [sw.id]);
    const b = blastRadius(devices, links, [sw.id]);
    expect([...a.isolated]).toEqual([...b.isolated]);
    expect(devices).toHaveLength(2);
    expect(links).toHaveLength(1);
  });
});
