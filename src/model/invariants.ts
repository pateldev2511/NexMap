/**
 * Declarative invariants — the rules a design asserts about itself. Where
 * validation flags what is *wrong* (a malformed IP, a duplicate), an invariant
 * is a goal the user *declares* ("this network has no single point of failure")
 * and Conductor holds the design to it: as you edit, a declared-but-violated
 * rule lights up, and (slice 2) Conductor offers to restore it.
 *
 * Every invariant is a pure predicate over the model, composed from primitives
 * that already exist (SPOF scan, addressing, gateway, naming) — no new graph
 * analysis here, just a declarative framing over proven checks.
 */
import { nanoid } from 'nanoid';
import type { Device, Link, RackCable, Subnet, CustomRuleSpec } from './types';
import { isAddressable, usedAddresses, type AddressAssignment } from '@/sim/autoAddress';
import { findSpofs } from '@/sim/resilience';
import { nextFreeHost } from '@/lib/ipam';
import { ipInCidr, stripPrefix } from '@/lib/ipcidr';
import { describePortVlan, wrongPortVlans, type PortVlan } from './portVlan';

export type { CustomRuleSpec };

/** The slice of the model an invariant reads. Plain arrays, like the planners. */
export interface InvariantContext {
  devices: Device[];
  links: Link[];
  subnets: Subnet[];
  /**
   * Physical patch cables (rack view). Only VLAN rules read them — as port
   * evidence, like links. Optional so pure callers can leave them out.
   */
  rackCables?: RackCable[];
}

export interface Invariant {
  id: string;
  /** Short imperative name shown as the rule ("No single point of failure"). */
  label: string;
  /** One line: what the rule asserts, and what breaks it. */
  description: string;
  /**
   * Whether Conductor has a safe, automatic remedy for this rule — the store
   * owns *how* (it wires the id to an existing fixer); this just declares that a
   * one-click Restore exists. A restore may only partially close the gap (it does
   * what it can safely do); the rule re-evaluates and shows whatever remains.
   */
  restorable: boolean;
  /** Object ids that currently violate the rule; empty means satisfied. */
  check(ctx: InvariantContext): string[];
}

/** A declared invariant that is currently not met. */
export interface InvariantViolation {
  /** The invariant's id. */
  id: string;
  label: string;
  /** The offending objects (devices/subnets) — for selection and highlight. */
  objectIds: string[];
  /**
   * How many are missing, for a rule broken by absence (a count rule) — there's no
   * device at fault, so `objectIds` is empty and this is the gap instead.
   */
  shortfall?: number;
}

/** What a violation asks of you: "2 to fix", or "1 short" for a count rule. */
export function violationTodo(v: InvariantViolation): string {
  return v.shortfall !== undefined ? `${v.shortfall} short` : `${v.objectIds.length} to fix`;
}

/**
 * The built-in rules a design can declare. Deliberately a small, honest set: each
 * reuses a primitive NexMap already trusts, so a rule can never claim more than
 * the underlying check knows.
 */
export const BUILT_IN_INVARIANTS: readonly Invariant[] = [
  {
    id: 'no-single-point-of-failure',
    label: 'No single point of failure',
    description: 'No single device, if it fails, isolates any other device.',
    restorable: true, // store → hardenDesign (twins every internal SPOF)
    check: ({ devices, links }) => findSpofs(devices, links).map((s) => s.deviceId),
  },
  {
    id: 'every-device-addressed',
    label: 'Every device is addressed',
    description: 'Every addressable device has a management IP.',
    restorable: true, // store → autoAddressDevices
    check: ({ devices }) =>
      devices.filter((d) => isAddressable(d.type) && !d.managementIp?.trim()).map((d) => d.id),
  },
  {
    id: 'every-device-named',
    label: 'Every device is named',
    description: 'No device is left with a blank name.',
    restorable: true, // store → nameUnnamedDevices
    check: ({ devices }) => devices.filter((d) => !d.name.trim()).map((d) => d.id),
  },
  {
    id: 'every-subnet-has-gateway',
    label: 'Every subnet has a gateway',
    description: 'Every subnet names a gateway address.',
    restorable: true, // store → assignGateways
    check: ({ subnets }) => subnets.filter((s) => !s.gateway?.trim()).map((s) => s.id),
  },
];

const BY_ID = new Map(BUILT_IN_INVARIANTS.map((inv) => [inv.id, inv]));

