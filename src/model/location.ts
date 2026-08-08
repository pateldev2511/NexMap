/**
 * Location-tree logic (schema v5) — pure, no React, no store.
 *
 * The tree is stored FLAT: `locations[]` plus a `parentId` per node. Nothing here
 * mutates; every function takes the array and returns a fresh answer, so the
 * navigator, the validation pass and the export renderer all read one source of
 * truth.
 *
 * HARD RULE — every walk is cycle-safe AND depth-capped. A `parentId` cycle is a
 * validation ERROR, but a corrupt or hand-edited file must never hang the UI, so
 * traversal degrades to a marked partial answer instead of looping. `truncated`
 * is always surfaced, never swallowed.
 */
import type { Device, Location, LocationKind, Rack } from './types';

/**
 * Deepest chain we will walk. Real estate does not nest 16 deep; anything past
 * this is corruption or a cycle we somehow failed to spot, and either way the
 * honest answer is a capped path rather than an unbounded loop.
 */
export const MAX_LOCATION_DEPTH = 16;

/** Coarse containment order, used ONLY to warn about odd nesting (never to block it). */
const KIND_RANK: Record<LocationKind, number> = {
  site: 0,
  building: 1,
  floor: 2,
  room: 3,
  row: 4,
};

export const LOCATION_KINDS: readonly LocationKind[] = [
  'site',
  'building',
  'floor',
  'room',
  'row',
];

/** Why a walk stopped early. `null` = walked cleanly to a root. */
export type Truncation = 'cycle' | 'depth' | 'orphan' | null;

export interface LocationChain {
  /** Root-first. Empty when the id does not resolve. */
  chain: Location[];
  truncated: Truncation;
}

export function indexLocations(locations: readonly Location[]): Map<string, Location> {
  return new Map(locations.map((l) => [l.id, l]));
}

/**
 * Walk from `id` up to its root, root-first. Cycle-safe and depth-capped.
 *
 * A cycle yields the nodes visited before the repeat, marked `'cycle'` — callers
 * render that as a partial path rather than pretending the tree is sound.
 */
export function locationChain(
  locations: readonly Location[],
  id: string | undefined,
  byId = indexLocations(locations),
): LocationChain {
  if (!id) return { chain: [], truncated: null };
  const chain: Location[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  if (!cur) return { chain: [], truncated: 'orphan' };

  let truncated: Truncation = null;
  while (cur) {
    if (seen.has(cur.id)) {
      truncated = 'cycle';
      break;
    }
    if (chain.length >= MAX_LOCATION_DEPTH) {
      truncated = 'depth';
      break;
    }
    seen.add(cur.id);
    chain.push(cur);
    if (cur.parentId == null) break;
    const parent = byId.get(cur.parentId);
    if (!parent) {
      // E13: dangling parentId — treat this node as a root for display.
      truncated = 'orphan';
      break;
    }
    cur = parent;
  }
  chain.reverse();
  return { chain, truncated };
}

/** The token a node contributes to a qualified path: `code` if set, else `name`. */
export function locationToken(l: Location): string {
  const code = l.code?.trim();
  return code && code.length > 0 ? code : l.name;
}

/**
 * Fully-qualified path for a location, e.g. `HQ/28`. DERIVED on every call —
 * never stored, so a rename can never leave a stale copy behind.
 *
 * A truncated walk is marked with a leading `…/` so a broken tree is visible in
 * the UI instead of silently rendering as a shorter, plausible-looking path.
 */
export function locationPath(
  locations: readonly Location[],
  id: string | undefined,
  byId = indexLocations(locations),
): string {
  const { chain, truncated } = locationChain(locations, id, byId);
  if (chain.length === 0) return '';
  const path = chain.map(locationToken).join('/');
  return truncated ? `…/${path}` : path;
}

/**
 * Qualified path for something that LIVES at a location — a rack, a device, a
 * port. `tail` segments append in order, e.g.
 * `qualifiedPath(locs, rack.locationId, rack.name, iface.name)` → `HQ/28/RK001/Gi0/1`.
 * With no resolvable location the tail still returns on its own, so unplaced gear
 * is addressable rather than blank.
 */
export function qualifiedPath(
  locations: readonly Location[],
  locationId: string | undefined,
  ...tail: (string | undefined)[]
): string {
  const head = locationPath(locations, locationId);
  const parts = [head, ...tail].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return parts.join('/');
}

/** Direct children of `parentId` (pass `undefined` for the roots), in array order. */
export function childrenOf(
  locations: readonly Location[],
  parentId: string | undefined,
): Location[] {
  return locations.filter((l) =>
    parentId == null ? l.parentId == null : l.parentId === parentId,
  );
}

/**
 * Roots for display. Includes true roots (no `parentId`) AND orphans whose parent
 * does not resolve — otherwise a dangling ref would hide a whole subtree from the
 * navigator (E13). Nodes inside a cycle are unreachable from any root by
 * definition, so they are surfaced here too rather than vanishing.
 */
export function displayRoots(
  locations: readonly Location[],
  byId = indexLocations(locations),
): Location[] {
  const reachable = new Set<string>();
  for (const l of locations) {
    if (l.parentId == null || !byId.has(l.parentId)) reachable.add(l.id);
  }
  // Anything not descended from one of those is stranded in a cycle — show it.
  const marked = new Set(reachable);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of locations) {
      if (marked.has(l.id)) continue;
      if (l.parentId != null && marked.has(l.parentId)) {
        marked.add(l.id);
        grew = true;
      }
    }
  }
  const stranded = locations.filter((l) => !marked.has(l.id));
  return [...locations.filter((l) => reachable.has(l.id)), ...stranded];
}

