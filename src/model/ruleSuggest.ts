/**
 * Rule suggestions — Conductor reads the design and offers to lock in what's
 * already true: "you have two cores, keep it that way", "every camera sits in
 * CCTV", "guest can't reach internal". Declaring one turns today's good state into
 * a guard, so a later edit that quietly breaks it lights up.
 *
 * Every suggestion is met right now (checked with the same evaluators the rules
 * use, so it can't claim otherwise), not already declared, and small: a capped,
 * deterministic list ordered by how much the rule protects (redundancy first).
 * Pure and local — no model, no network.
 */
import { BUILT_IN_INVARIANTS, countedDevices, customRuleLabel, evaluateCustomRules, evaluateInvariants, resolveSubnetRef } from './invariants';
import type { InvariantContext } from './invariants';
import { isAddressable } from '@/sim/autoAddress';
import { ipInCidr, stripPrefix } from '@/lib/ipcidr';
import type { CustomRuleSpec, DeviceType } from './types';

export interface RuleSuggestion {
  /** Stable key (for React lists and ⌘K ids). */
  key: string;
  label: string;
  /** A built-in invariant to declare… */
  builtInId?: string;
  /** …or an authored rule, ready for `addCustomRule(kind, fromRole, target, min)`. */
  rule?: { kind: CustomRuleSpec['kind']; fromRole: string; target: string; min: number };
}

/** Infrastructure types where "at least two" is a real redundancy floor. */
const REDUNDANT_TYPES: readonly DeviceType[] = ['firewall', 'router', 'load-balancer', 'isp'];
/** Network gear: a role made of these is worth a count guard (two cameras isn't redundancy). */
const INFRA_TYPES: ReadonlySet<DeviceType> = new Set([
  ...REDUNDANT_TYPES,
  'switch',
  'wireless-controller',
  'storage',
]);
const MAX = 8;

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();
const same = (a: string | undefined, b: string | undefined) => norm(a) === norm(b);

/** deviceId → link hops to the nearest edge device (firewall, router…); absent if unreachable. */
function hopsFromEdge(
  devices: readonly { id: string; type: DeviceType }[],
  neighbors: ReadonlyMap<string, readonly string[]>,
): Map<string, number> {
  const hops = new Map<string, number>();
  let frontier = devices.filter((d) => REDUNDANT_TYPES.includes(d.type)).map((d) => d.id);
  for (const id of frontier) hops.set(id, 0);
  for (let h = 1; frontier.length > 0; h++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of neighbors.get(id) ?? []) {
        if (hops.has(n)) continue;
        hops.set(n, h);
        next.push(n);
      }
    }
    frontier = next;
  }
  return hops;
}

