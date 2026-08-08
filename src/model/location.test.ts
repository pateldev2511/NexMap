import { describe, expect, it } from 'vitest';
import {
  MAX_LOCATION_DEPTH,
  childrenOf,
  cycleIds,
  deleteBlockers,
  describeBlockers,
  descendantIds,
  displayRoots,
  duplicateSiblingTokens,
  flattenTree,
  isBlocked,
  locationChain,
  locationPath,
  locationToken,
  oddNesting,
  orphanRefs,
  planSiteConversion,
  qualifiedPath,
  wouldCycle,
} from './location';
import type { Device, Location, LocationKind, Rack } from './types';

const loc = (
  id: string,
  kind: LocationKind,
  parentId?: string,
  extra: Partial<Location> = {},
): Location => ({ id, name: id.toUpperCase(), kind, ...(parentId ? { parentId } : {}), ...extra });

const rack = (id: string, partial: Partial<Rack> = {}): Rack => ({
  id,
  name: id.toUpperCase(),
  ruHeight: 42,
  ...partial,
});

const dev = (id: string, partial: Partial<Device> = {}): Device =>
  ({
    id,
    kind: 'device',
    type: 'switch',
    name: id,
    x: 0,
    y: 0,
    width: 56,
    height: 40,
    layerId: 'L',
    ...partial,
  }) as Device;

// HQ ▸ b1 ▸ f2 ▸ r28
const sound = (): Location[] => [
  loc('hq', 'site', undefined, { code: 'HQ' }),
  loc('b1', 'building', 'hq', { code: 'B1' }),
  loc('f2', 'floor', 'b1', { code: '2' }),
  loc('r28', 'room', 'f2', { code: '28' }),
];

describe('locationChain', () => {
  it('walks root-first to the top', () => {
    const { chain, truncated } = locationChain(sound(), 'r28');
    expect(chain.map((l) => l.id)).toEqual(['hq', 'b1', 'f2', 'r28']);
    expect(truncated).toBeNull();
  });

  it('a root resolves to itself', () => {
    expect(locationChain(sound(), 'hq').chain.map((l) => l.id)).toEqual(['hq']);
  });

  it('an unknown id yields an empty orphan chain', () => {
    const r = locationChain(sound(), 'nope');
    expect(r.chain).toEqual([]);
    expect(r.truncated).toBe('orphan');
  });

  it('undefined id is not an error — it is simply unplaced', () => {
    expect(locationChain(sound(), undefined)).toEqual({ chain: [], truncated: null });
  });

  // E13: dangling parentId.
  it('marks a dangling parentId as orphan and stops there', () => {
    const r = locationChain([loc('r28', 'room', 'ghost')], 'r28');
    expect(r.chain.map((l) => l.id)).toEqual(['r28']);
    expect(r.truncated).toBe('orphan');
  });

  // E12: cycles must never hang.
  it('breaks a 2-cycle instead of looping forever', () => {
    const cyc = [loc('a', 'room', 'b'), loc('b', 'room', 'a')];
    const r = locationChain(cyc, 'a');
    expect(r.truncated).toBe('cycle');
    expect(r.chain.length).toBeLessThanOrEqual(2);
  });

  it('breaks a self-parenting node', () => {
    const r = locationChain([loc('a', 'room', 'a')], 'a');
    expect(r.truncated).toBe('cycle');
    expect(r.chain.map((l) => l.id)).toEqual(['a']);
  });

  // E18: depth cap.
  it('caps an absurdly deep chain at MAX_LOCATION_DEPTH', () => {
    const deep: Location[] = [loc('n0', 'site')];
    for (let i = 1; i < MAX_LOCATION_DEPTH + 10; i++) {
      deep.push(loc(`n${i}`, 'room', `n${i - 1}`));
    }
    const r = locationChain(deep, `n${MAX_LOCATION_DEPTH + 9}`);
    expect(r.truncated).toBe('depth');
    expect(r.chain).toHaveLength(MAX_LOCATION_DEPTH);
  });
});

