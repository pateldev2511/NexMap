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
import type { Device, Link, Subnet, CustomRuleSpec } from './types';
import { isAddressable } from '@/sim/autoAddress';
import { findSpofs } from '@/sim/resilience';

export type { CustomRuleSpec };

/** The slice of the model an invariant reads. Plain arrays, like the planners. */
export interface InvariantContext {
  devices: Device[];
  links: Link[];
  subnets: Subnet[];
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
 * Two kinds, both over the free-text `Device.role` (matched case-insensitively):
 *  - CONNECTIVITY: "every A connects to ≥N B" (direct neighbors) — e.g. access → ≥2 core.
 *  - ISOLATION:    "no A may reach any B" (any path through links) — e.g. guest ✗ internal.
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

const normRole = (s: string | undefined): string => (s ?? '').trim().toLowerCase();

/** Human-readable name for a custom rule. */
export function customRuleLabel(r: CustomRuleSpec): string {
  const a = r.fromRole.trim();
  const b = r.toRole.trim();
  return r.kind === 'isolation'
    ? `No “${a}” may reach “${b}”`
    : `Every “${a}” connects to ≥${r.min} “${b}”`;
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