/** deviceId → size of its connected component (flood fill over `neighbors`). */
function componentSizes(ids: readonly string[], neighbors: ReadonlyMap<string, readonly string[]>): Map<string, number> {
  const size = new Map<string, number>();
  for (const start of ids) {
    if (size.has(start)) continue;
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      for (const n of neighbors.get(stack.pop()!) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    for (const id of seen) size.set(id, seen.size);
  }
  return size;
}

/** Suggest rules the design already satisfies and doesn't declare yet. */
export function suggestRules(
  ctx: InvariantContext,
  declared: { invariants: ReadonlySet<string>; customRules: readonly CustomRuleSpec[] },
): RuleSuggestion[] {
  if (ctx.devices.length < 2) return []; // nothing worth guarding yet

  // Roles in first-seen spelling, keyed case-insensitively.
  const roles = new Map<string, string>();
  for (const d of ctx.devices) {
    const r = d.role?.trim();
    if (r && !roles.has(norm(r))) roles.set(norm(r), r);
  }
  const roleNames = [...roles.values()];

  const candidates: RuleSuggestion['rule'][] = [];
  // 1. Redundancy you already have: an edge type (firewall, router…), then a role of
  //    network gear, with two or more.
  for (const t of REDUNDANT_TYPES) {
    if (roles.has(t)) continue; // the role suggestion below covers this term
    if (countedDevices(t, ctx.devices).length >= 2) candidates.push({ kind: 'count', fromRole: t, target: '', min: 2 });
  }
  for (const r of roleNames) {
    const counted = countedDevices(r, ctx.devices);
    if (counted.length >= 2 && counted.every((d) => INFRA_TYPES.has(d.type))) {
      candidates.push({ kind: 'count', fromRole: r, target: '', min: 2 });
    }
  }
  // 2. Uplinks you already have: every A has ≥k B neighbors (k = the weakest A, max 2).
  const byId = new Map(ctx.devices.map((d) => [d.id, d]));
  const neighbors = new Map<string, string[]>();
  for (const l of ctx.links) {
    if (l.sourceId === l.targetId || !byId.has(l.sourceId) || !byId.has(l.targetId)) continue;
    (neighbors.get(l.sourceId) ?? neighbors.set(l.sourceId, []).get(l.sourceId)!).push(l.targetId);
    (neighbors.get(l.targetId) ?? neighbors.set(l.targetId, []).get(l.targetId)!).push(l.sourceId);
  }
  // Lower tiers first: "every access connects to ≥2 core" is the uplink worth
  // guarding; its mirror is incidental. Uplinks point toward the edge, so a role
  // farther from the firewalls/routers is the lower tier (fewer links breaks ties,
  // and decides on its own when there's no edge device).
  const hops = hopsFromEdge(ctx.devices, neighbors);
  const mean = (r: string, f: (id: string) => number) => {
    const ds = ctx.devices.filter((d) => same(d.role, r));
    return ds.reduce((n, d) => n + f(d.id), 0) / ds.length;
  };
  const tier = (r: string) => mean(r, (id) => hops.get(id) ?? 0);
  const avgDegree = (r: string) => mean(r, (id) => neighbors.get(id)?.length ?? 0);
  for (const a of [...roleNames].sort((x, y) => tier(y) - tier(x) || avgDegree(x) - avgDegree(y))) {
    const as = ctx.devices.filter((d) => same(d.role, a));
    if (as.length < 2) continue; // one device is a fact, not a pattern
    for (const b of roleNames) {
      if (same(a, b)) continue;
      let weakest = Infinity;
      for (const d of as) {
        const n = new Set((neighbors.get(d.id) ?? []).filter((id) => same(byId.get(id)?.role, b))).size;
        weakest = Math.min(weakest, n);
      }
      if (weakest >= 1) candidates.push({ kind: 'connectivity', fromRole: a, target: b, min: Math.min(weakest, 2) });
    }
  }
  // 3. Addressing you already have: every addressed device of a role sits in one subnet.
  for (const r of roleNames) {
    const ds = ctx.devices.filter((d) => same(d.role, r) && isAddressable(d.type));
    if (ds.length < 2) continue;
    const homes = new Set<string>();
    for (const d of ds) {
      const ip = d.managementIp?.trim();
      const home = ip ? ctx.subnets.find((s) => ipInCidr(stripPrefix(ip), s.cidr)) : undefined;
      homes.add(home ? home.id : '');
    }
    if (homes.has('')) continue;
    if (homes.size > 1) {
      // Spread over several subnets that all carry one VLAN: the VLAN is the pattern.
      const vlans = new Set(ctx.subnets.filter((s) => homes.has(s.id)).map((s) => s.vlanId));
      const [vlan] = vlans;
      if (vlans.size === 1 && vlan) candidates.push({ kind: 'placement', fromRole: r, target: `VLAN ${vlan}`, min: 0 });
      continue;
    }
    const subnet = ctx.subnets.find((s) => homes.has(s.id))!;
    const ref = subnet.name?.trim() || subnet.cidr;
    if (resolveSubnetRef(ref, ctx.subnets).length !== 1) continue; // an ambiguous name wouldn't hold
    candidates.push({ kind: 'placement', fromRole: r, target: ref, min: 0 });
  }
  // 5. Naming you already have: every device of a type (network gear) or role is
  //    named to one numbered template — "FW-1", "FW-2" → "FW-#".
  const template = (name: string) => name.trim().replace(/\d+/g, '#');
  const namingTerms = new Map<string, string>();
  for (const d of ctx.devices) if (INFRA_TYPES.has(d.type)) namingTerms.set(d.type, d.type);
  for (const r of roleNames) namingTerms.set(norm(r), r);
  for (const term of namingTerms.values()) {
    const ds = countedDevices(term, ctx.devices);
    // A literal "#" or "*" in a name would read back as a wildcard: no template then.
    if (ds.length < 2 || ds.some((d) => !d.name.trim() || /[#*]/.test(d.name))) continue;
    const shapes = new Set(ds.map((d) => template(d.name)));
    const [shape] = shapes;
    if (shapes.size !== 1 || !shape || !shape.includes('#') || shape === '#') continue;
    candidates.push({ kind: 'naming', fromRole: term, target: shape, min: 0 });
  }
  // 4. Separation you already have — only when the design is wired at all, so two
  //    roles on an empty canvas don't read as a deliberate air gap.
  //    The rule names the walled-off side first ("no guest may reach core"): the role
  //    whose devices sit in the smaller islands.
  if (ctx.links.length > 0) {
    const island = componentSizes(ctx.devices.map((d) => d.id), neighbors);
    const reach = (r: string) => Math.max(...ctx.devices.filter((d) => same(d.role, r)).map((d) => island.get(d.id) ?? 1));
    for (const a of roleNames) {
      for (const b of roleNames) {
        if (same(a, b) || norm(a) > norm(b)) continue;
        const [from, to] = reach(a) <= reach(b) ? [a, b] : [b, a];
        candidates.push({ kind: 'isolation', fromRole: from, target: to, min: 0 });
      }
    }
  }

  const isDeclared = (c: NonNullable<RuleSuggestion['rule']>) =>
    declared.customRules.some(
      (x) =>
        x.kind === c.kind &&
        same(x.fromRole, c.fromRole) &&
        (c.kind === 'placement'
          ? same(x.subnet, c.target)
          : c.kind === 'naming'
            ? (x.pattern ?? '').trim() === c.target
            : same(x.toRole, c.target)),
    );
  // Group by kind, most protective first; built-ins (broad but generic) come last,
  // with "no single point of failure" leading them.
  const groups = new Map<string, RuleSuggestion[]>(
    ['count', 'connectivity', 'placement', 'isolation', 'naming', 'built-in'].map((k) => [k, []]),
  );
  for (const c of candidates) {
    if (!c || isDeclared(c)) continue;
    const spec: CustomRuleSpec = {
      id: 'suggestion',
      kind: c.kind,
      fromRole: c.fromRole,
      toRole: c.kind === 'placement' || c.kind === 'count' || c.kind === 'naming' ? '' : c.target,
      min: c.min,
      ...(c.kind === 'placement' ? { subnet: c.target } : {}),
      ...(c.kind === 'naming' ? { pattern: c.target } : {}),
    };
    if (evaluateCustomRules([spec], ctx).length > 0) continue; // must be true now
    groups.get(c.kind)?.push({ key: `${c.kind}:${norm(c.fromRole)}:${norm(c.target)}`, label: customRuleLabel(spec), rule: c });
  }
  const unmet = new Set(evaluateInvariants(ctx, new Set(BUILT_IN_INVARIANTS.map((i) => i.id))).map((v) => v.id));
  for (const inv of BUILT_IN_INVARIANTS) {
    if (declared.invariants.has(inv.id) || unmet.has(inv.id)) continue;
    if (inv.id === 'every-subnet-has-gateway' && ctx.subnets.length === 0) continue; // vacuous
    groups.get('built-in')!.push({ key: `builtin:${inv.id}`, label: inv.label, builtInId: inv.id });
  }
  // Round-robin across kinds so one busy kind (ten roles → many isolation pairs)
  // can't crowd out the rest. Naming conventions are the lowest stakes, so they only
  // fill whatever room the protective rules leave.
  const out: RuleSuggestion[] = [];
  const naming = groups.get('naming')!;
  groups.delete('naming');
  const lists = [...groups.values()];
  for (let i = 0; out.length < MAX && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && out.length < MAX) out.push(l[i]!);
  }
  for (const n of naming) if (out.length < MAX) out.push(n);
  return out;
}