describe('locationToken / locationPath', () => {
  it('prefers code over name', () => {
    expect(locationToken(loc('x', 'site', undefined, { code: 'HQ' }))).toBe('HQ');
  });

  it('falls back to name when code is absent or blank', () => {
    expect(locationToken(loc('x', 'site'))).toBe('X');
    expect(locationToken(loc('x', 'site', undefined, { code: '   ' }))).toBe('X');
  });

  it('builds a slash path root-first', () => {
    expect(locationPath(sound(), 'r28')).toBe('HQ/B1/2/28');
  });

  it('empty for an unplaced id', () => {
    expect(locationPath(sound(), undefined)).toBe('');
  });

  it('marks a truncated walk so a broken tree is VISIBLE, not silently short', () => {
    const cyc = [loc('a', 'room', 'b'), loc('b', 'room', 'a')];
    expect(locationPath(cyc, 'a').startsWith('…/')).toBe(true);
  });
});

describe('qualifiedPath', () => {
  it('appends tail segments after the location path', () => {
    expect(qualifiedPath(sound(), 'r28', 'RK001', 'Gi0/1')).toBe('HQ/B1/2/28/RK001/Gi0/1');
  });

  it('returns just the tail when there is no location — unplaced gear stays addressable', () => {
    expect(qualifiedPath(sound(), undefined, 'RK001')).toBe('RK001');
  });

  it('skips blank and undefined tail segments', () => {
    expect(qualifiedPath(sound(), 'hq', undefined, '', 'A')).toBe('HQ/A');
  });
});

describe('childrenOf / displayRoots', () => {
  it('lists direct children only', () => {
    expect(childrenOf(sound(), 'hq').map((l) => l.id)).toEqual(['b1']);
    expect(childrenOf(sound(), 'r28')).toEqual([]);
  });

  it('undefined parent lists the roots', () => {
    expect(childrenOf(sound(), undefined).map((l) => l.id)).toEqual(['hq']);
  });

  // E13: an orphan must not hide its subtree from the navigator.
  it('treats an orphan as a display root', () => {
    const locs = [loc('a', 'room', 'ghost'), loc('b', 'row', 'a')];
    expect(displayRoots(locs).map((l) => l.id)).toEqual(['a']);
  });

  // E12: cycle nodes are unreachable from any root — they must still be visible.
  it('surfaces nodes stranded in a cycle rather than dropping them', () => {
    const locs = [loc('hq', 'site'), loc('a', 'room', 'b'), loc('b', 'room', 'a')];
    const roots = displayRoots(locs).map((l) => l.id);
    expect(roots).toContain('hq');
    expect(roots).toContain('a');
    expect(roots).toContain('b');
  });
});

describe('descendantIds', () => {
  it('collects the whole subtree, excluding the node itself', () => {
    expect([...descendantIds(sound(), 'hq')].sort()).toEqual(['b1', 'f2', 'r28']);
  });

  it('is empty for a leaf', () => {
    expect(descendantIds(sound(), 'r28').size).toBe(0);
  });

  it('terminates on a cycle', () => {
    const cyc = [loc('a', 'room', 'b'), loc('b', 'room', 'a')];
    expect(descendantIds(cyc, 'a').size).toBeLessThanOrEqual(2);
  });
});

describe('cycleIds', () => {
  it('finds nothing on a sound tree', () => {
    expect(cycleIds(sound()).size).toBe(0);
  });

  it('finds a self-loop', () => {
    expect([...cycleIds([loc('a', 'room', 'a')])]).toEqual(['a']);
  });

  it('finds a 2-cycle', () => {
    const ids = cycleIds([loc('a', 'room', 'b'), loc('b', 'room', 'a')]);
    expect([...ids].sort()).toEqual(['a', 'b']);
  });

  it('finds a 3-cycle and excludes an innocent tail hanging off it', () => {
    const locs = [
      loc('a', 'room', 'b'),
      loc('b', 'room', 'c'),
      loc('c', 'room', 'a'),
      loc('leaf', 'row', 'a'),
    ];
    const ids = cycleIds(locs);
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
    expect(ids.has('leaf')).toBe(false);
  });

  it('ignores a dangling parent (orphan, not a cycle)', () => {
    expect(cycleIds([loc('a', 'room', 'ghost')]).size).toBe(0);
  });
});