/** Every object that breaks at least one declared rule (for canvas badges). */
export function ruleOffenderIds(violations: readonly InvariantViolation[]): Set<string> {
  const ids = new Set<string>();
  for (const v of violations) for (const id of v.objectIds) ids.add(id);
  return ids;
}

/** Look up a built-in invariant by id. */
export function getInvariant(id: string): Invariant | undefined {
  return BY_ID.get(id);
}

/**
 * Evaluate every *enabled* invariant against the model and return those that are
 * violated (in registry order, so the surface is stable). Disabled rules are
 * skipped entirely — an invariant only matters once the design opts into it.
 */
export function evaluateInvariants(
  ctx: InvariantContext,
  enabled: ReadonlySet<string>,
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const inv of BUILT_IN_INVARIANTS) {
    if (!enabled.has(inv.id)) continue;
    const objectIds = inv.check(ctx);
    if (objectIds.length > 0) out.push({ id: inv.id, label: inv.label, objectIds });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Custom rules — parameterized invariants the user authors against device roles.
 * Four kinds, all over the free-text `Device.role` (matched case-insensitively):
 *  - CONNECTIVITY: "every A connects to ≥N B" (direct neighbors) — e.g. access → ≥2 core.
 *  - ISOLATION:    "no A may reach any B" (any path through links) — e.g. guest ✗ internal.
 *  - PLACEMENT:    "every A lives in subnet S" (management IP in range) — e.g. camera → CCTV.
 *    Restorable: re-addressing into a named range is deterministic.
 *  - COUNT:        "at least N A" — e.g. ≥2 firewall. Matches role OR device type, since
 *    "two firewalls" is usually about the kind of box. Restorable: twin an existing one.
 * Isolation is link-level: it asserts no topological path, which is exactly the
 * air-gap / separate-fabric check. It does NOT model firewall or VLAN policy, so
 * two roles meeting at a firewall read as "can reach" — segmentation by policy is
 * a different thing than segmentation by wiring.
 * ------------------------------------------------------------------------- */

/** A fresh connectivity rule with a generated id. */
export function createConnectivityRule(fromRole: string, toRole: string, min: number): CustomRuleSpec {
  return { id: nanoid(), kind: 'connectivity', fromRole, toRole, min };
}

/** A fresh isolation rule with a generated id (`min` is unused, kept at 0). */
export function createIsolationRule(fromRole: string, toRole: string): CustomRuleSpec {
  return { id: nanoid(), kind: 'isolation', fromRole, toRole, min: 0 };
}

/**
 * A fresh placement rule: "every <role> lives in <subnet>", where `subnet` is a
 * subnet's name or its exact CIDR, or a VLAN ("VLAN 20": any subnet on it). Checks
 * the management IP — the address a device is reached on — so it's the
 * addressing-side half of segmentation (isolation is the wiring-side half).
 * A VLAN ref is stored in one spelling, so "vlan20" and "VLAN 20" are the same rule.
 */
export function createPlacementRule(fromRole: string, subnet: string): CustomRuleSpec {
  return { id: nanoid(), kind: 'placement', fromRole, toRole: '', min: 0, subnet: placementRef(subnet) };
}

/** A placement target in its one stored spelling: VLAN refs become "VLAN n". */
export function placementRef(ref: string): string {
  const vlan = vlanRefId(ref);
  return vlan !== null ? `VLAN ${vlan}` : ref;
}

/**
 * The most a count or connectivity rule may ask for. Restore makes that many copies
 * in one step, so a typo or a hostile file ("at least 20000 firewalls") must not be
 * able to freeze the tab.
 */
export const MAX_RULE_MIN = 500;

/** A rule's minimum as stored: a whole number 1–MAX_RULE_MIN where the kind has one, else 0. */
export function clampRuleMin(kind: CustomRuleSpec['kind'], min: number): number {
  if (kind !== 'count' && kind !== 'connectivity') return 0;
  const n = Number.isFinite(min) ? Math.round(min) : 1;
  return Math.min(MAX_RULE_MIN, Math.max(1, n));
}

const normRole = (s: string | undefined): string => (s ?? '').trim().toLowerCase();

/** A fresh count rule: "at least `min` `role`" (a role or a device type). */
export function createCountRule(role: string, min: number): CustomRuleSpec {
  return { id: nanoid(), kind: 'count', fromRole: role, toRole: '', min };
}

/** Human-readable name for a custom rule. */
export function customRuleLabel(r: CustomRuleSpec): string {
  const a = r.fromRole.trim();
  const b = r.toRole.trim();
  if (r.kind === 'placement') {
    const vlan = vlanRefId(r.subnet);
    return vlan !== null ? `Every “${a}” is on VLAN ${vlan}` : `Every “${a}” lives in “${(r.subnet ?? '').trim()}”`;
  }
  if (r.kind === 'count') return `At least ${r.min} “${a}”`;
  if (r.kind === 'naming') return `Every “${a}” is named “${(r.pattern ?? '').trim()}”`;
  return r.kind === 'isolation'
    ? `No “${a}” may reach “${b}”`
    : `Every “${a}” connects to ≥${r.min} “${b}”`;
}

const sameText = (a: string | undefined, b: string | undefined) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/**
 * The declared rule that `spec` restates: same kind, same roles, same subnet/VLAN —
 * at most a different minimum. "At least 3 firewalls" restates "At least 2
 * firewall"; saying it again changes that rule rather than stacking a second one.
 */
export function findRestated(
  rules: readonly CustomRuleSpec[],
  spec: Pick<CustomRuleSpec, 'kind' | 'fromRole' | 'toRole' | 'subnet' | 'pattern'>,
): CustomRuleSpec | undefined {
  return rules.find(
    (r) =>
      r.kind === spec.kind &&
      sameText(r.fromRole, spec.fromRole) &&
      sameText(r.toRole, spec.toRole) &&
      sameText(r.subnet, spec.subnet) &&
      // A naming template is case-sensitive: "FW-#" and "fw-#" are different standards.
      (r.pattern ?? '').trim() === (spec.pattern ?? '').trim(),
  );
}

/** Whether a rule kind has a minimum you can raise or lower (count, connectivity). */
export function hasMinimum(kind: CustomRuleSpec['kind']): boolean {
  return kind === 'count' || kind === 'connectivity';
}

/** Whether Conductor can restore a custom rule: placement re-addresses, count twins. */
export function isCustomRuleRestorable(r: CustomRuleSpec): boolean {
  return r.kind === 'placement' || r.kind === 'count' || (r.kind === 'naming' && namingCanGenerate(r.pattern));
}

/* ---------------------------------------------------------------------------
 * Naming rules — "every firewall is named FW-#". A template, not a regex: `#` is
 * a number, `*` is anything, everything else is literal (case-sensitive: a naming
 * standard is exact). Devices are picked by role OR type, like count rules.
 * ------------------------------------------------------------------------- */

/** A fresh naming rule: every `term` (role or type) has a name matching `pattern`. */
export function createNamingRule(term: string, pattern: string): CustomRuleSpec {
  return { id: nanoid(), kind: 'naming', fromRole: term, toRole: '', min: 0, pattern: pattern.trim() };
}

/**
 * The template as a name test, or null when it's blank. Deliberately NOT a regex:
 * a template like "*****X" compiled to `.+.+.+…X` backtracks catastrophically on a
 * name that doesn't fit, and templates arrive from files. This walks template ×
 * name once (O(m·n)) whatever the template: `#` takes one or more digits, `*` one
 * or more of anything, every other character itself.
 */
export function namingMatcher(pattern: string | undefined): ((name: string) => boolean) | null {
  const t = [...(pattern ?? '').trim()];
  if (t.length === 0) return null;
  return (raw) => {
    const s = [...raw.trim()];
    const n = s.length;
    // fits[j]: does the template from token i on fit the name from char j on?
    let fits: boolean[] = Array(n + 1).fill(false);
    fits[n] = true; // past the last token, only the empty rest fits
    for (let i = t.length - 1; i >= 0; i--) {
      const tok = t[i]!;
      const cur: boolean[] = Array(n + 1).fill(false);
      for (let j = n - 1; j >= 0; j--) {
        const ch = s[j]!;
        if (tok === '#' || tok === '*') {
          // Take this char, then either keep going with the same wildcard or move on.
          cur[j] = (tok === '*' || (ch >= '0' && ch <= '9')) && (cur[j + 1]! || fits[j + 1]!);
        } else {
          cur[j] = tok === ch && fits[j + 1]!;
        }
      }
      fits = cur;
    }
    return fits[0]!;
  };
}

/** Whether Conductor can make names for it: exactly one `#` and no `*` ("FW-#"). */
export function namingCanGenerate(pattern: string | undefined): boolean {
  const p = (pattern ?? '').trim();
  return p.split('#').length === 2 && !p.includes('*');
}



/**
 * The name a NEW device should get under the declared naming rules: the first
 * fillable rule ("FW-#") that covers its role or type, with the lowest number not in
 * `taken`. Null when no such rule covers it (then the usual default applies). So a
 * declared standard shapes new work, not just old.
 */
export function nextStandardName(
  rules: readonly CustomRuleSpec[],
  device: { type: string; role?: string },
  taken: Iterable<string>,
): string | null {
  const rule = rules.find(
    (r) =>
      r.kind === 'naming' &&
      namingCanGenerate(r.pattern) &&
      !!normRole(r.fromRole) &&
      (normRole(r.fromRole) === normRole(device.role) || normRole(r.fromRole) === device.type),
  );
  if (!rule) return null;
  const [pre, post] = rule.pattern!.trim().split('#') as [string, string];
  const used = new Set([...taken].map((n) => n.trim()));
  let n = 1;
  while (used.has(`${pre}${n}${post}`)) n++;
  return `${pre}${n}${post}`;
}

export interface NamingPlan {
  /** Device → its new name. */
  renames: { deviceId: string; name: string }[];
}

/**
 * Plan to restore a naming rule: give each offender the template with the lowest
 * number no device already uses ("FW-3" when FW-1 and FW-2 exist), in reading order
 * (top to bottom, then left to right) so the numbers run the way the diagram reads.
 * Empty when the template can't make names (no `#`, several, or a `*`).
 */
export function planNaming(rule: CustomRuleSpec, devices: readonly Device[]): NamingPlan {
  const fits = namingMatcher(rule.pattern);
  if (rule.kind !== 'naming' || !fits || !namingCanGenerate(rule.pattern)) return { renames: [] };
  const [pre, post] = rule.pattern!.trim().split('#') as [string, string];
  const taken = new Set(devices.map((d) => d.name.trim()));
  const offenders = countedDevices(rule.fromRole, devices)
    .filter((d) => !fits(d.name))
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
  const renames: NamingPlan['renames'] = [];
  let n = 1;
  for (const d of offenders) {
    while (taken.has(`${pre}${n}${post}`)) n++;
    const name = `${pre}${n}${post}`;
    taken.add(name);
    renames.push({ deviceId: d.id, name });
  }
  return { renames };
}

/** Devices a count rule counts: role or type equals the term (case-insensitive). */
export function countedDevices<D extends Pick<Device, 'role' | 'type'>>(term: string, devices: readonly D[]): D[] {
  const t = normRole(term);
  return t ? devices.filter((d) => normRole(d.role) === t || d.type === t) : [];
}

export interface CountPlan {
  /** The device to copy (most-connected counted device), or null when there's none. */
  sourceId: string | null;
  /** How many copies close the gap (0 when the rule is met). */
  copies: number;
  /** Neighbors each copy wires to, so a copy is a real backup, not an island. */
  neighborIds: string[];
}

/**
 * Plan to restore a count rule: copy the best-connected device it counts until there
 * are enough, each wired to that device's neighbors (the same twin the SPOF fix
 * makes). Refuses when nothing is counted yet: with no example, which type, and
 * wired where, would be a guess.
 */
export function planCount(
  rule: CustomRuleSpec,
  devices: readonly Device[],
  links: readonly Link[],
): CountPlan {
  const counted = rule.kind === 'count' ? countedDevices(rule.fromRole, devices) : [];
  const copies = rule.kind === 'count' ? Math.max(0, rule.min - counted.length) : 0;
  if (copies === 0 || counted.length === 0) return { sourceId: null, copies, neighborIds: [] };
  const neighbors = buildAdjacency({ devices: [...devices], links: [...links], subnets: [] });
  const degree = (d: Device) => neighbors.get(d.id)?.size ?? 0;
  const source = [...counted].sort((a, b) => degree(b) - degree(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]!;
  return { sourceId: source.id, copies, neighborIds: [...(neighbors.get(source.id) ?? [])].sort() };
}

/**
 * The VLAN id a placement ref names ("VLAN 20", "vlan20", "vlan-20"), or null when
 * the ref names a subnet instead. Only valid 802.1Q ids (1–4094) count.
 */
export function vlanRefId(ref: string | undefined): number | null {
  const m = (ref ?? '').trim().match(/^vlan\s*-?\s*(\d{1,4})$/i);
  const id = m ? Number(m[1]) : NaN;
  return id >= 1 && id <= 4094 ? id : null;
}

/**
 * Subnets a placement ref names: matched by name (case-insensitive) or exact CIDR,
 * or — for a VLAN ref — every subnet on that VLAN. Several can match (two subnets
 * sharing a name, a VLAN spanning two subnets): the rule then accepts any of them.
 */
export function resolveSubnetRef(ref: string | undefined, subnets: readonly Subnet[]): Subnet[] {
  const r = (ref ?? '').trim().toLowerCase();
  if (!r) return [];
  const vlan = vlanRefId(r);
  return subnets.filter(
    (s) =>
      s.cidr.trim().toLowerCase() === r ||
      (s.name ?? '').trim().toLowerCase() === r ||
      (vlan !== null && s.vlanId === vlan),
  );
}

/** How a flash names a placement target: “CCTV”, or VLAN 20 (“CCTV”) when one subnet carries it. */
export function placementTargetName(ref: string | undefined, subnets: readonly Subnet[]): string {
  const r = (ref ?? '').trim();
  const vlan = vlanRefId(r);
  if (vlan === null) return `“${r}”`;
  const [only, ...rest] = resolveSubnetRef(r, subnets);
  return only && rest.length === 0 ? `VLAN ${vlan} (“${only.name?.trim() || only.cidr}”)` : `VLAN ${vlan}`;
}

/**
 * Why a placement ref can't be restored into, or null when it names exactly one
 * subnet: "no subnet is on VLAN 20" / "VLAN 20 spans 2 subnets".
 */
export function placementTargetProblem(ref: string | undefined, subnets: readonly Subnet[]): string | null {
  const r = (ref ?? '').trim();
  const vlan = vlanRefId(r);
  const n = resolveSubnetRef(r, subnets).length;
  if (n === 1) return null;
  if (n === 0) return vlan !== null ? `no subnet is on VLAN ${vlan}` : `no subnet is named “${r}”`;
  return `${vlan !== null ? `VLAN ${vlan}` : `“${r}”`} spans ${n} subnets, and Conductor won’t guess which`;
}

/** Addressable `role` devices whose management IP is missing or outside every `targets` range. */
function placementOffenders(role: string, targets: readonly Subnet[], devices: readonly Device[]): Device[] {
  return devices.filter((d) => {
    if (normRole(d.role) !== role || !isAddressable(d.type)) return false;
    const ip = d.managementIp?.trim();
    return !ip || !targets.some((s) => ipInCidr(stripPrefix(ip), s.cidr));
  });
}

/**
 * For a VLAN rule, the role's devices patched into a port on another VLAN (see
 * portVlan.ts) — wrong at layer 2 whatever their address says. Empty for a subnet
 * rule.
 */
function portOffenders(
  role: string,
  vlan: number | null,
  devices: readonly Device[],
  links: readonly Link[],
  cables: readonly RackCable[] = [],
): string[] {
  if (vlan === null) return [];
  return devices
    .filter((d) => normRole(d.role) === role && isAddressable(d.type))
    .filter((d) => wrongPortVlans(d.id, vlan, devices, links, cables).length > 0)
    .map((d) => d.id);
}

/**
 * Plan the layer-2 half of restoring a VLAN rule: every port VLAN that puts one of
 * the role's devices on another VLAN, to be retagged to the rule's VLAN (the
 * switch's access port, the device's own port, or the link's VLAN field). Each tag
 * once, in device-id order. Trunks are never touched. Empty for a subnet rule.
 */
export function planPortRetag(
  rule: CustomRuleSpec,
  devices: readonly Device[],
  links: readonly Link[],
  cables: readonly RackCable[] = [],
): { tag: PortVlan; vlan: number }[] {
  const role = normRole(rule.fromRole);
  const vlan = vlanRefId(rule.subnet);
  if (rule.kind !== 'placement' || !role || vlan === null) return [];
  const seen = new Set<string>();
  const out: { tag: PortVlan; vlan: number }[] = [];
  for (const id of portOffenders(role, vlan, devices, links, cables).sort()) {
    for (const tag of wrongPortVlans(id, vlan, devices, links, cables)) {
      const key = 'linkId' in tag.on ? `link:${tag.on.linkId}` : `if:${tag.on.deviceId}:${tag.on.ifaceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ tag, vlan });
    }
  }
  return out;
}

export interface PlacementPlan {
  /** Device → its new management IP inside the target subnet. */
  assignments: AddressAssignment[];
  /** Offenders left as-is: the target is missing or ambiguous, or the subnet is full. */
  unplaced: string[];
}

/**
 * Plan to restore a placement rule: give each offending device the next free host
 * in the target subnet (management IP only — ports keep theirs). Refuses rather
 * than guesses: when the ref names no subnet, or several, nothing moves. Never
 * reuses an address already in the diagram. Deterministic by device id.
 */
export function planPlacement(
  rule: CustomRuleSpec,
  devices: readonly Device[],
  subnets: readonly Subnet[],
): PlacementPlan {
  const role = normRole(rule.fromRole);
  if (rule.kind !== 'placement' || !role) return { assignments: [], unplaced: [] };
  const targets = resolveSubnetRef(rule.subnet, subnets);
  const offenders = placementOffenders(role, targets, devices).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (targets.length !== 1) return { assignments: [], unplaced: offenders.map((d) => d.id) };
  const target = targets[0]!;
  const used = usedAddresses(devices).map((ip) => stripPrefix(ip));
  const assignments: AddressAssignment[] = [];
  const unplaced: string[] = [];
  for (const d of offenders) {
    const ip = nextFreeHost(target.cidr, used, { gateway: target.gateway });
    if (!ip) {
      unplaced.push(d.id);
      continue;
    }
    assignments.push({ deviceId: d.id, ip });
    used.push(ip);
  }
  return { assignments, unplaced };
}

/** Undirected adjacency: deviceId → set of neighbor ids (self-loops dropped). */
function buildAdjacency(ctx: InvariantContext): Map<string, Set<string>> {
  const neighbors = new Map<string, Set<string>>();
  for (const d of ctx.devices) neighbors.set(d.id, new Set());
  for (const l of ctx.links) {
    const a = neighbors.get(l.sourceId);
    const b = neighbors.get(l.targetId);
    if (a && b && l.sourceId !== l.targetId) {
      a.add(l.targetId);
      b.add(l.sourceId);
    }
  }
  return neighbors;
}

/**
 * The shortest path from `deviceId` to the nearest device with role `toRole` (not
 * itself), as device ids from it to that device — or null when none is reachable.
 * Ties go to the earlier device in the design, so it's stable.
 */
export function isolationPath(toRole: string, deviceId: string, ctx: InvariantContext): string[] | null {
  const to = normRole(toRole);
  if (!to) return null;
  const roleOf = new Map(ctx.devices.map((d) => [d.id, normRole(d.role)]));
  const neighbors = buildAdjacency(ctx);
  const order = new Map(ctx.devices.map((d, i) => [d.id, i]));
  const parent = new Map<string, string | null>([[deviceId, null]]);
  let frontier = [deviceId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const u of frontier) {
      const nbrs = [...(neighbors.get(u) ?? [])].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      for (const v of nbrs) {
        if (parent.has(v)) continue;
        parent.set(v, u);
        if (roleOf.get(v) === to) {
          const path = [v];
          for (let p = parent.get(v); p != null; p = parent.get(p)) path.unshift(p);
          return path;
        }
        next.push(v);
      }
    }
    frontier = next;
  }
  return null;
}

/** deviceId → component index, over the undirected graph (BFS flood fill). */
function connectedComponents(
  devices: readonly Device[],
  neighbors: Map<string, Set<string>>,
): Map<string, number> {
  const comp = new Map<string, number>();
  let next = 0;
  for (const d of devices) {
    if (comp.has(d.id)) continue;
    const id = next++;
    const queue = [d.id];
    comp.set(d.id, id);
    while (queue.length) {
      const cur = queue.pop()!;
      for (const n of neighbors.get(cur) ?? []) {
        if (!comp.has(n)) {
          comp.set(n, id);
          queue.push(n);
        }
      }
    }
  }
  return comp;
}

/**
 * Evaluate authored custom rules. Connectivity flags each `fromRole` device with
 * fewer than `min` `toRole` neighbors; isolation flags each `fromRole` device that
 * shares a connected component with any `toRole` device (i.e. can reach it). Blank
 * roles and unknown kinds are skipped. Not restorable — Conductor won't invent (or
 * cut) links.
 */
export function evaluateCustomRules(
  specs: readonly CustomRuleSpec[],
  ctx: InvariantContext,
): InvariantViolation[] {
  if (specs.length === 0) return [];
  const byId = new Map(ctx.devices.map((d) => [d.id, d]));
  const neighbors = buildAdjacency(ctx);
  let comp: Map<string, number> | null = null; // computed lazily, only for isolation
  const out: InvariantViolation[] = [];
  for (const r of specs) {
    const from = normRole(r.fromRole);
    const to = normRole(r.toRole);
    if (r.kind === 'placement') {
      // A placement rule targets a subnet, not a role. A ref that names no subnet
      // can't be met, so every device of the role is flagged (the panel says why).
      if (!from || !r.subnet?.trim()) continue;
      const ids = [
        ...new Set([
          ...placementOffenders(from, resolveSubnetRef(r.subnet, ctx.subnets), ctx.devices).map((d) => d.id),
          ...portOffenders(from, vlanRefId(r.subnet), ctx.devices, ctx.links, ctx.rackCables),
        ]),
      ];
      if (ids.length > 0) out.push({ id: r.id, label: customRuleLabel(r), objectIds: ids });
      continue;
    }
    if (r.kind === 'naming') {
      // Every counted device (role or type) whose name doesn't fit the template.
      const fits = namingMatcher(r.pattern);
      if (!from || !fits) continue;
      const ids = countedDevices(from, ctx.devices)
        .filter((d) => !fits(d.name))
        .map((d) => d.id);
      if (ids.length > 0) out.push({ id: r.id, label: customRuleLabel(r), objectIds: ids });
      continue;
    }
    if (r.kind === 'count') {
      // Broken by absence: no device is at fault, so nothing is flagged — the gap is.
      if (!from || !(r.min >= 1)) continue;
      const have = countedDevices(from, ctx.devices).length;
      if (have < r.min) out.push({ id: r.id, label: customRuleLabel(r), objectIds: [], shortfall: r.min - have });
      continue;
    }
    if (!from || !to) continue; // half-authored rule — nothing to assert yet
    const offenders: string[] = [];
    if (r.kind === 'connectivity') {
      for (const d of ctx.devices) {
        if (normRole(d.role) !== from) continue;
        let count = 0;
        for (const nId of neighbors.get(d.id) ?? []) {
          if (normRole(byId.get(nId)?.role) === to) count++;
        }
        if (count < r.min) offenders.push(d.id);
      }
    } else if (r.kind === 'isolation') {
      comp ??= connectedComponents(ctx.devices, neighbors);
      // Count toRole devices per component so a from===to rule ("no core may reach
      // a core") doesn't flag a lone device for "reaching" only itself.
      const toPerComponent = new Map<number, number>();
      for (const d of ctx.devices) {
        if (normRole(d.role) === to) {
          const c = comp.get(d.id)!;
          toPerComponent.set(c, (toPerComponent.get(c) ?? 0) + 1);
        }
      }
      for (const d of ctx.devices) {
        if (normRole(d.role) !== from) continue;
        const inComponent = toPerComponent.get(comp.get(d.id)!) ?? 0;
        const self = normRole(d.role) === to ? 1 : 0; // exclude d itself if roles coincide
        if (inComponent - self > 0) offenders.push(d.id);
      }
    } else {
      continue; // unknown kind from a newer build — preserved on disk, skipped here
    }
    if (offenders.length > 0) out.push({ id: r.id, label: customRuleLabel(r), objectIds: offenders });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Why — a per-offender reason for any violation, so a broken rule reads as a
 * to-do list ("10.10.0.21 is in “Office”, not “CCTV”") instead of a bare count.
 * Reasons are recomputed from the same primitives the checks use, so they can't
 * drift from what was flagged.
 * ------------------------------------------------------------------------- */

/** One object that breaks a rule, and what about it breaks the rule. */
export interface Offender {
  id: string;
  /** Display name (device name or type; subnet name or CIDR). */
  name: string;
  reason: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Explain each offender of a violation. `violationId` is a built-in invariant id
 * or a custom rule id (looked up in `customRules`). Objects that no longer exist
 * are dropped; an unknown rule falls back to a generic reason.
 */
export function explainOffenders(
  violationId: string,
  objectIds: readonly string[],
  ctx: InvariantContext,
  customRules: readonly CustomRuleSpec[] = [],
): Offender[] {
  const devices = new Map(ctx.devices.map((d) => [d.id, d]));
  const subnets = new Map(ctx.subnets.map((s) => [s.id, s]));
  const nameOf = (id: string): string | null => {
    const d = devices.get(id);
    if (d) return d.name.trim() || d.type;
    const s = subnets.get(id);
    return s ? s.name?.trim() || s.cidr : null;
  };
  const rule = customRules.find((r) => r.id === violationId);
  const why = reasonFor(violationId, rule, ctx);
  const out: Offender[] = [];
  for (const id of objectIds) {
    const name = nameOf(id);
    if (name !== null) out.push({ id, name, reason: why(id) });
  }
  return out;
}

/** Build the per-object reason function for one rule (shared setup computed once). */
function reasonFor(
  violationId: string,
  rule: CustomRuleSpec | undefined,
  ctx: InvariantContext,
): (id: string) => string {
  const byId = new Map(ctx.devices.map((d) => [d.id, d]));
  switch (violationId) {
    case 'no-single-point-of-failure': {
      const isolates = new Map(findSpofs(ctx.devices, ctx.links).map((s) => [s.deviceId, s.isolates]));
      return (id) => `its failure cuts off ${plural(isolates.get(id) ?? 0, 'device')}`;
    }
    case 'every-device-addressed':
      return () => 'no management IP';
    case 'every-device-named':
      return () => 'blank name';
    case 'every-subnet-has-gateway':
      return () => 'no gateway address';
  }
  if (!rule) return () => 'breaks this rule';
  const to = normRole(rule.toRole);
  if (rule.kind === 'connectivity') {
    const neighbors = buildAdjacency(ctx);
    return (id) => {
      let n = 0;
      for (const nId of neighbors.get(id) ?? []) if (normRole(byId.get(nId)?.role) === to) n++;
      return `links to ${n} of ≥${rule.min} “${rule.toRole.trim()}”`;
    };
  }
  if (rule.kind === 'isolation') {
    const nameOf = (id: string) => {
      const d = byId.get(id);
      return d ? d.name.trim() || d.type : '?';
    };
    return (id) => {
      // The shortest way through: which hop to cut is the question this answers.
      const path = isolationPath(rule.toRole, id, ctx);
      if (!path) return `reaches a “${rule.toRole.trim()}”`;
      const via = path.slice(1, -1);
      const route =
        via.length === 0 ? 'directly' : via.length <= 3 ? `via ${via.map(nameOf).join(' → ')}` : `via ${via.length} hops`;
      return `reaches “${rule.toRole.trim()}” ${nameOf(path[path.length - 1]!)} ${route}`;
    };
  }
  if (rule.kind === 'naming') {
    const want = `“${(rule.pattern ?? '').trim()}”`;
    return (id) => {
      const name = byId.get(id)?.name.trim() ?? '';
      return name ? `“${name}” doesn’t match ${want}` : `blank name, not ${want}`;
    };
  }
  if (rule.kind === 'placement') {
    const ref = (rule.subnet ?? '').trim();
    const vlan = vlanRefId(ref);
    const targets = resolveSubnetRef(ref, ctx.subnets);
    const want = vlan !== null ? `VLAN ${vlan}` : `“${ref}”`;
    const addressing = (id: string): string | null => {
      const ip = byId.get(id)?.managementIp?.trim();
      if (!ip) return 'no management IP';
      if (targets.length === 0) return vlan !== null ? `no subnet is on VLAN ${vlan}` : `no subnet named “${ref}”`;
      const bare = stripPrefix(ip);
      if (targets.some((s) => ipInCidr(bare, s.cidr))) return null; // the address is fine
      const home = ctx.subnets.find((s) => ipInCidr(bare, s.cidr));
      if (!home) return `${bare} is in no subnet, not ${want}`;
      const where = `“${home.name?.trim() || home.cidr}”`;
      // For a VLAN rule, say which VLAN the address actually lands on.
      if (vlan !== null) return `${bare} is in ${where} (${home.vlanId ? `VLAN ${home.vlanId}` : 'no VLAN'}), not ${want}`;
      return `${bare} is in ${where}, not ${want}`;
    };
    return (id) => {
      const reasons = [addressing(id)];
      // A VLAN rule also reads the ports: the address can be right and the port wrong.
      if (vlan !== null) {
        reasons.push(...wrongPortVlans(id, vlan, ctx.devices, ctx.links, ctx.rackCables).map(describePortVlan));
      }
      return reasons.filter((x): x is string => !!x).join('; ') || 'breaks this rule';
    };
  }
  return () => 'breaks this rule';
}