/**
 * All descendants of `id`, excluding `id` itself. Cycle-safe: a node is visited
 * at most once, so a corrupt tree yields a finite set instead of hanging.
 */
export function descendantIds(locations: readonly Location[], id: string): Set<string> {
  const kids = new Map<string, Location[]>();
  for (const l of locations) {
    if (l.parentId == null) continue;
    const list = kids.get(l.parentId);
    if (list) list.push(l);
    else kids.set(l.parentId, [l]);
  }
  const out = new Set<string>();
  const queue = [...(kids.get(id) ?? [])];
  while (queue.length > 0) {
    const next = queue.pop()!;
    if (next.id === id || out.has(next.id)) continue;
    out.add(next.id);
    queue.push(...(kids.get(next.id) ?? []));
  }
  return out;
}

/** Ids that sit on a `parentId` cycle. Empty on a sound tree. */
export function cycleIds(locations: readonly Location[]): Set<string> {
  const byId = indexLocations(locations);
  const onCycle = new Set<string>();
  // 0 = unvisited, 1 = on the current path, 2 = settled.
  const state = new Map<string, 0 | 1 | 2>();

  for (const start of locations) {
    if (state.get(start.id)) continue;
    const path: string[] = [];
    let cur: Location | undefined = start;
    while (cur && !state.get(cur.id)) {
      state.set(cur.id, 1);
      path.push(cur.id);
      cur = cur.parentId == null ? undefined : byId.get(cur.parentId);
    }
    // Landed back on the path we are building → everything from that point loops.
    if (cur && state.get(cur.id) === 1) {
      const from = path.indexOf(cur.id);
      for (const id of path.slice(from)) onCycle.add(id);
    }
    for (const id of path) state.set(id, 2);
  }
  return onCycle;
}

/**
 * Would setting `nodeId.parentId = nextParentId` create a cycle? Used to refuse
 * the reparent BEFORE writing, so the model never holds a cycle we then have to
 * report. Self-parenting counts.
 */
export function wouldCycle(
  locations: readonly Location[],
  nodeId: string,
  nextParentId: string | undefined,
): boolean {
  if (nextParentId == null) return false;
  if (nextParentId === nodeId) return true;
  return descendantIds(locations, nodeId).has(nextParentId);
}

export interface DeleteBlockers {
  childLocations: number;
  racks: number;
  devices: number;
}

/**
 * What still lives at `id`, direct children only. Non-empty → the delete is
 * BLOCKED (SD-13): no cascade, no silent reparent, so a subtree can never be
 * lost to one click.
 */
export function deleteBlockers(
  locations: readonly Location[],
  racks: readonly Rack[],
  devices: readonly Device[],
  id: string,
): DeleteBlockers {
  return {
    childLocations: locations.filter((l) => l.parentId === id).length,
    racks: racks.filter((r) => r.locationId === id).length,
    devices: devices.filter((d) => d.locationId === id).length,
  };
}

