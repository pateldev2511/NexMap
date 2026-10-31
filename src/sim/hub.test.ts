import { describe, it, expect } from 'vitest';
import { pickHub, starEdges, HUB_TYPES } from './hub';
import type { HubNode } from './hub';

const n = (id: string, type: HubNode['type']): HubNode => ({ id, type });

describe('pickHub', () => {
  it('returns the single infrastructure node as the hub', () => {
    const nodes = [n('sw', 'switch'), n('s1', 'server'), n('s2', 'server')];
    expect(pickHub(nodes)).toBe('sw');
  });

  it('treats router / firewall / load-balancer / WLC as hubs too', () => {
    for (const t of ['router', 'firewall', 'load-balancer', 'wireless-controller'] as const) {
      expect(HUB_TYPES.has(t)).toBe(true);
      expect(pickHub([n('h', t), n('e', 'end-user')])).toBe('h');
    }
  });

  it('refuses (null) when no infrastructure node is selected', () => {
    expect(pickHub([n('a', 'server'), n('b', 'end-user')])).toBeNull();
  });

  it('refuses (null) when the selection is ambiguous — two hubs', () => {
    expect(pickHub([n('sw1', 'switch'), n('sw2', 'switch'), n('s', 'server')])).toBeNull();
  });
});

describe('starEdges', () => {
  it('wires every spoke to the hub, normalized a < b', () => {
    expect(starEdges('m', ['a', 'z'])).toEqual([
      ['a', 'm'],
      ['m', 'z'],
    ]);
  });

  it('skips the hub if it appears among the spokes', () => {
    expect(starEdges('hub', ['hub', 'a'])).toEqual([['a', 'hub']]);
  });

  it('collapses duplicate spokes to a single edge', () => {
    expect(starEdges('hub', ['a', 'a', 'a'])).toEqual([['a', 'hub']]);
  });

  it('returns [] when there are no spokes', () => {
    expect(starEdges('hub', [])).toEqual([]);
  });

  it('is a pure function (same input → same output, no mutation)', () => {
    const spokes = ['c', 'b', 'a'];
    const copy = [...spokes];
    const once = starEdges('h', spokes);
    const twice = starEdges('h', spokes);
    expect(once).toEqual(twice);
    expect(spokes).toEqual(copy);
  });
});