describe('wouldCycle', () => {
  it('refuses self-parenting', () => {
    expect(wouldCycle(sound(), 'b1', 'b1')).toBe(true);
  });

  it('refuses reparenting under own descendant', () => {
    expect(wouldCycle(sound(), 'b1', 'r28')).toBe(true);
  });

  it('allows moving to an unrelated node', () => {
    const locs = [...sound(), loc('hq2', 'site')];
    expect(wouldCycle(locs, 'b1', 'hq2')).toBe(false);
  });

  it('allows promoting to a root', () => {
    expect(wouldCycle(sound(), 'b1', undefined)).toBe(false);
  });
});

describe('deleteBlockers (E14 — block, never cascade)', () => {
  it('counts child locations, racks and devices', () => {
    const b = deleteBlockers(
      sound(),
      [rack('r1', { locationId: 'f2' }), rack('r2', { locationId: 'f2' })],
      [dev('d1', { locationId: 'f2' })],
      'f2',
    );
    expect(b).toEqual({ childLocations: 1, racks: 2, devices: 1 });
    expect(isBlocked(b)).toBe(true);
  });

  it('an empty leaf is deletable', () => {
    const b = deleteBlockers(sound(), [], [], 'r28');
    expect(b).toEqual({ childLocations: 0, racks: 0, devices: 0 });
    expect(isBlocked(b)).toBe(false);
    expect(describeBlockers(b)).toBe('');
  });

  it('counts only DIRECT children, not the whole subtree', () => {
    // hq's subtree is 3 deep, but only b1 is a direct child.
    expect(deleteBlockers(sound(), [], [], 'hq').childLocations).toBe(1);
  });

  it('describes blockers with correct pluralisation', () => {
    expect(describeBlockers({ childLocations: 1, racks: 3, devices: 0 })).toBe(
      '1 location, 3 racks',
    );
    expect(describeBlockers({ childLocations: 0, racks: 1, devices: 2 })).toBe(
      '1 rack, 2 devices',
    );
  });
});

describe('duplicateSiblingTokens (E15)', () => {
  it('flags two siblings sharing a token', () => {
    const locs = [
      loc('hq', 'site'),
      loc('a', 'room', 'hq', { code: '28' }),
      loc('b', 'room', 'hq', { code: '28' }),
    ];
    const dupes = duplicateSiblingTokens(locs);
    expect(dupes).toHaveLength(1);
    expect(dupes[0]!.ids.sort()).toEqual(['a', 'b']);
  });

  it('is case-insensitive and trims', () => {
    const locs = [
      loc('a', 'site', undefined, { code: 'HQ' }),
      loc('b', 'site', undefined, { code: ' hq ' }),
    ];
    expect(duplicateSiblingTokens(locs)).toHaveLength(1);
  });

  it('does NOT flag the same token under different parents', () => {
    const locs = [
      loc('s1', 'site'),
      loc('s2', 'site'),
      loc('a', 'room', 's1', { code: '28' }),
      loc('b', 'room', 's2', { code: '28' }),
    ];
    expect(duplicateSiblingTokens(locs)).toEqual([]);
  });

  it('flags duplicate roots', () => {
    const locs = [
      loc('a', 'site', undefined, { code: 'HQ' }),
      loc('b', 'site', undefined, { code: 'HQ' }),
    ];
    expect(duplicateSiblingTokens(locs)).toHaveLength(1);
  });

  it('leaves a sound tree alone', () => {
    expect(duplicateSiblingTokens(sound())).toEqual([]);
  });
});