export function isBlocked(b: DeleteBlockers): boolean {
  return b.childLocations > 0 || b.racks > 0 || b.devices > 0;
}

/** Human-readable blocker summary, e.g. "3 racks, 2 rooms". Empty when unblocked. */
export function describeBlockers(b: DeleteBlockers): string {
  const parts: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (b.childLocations > 0) parts.push(plural(b.childLocations, 'location', 'locations'));
  if (b.racks > 0) parts.push(plural(b.racks, 'rack', 'racks'));
  if (b.devices > 0) parts.push(plural(b.devices, 'device', 'devices'));
  return parts.join(', ');
}

/**
 * Sibling groups that share a path token (E15). Duplicate tokens make a
 * fully-qualified path ambiguous — two different racks could resolve to the same
 * string — so this warns. Comparison is case-insensitive and trimmed, because
 * "HQ" and "hq " are the same room to a human reader.
 */
export function duplicateSiblingTokens(
  locations: readonly Location[],
): { parentId: string | undefined; token: string; ids: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const l of locations) {
    const key = `${l.parentId ?? ' root'} ${locationToken(l).trim().toLowerCase()}`;
    const list = groups.get(key);
    if (list) list.push(l.id);
    else groups.set(key, [l.id]);
  }
  const byId = indexLocations(locations);
  const out: { parentId: string | undefined; token: string; ids: string[] }[] = [];
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const first = byId.get(ids[0]!)!;
    out.push({ parentId: first.parentId, token: locationToken(first), ids });
  }
  return out;
}

/**
 * Parent/child pairs whose kinds nest oddly, e.g. a `floor` under a `room`
 * (E16). WARN ONLY — never blocked. Real buildings are messy and a hard rule
 * would fight the user instead of helping them. Equal kinds (a room in a room)
 * are allowed silently, since sub-rooms are ordinary.
 */
export function oddNesting(
  locations: readonly Location[],
): { childId: string; parentId: string }[] {
  const byId = indexLocations(locations);
  const out: { childId: string; parentId: string }[] = [];
  for (const l of locations) {
    if (l.parentId == null) continue;
    const parent = byId.get(l.parentId);
    if (!parent) continue;
    if (KIND_RANK[l.kind] < KIND_RANK[parent.kind]) {
      out.push({ childId: l.id, parentId: parent.id });
    }
  }
  return out;
}

/** Locations whose `parentId` does not resolve (E13). */
export function orphanRefs(locations: readonly Location[]): Location[] {
  const byId = indexLocations(locations);
  return locations.filter((l) => l.parentId != null && !byId.has(l.parentId));
}

export interface SiteConversion {
  /** Site nodes to create — caller mints the ids via `createLocation`. */
  names: string[];
  /** rackId → index into `names`. */
  assign: Map<string, number>;
}

/**
 * Plan the legacy `Rack.site` → `Location` conversion (SD-10 / OQ-1). Pure: it
 * decides WHAT to do, the store turns it into one undoable transaction.
 *
 * Rules, all chosen to be non-destructive:
 *  - Racks that already have a `locationId` are LEFT ALONE — never clobbered.
 *  - Blank/whitespace `site` values are ignored.
 *  - Names dedupe case-insensitively, keeping the first spelling seen, so
 *    "HQ" and "hq" collapse to one site rather than two.
 *  - `Rack.site` itself is never cleared; the free text stays as written.
 *  - `Device.location` is deliberately NOT converted: it is prose ("HQ floor 2"),
 *    not a site token, and parsing it would be guesswork.
 */
export function planSiteConversion(racks: readonly Rack[]): SiteConversion {
  const names: string[] = [];
  const indexByKey = new Map<string, number>();
  const assign = new Map<string, number>();

  for (const r of racks) {
    if (r.locationId != null) continue;
    const site = r.site?.trim();
    if (!site) continue;
    const key = site.toLowerCase();
    let idx = indexByKey.get(key);
    if (idx === undefined) {
      idx = names.length;
      names.push(site);
      indexByKey.set(key, idx);
    }
    assign.set(r.id, idx);
  }
  return { names, assign };
}