describe('oddNesting (E16 — warn, never block)', () => {
  it('flags a floor under a room', () => {
    const locs = [loc('rm', 'room'), loc('fl', 'floor', 'rm')];
    expect(oddNesting(locs)).toEqual([{ childId: 'fl', parentId: 'rm' }]);
  });

  it('allows equal kinds — a sub-room is ordinary', () => {
    const locs = [loc('rm', 'room'), loc('rm2', 'room', 'rm')];
    expect(oddNesting(locs)).toEqual([]);
  });

  it('allows skipping a rung — a room directly under a site is fine', () => {
    const locs = [loc('hq', 'site'), loc('rm', 'room', 'hq')];
    expect(oddNesting(locs)).toEqual([]);
  });

  it('leaves a sound tree alone', () => {
    expect(oddNesting(sound())).toEqual([]);
  });
});

describe('orphanRefs (E13)', () => {
  it('finds a dangling parentId', () => {
    expect(orphanRefs([loc('a', 'room', 'ghost')]).map((l) => l.id)).toEqual(['a']);
  });

  it('a true root is not an orphan', () => {
    expect(orphanRefs(sound())).toEqual([]);
  });
});

describe('planSiteConversion (SD-10 / OQ-1)', () => {
  it('creates one site per distinct name and assigns racks', () => {
    const racks = [
      rack('r1', { site: 'HQ' }),
      rack('r2', { site: 'HQ' }),
      rack('r3', { site: 'DR' }),
    ];
    const plan = planSiteConversion(racks);
    expect(plan.names).toEqual(['HQ', 'DR']);
    expect(plan.assign.get('r1')).toBe(0);
    expect(plan.assign.get('r2')).toBe(0);
    expect(plan.assign.get('r3')).toBe(1);
  });

  it('dedupes case-insensitively, keeping the first spelling seen', () => {
    const plan = planSiteConversion([rack('r1', { site: 'HQ' }), rack('r2', { site: 'hq' })]);
    expect(plan.names).toEqual(['HQ']);
    expect(plan.assign.get('r2')).toBe(0);
  });

  it('NEVER clobbers a rack that already has a locationId', () => {
    const plan = planSiteConversion([rack('r1', { site: 'HQ', locationId: 'existing' })]);
    expect(plan.names).toEqual([]);
    expect(plan.assign.size).toBe(0);
  });

  it('ignores blank and whitespace-only sites', () => {
    const plan = planSiteConversion([
      rack('r1', { site: '' }),
      rack('r2', { site: '   ' }),
      rack('r3', {}),
    ]);
    expect(plan.names).toEqual([]);
    expect(plan.assign.size).toBe(0);
  });

  it('trims the created name', () => {
    expect(planSiteConversion([rack('r1', { site: '  HQ  ' })]).names).toEqual(['HQ']);
  });

  it('is a no-op on an empty rack list', () => {
    expect(planSiteConversion([])).toEqual({ names: [], assign: new Map() });
  });
});

describe('flattenTree', () => {
  it('emits depth-first rows with correct depths', () => {
    const rows = flattenTree(sound());
    expect(rows.map((r) => [r.location.id, r.depth])).toEqual([
      ['hq', 0],
      ['b1', 1],
      ['f2', 2],
      ['r28', 3],
    ]);
  });

  it('marks which rows have children', () => {
    const rows = flattenTree(sound());
    expect(rows.map((r) => r.hasChildren)).toEqual([true, true, true, false]);
  });

  it('collapsing hides descendants but keeps the node', () => {
    const rows = flattenTree(sound(), (id) => id === 'b1');
    expect(rows.map((r) => r.location.id)).toEqual(['hq', 'b1']);
  });

  it('lists two sibling roots', () => {
    const rows = flattenTree([loc('a', 'site'), loc('b', 'site')]);
    expect(rows.map((r) => r.location.id)).toEqual(['a', 'b']);
  });

  // E12: the render path must be total — a cycle cannot recurse forever.
  it('terminates on a cycle and still emits every node exactly once', () => {
    const locs = [loc('a', 'room', 'b'), loc('b', 'room', 'a'), loc('hq', 'site')];
    const rows = flattenTree(locs);
    const ids = rows.map((r) => r.location.id).sort();
    expect(ids).toEqual(['a', 'b', 'hq']);
    expect(rows).toHaveLength(3);
  });

  it('emits a self-parenting node exactly once', () => {
    const rows = flattenTree([loc('a', 'room', 'a')]);
    expect(rows).toHaveLength(1);
  });

  it('shows an orphan at depth 0 with its subtree', () => {
    const locs = [loc('a', 'room', 'ghost'), loc('b', 'row', 'a')];
    expect(flattenTree(locs).map((r) => [r.location.id, r.depth])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });

  it('caps runaway depth instead of emitting forever', () => {
    const deep: Location[] = [loc('n0', 'site')];
    for (let i = 1; i < MAX_LOCATION_DEPTH + 5; i++) {
      deep.push(loc(`n${i}`, 'room', `n${i - 1}`));
    }
    const rows = flattenTree(deep);
    // Every node still gets a row (the tail is appended flat), and none exceed the cap.
    expect(rows).toHaveLength(deep.length);
    expect(Math.max(...rows.map((r) => r.depth))).toBeLessThan(MAX_LOCATION_DEPTH);
  });

  it('is empty for no locations (E17)', () => {
    expect(flattenTree([])).toEqual([]);
  });
});

// Deterministic PRNG — a seeded LCG, so a failure is always reproducible.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('property: traversal is total on ARBITRARY (possibly corrupt) trees', () => {
  it('never hangs, never exceeds the depth cap, and always agrees with cycleIds', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = lcg(seed);
      const n = 1 + Math.floor(rnd() * 12);
      const kinds: LocationKind[] = ['site', 'building', 'floor', 'room', 'row'];
      const locs: Location[] = [];
      for (let i = 0; i < n; i++) {
        // Parent may be ANY node (including itself or a later one) or a ghost id —
        // this deliberately generates cycles and orphans.
        const roll = rnd();
        let parentId: string | undefined;
        if (roll < 0.2) parentId = undefined;
        else if (roll < 0.3) parentId = 'ghost';
        else parentId = `n${Math.floor(rnd() * n)}`;
        locs.push(loc(`n${i}`, kinds[Math.floor(rnd() * kinds.length)]!, parentId));
      }

      const onCycle = cycleIds(locs);
      for (const l of locs) {
        const { chain, truncated } = locationChain(locs, l.id);
        // Totality: bounded, and the node itself is always the last hop.
        expect(chain.length).toBeGreaterThan(0);
        expect(chain.length).toBeLessThanOrEqual(MAX_LOCATION_DEPTH);
        expect(chain[chain.length - 1]!.id).toBe(l.id);
        // A node on a cycle can never walk cleanly to a root.
        if (onCycle.has(l.id)) expect(truncated).not.toBeNull();
        // Path derivation is total too.
        expect(typeof locationPath(locs, l.id)).toBe('string');
        // Descendant collection terminates and never contains the node itself.
        expect(descendantIds(locs, l.id).has(l.id)).toBe(false);
      }

      // Every node is reachable from displayRoots' set (nothing silently vanishes).
      expect(displayRoots(locs).length).toBeGreaterThan(0);
      // A reparent that wouldCycle() rejects must genuinely be unsafe.
      for (const l of locs) {
        for (const t of locs) {
          if (!wouldCycle(locs, l.id, t.id)) continue;
          expect(t.id === l.id || descendantIds(locs, l.id).has(t.id)).toBe(true);
        }
      }
    }
  });
});
