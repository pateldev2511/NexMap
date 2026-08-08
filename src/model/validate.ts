/**
 * Validation engine — the heart of NexMap's wedge ("the diagram that validates
 * itself"). MVP ships exactly four checks (PLAN.md §4 item 12); the engine is
 * structured so Post-MVP checks (overlapping subnets, VLAN ranges, rack collisions)
 * slot in as additional rule functions.
 *
 * Pure: takes devices + links, returns issues. The store runs this debounced in
 * M5; here it's just a function so it's trivially testable and worker-portable.
 */
import {
  cidrsOverlap,
  ipInCidr,
  isValidIpv4,
  isValidIpv6,
  parseCidr,
  stripPrefix,
} from '@/lib/ipcidr';
import { couplingProblems } from './coupling';
import { cycleIds, duplicateSiblingTokens, oddNesting, orphanRefs } from './location';
import type {
  Device,
  Link,
  Location,
  Rack,
  Subnet,
  ValidationIssue,
  Vlan,
} from './types';

let counter = 0;
function issueId(): string {
  counter += 1;
  return `iss-${counter}`;
}

/** Reset the deterministic issue counter (tests / fresh runs). */
export function resetIssueIds(): void {
  counter = 0;
}

export interface ValidationInput {
  devices: Device[];
  links: Link[];
  vlans?: Vlan[];
  subnets?: Subnet[];
  racks?: Rack[];
  locations?: Location[];
}

/**
 * Rule (E1–E4): patch-panel pass-throughs must be symmetric. A `throughTo` that
 * points at itself, at nothing, at another device, or at a port that does not point
 * back is an ERROR — the pairing is claimed but not real, so a trace stops there
 * rather than crossing a coupling that only half exists.
 *
 * Not auto-repaired: choosing which half of a broken pair to believe would silently
 * rewire the user's documentation.
 *
 * NOTE: physical cable LOOPS are deliberately not checked here — `rackHealth.ts`
 * already reports `rack-loop` (with the STP explanation) and a second issue for the
 * same cabling would be duplicate noise. The trace engine still reports
 * `end: 'loop'` so a walk can never spin.
 */
function checkPortCoupling(devices: Device[]): ValidationIssue[] {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const nameOf = (deviceId: string, ifaceId: string) => {
    const d = byId.get(deviceId);
    const i = d?.interfaces?.find((x) => x.id === ifaceId);
    return `${d?.name ?? deviceId} ${i?.name ?? ifaceId}`.trim();
  };

  return couplingProblems(devices).map((p) => {
    const port = nameOf(p.deviceId, p.ifaceId);
    const detail =
      p.kind === 'self'
        ? `${port} is wired through to itself.`
        : p.kind === 'missing'
          ? `${port} is wired through to a port that no longer exists.`
          : p.kind === 'cross-device'
            ? `${port} is wired through to a port on another device; a pass-through pair must be on the same panel.`
            : `${port} claims a pass-through that is not wired back, so the pair is one-sided.`;
    return {
      id: issueId(),
      severity: 'error' as const,
      code: `port-coupling-${p.kind}`,
      message: detail,
      objectIds: [p.deviceId],
    };
  });
}

/**
 * Rule (E12): a `parentId` cycle is an ERROR. It is never auto-broken — picking a
 * link to sever would silently move part of the user's tree somewhere they never
 * asked for. Traversal degrades safely meanwhile (see model/location.ts).
 */
function checkLocationCycles(locations: Location[]): ValidationIssue[] {
  const onCycle = cycleIds(locations);
  if (onCycle.size === 0) return [];
  const names = locations
    .filter((l) => onCycle.has(l.id))
    .map((l) => l.name)
    .join(', ');
  return [
    {
      id: issueId(),
      severity: 'error',
      code: 'location-cycle',
      message: `Location hierarchy contains a loop (${names}). Re-parent one of them to break it.`,
      objectIds: [...onCycle],
    },
  ];
}

/**
 * Rule (E13): a `parentId` pointing at a location that no longer exists. Warn, and
 * the navigator shows the node as a root so its subtree can't hide.
 */
function checkLocationOrphans(locations: Location[]): ValidationIssue[] {
  return orphanRefs(locations).map((l) => ({
    id: issueId(),
    severity: 'warn' as const,
    code: 'location-orphan-ref',
    message: `${l.name} points at a parent location that no longer exists; showing it at the top level.`,
    objectIds: [l.id],
  }));
}

/**
 * Rule (E15): two siblings sharing a path token make the fully-qualified path
 * ambiguous — two different racks could address to the same string. Warn only:
 * duplicate names are legal, just unhelpful.
 */
function checkLocationDuplicateCodes(locations: Location[]): ValidationIssue[] {
  return duplicateSiblingTokens(locations).map((d) => ({
    id: issueId(),
    severity: 'warn' as const,
    code: 'location-duplicate-sibling-code',
    message: `More than one location here resolves to "${d.token}", so qualified paths are ambiguous.`,
    objectIds: d.ids,
  }));
}

/**
 * Rule (E16): odd containment order, e.g. a floor inside a room. WARN ONLY and
 * deliberately so — real estate is messy and blocking it would fight the user.
 */
function checkLocationNesting(locations: Location[]): ValidationIssue[] {
  const byId = new Map(locations.map((l) => [l.id, l]));
  return oddNesting(locations).map(({ childId, parentId }) => {
    const child = byId.get(childId)!;
    const parent = byId.get(parentId)!;
    return {
      id: issueId(),
      severity: 'info' as const,
      code: 'location-odd-nesting',
      message: `${child.name} (${child.kind}) sits inside ${parent.name} (${parent.kind}), which is an unusual order.`,
      objectIds: [childId, parentId],
    };
  });
}

/**
 * Rule: a rack or device pointing at a location id that does not exist. Distinct
 * from `location-orphan-ref` (which is location→location); this one is
 * placement→location and leaves the item effectively unplaced.
 */
function checkLocationRefs(
  devices: Device[],
  racks: Rack[],
  locations: Location[],
): ValidationIssue[] {
  if (locations.length === 0) {
    // Nothing to point at — but a stale ref left over from a deleted tree still counts.
    const stale = [
      ...racks.filter((r) => r.locationId != null),
      ...devices.filter((d) => d.locationId != null),
    ];
    if (stale.length === 0) return [];
  }
  const ids = new Set(locations.map((l) => l.id));
  const issues: ValidationIssue[] = [];
  for (const r of racks) {
    if (r.locationId != null && !ids.has(r.locationId)) {
      issues.push({
        id: issueId(),
        severity: 'warn',
        code: 'location-missing-ref',
        message: `Rack ${r.name} references a location that no longer exists.`,
        objectIds: [r.id],
      });
    }
  }
  for (const d of devices) {
    if (d.locationId != null && !ids.has(d.locationId)) {
      issues.push({
        id: issueId(),
        severity: 'warn',
        code: 'location-missing-ref',
        message: `${d.name} references a location that no longer exists.`,
        objectIds: [d.id],
      });
    }
  }
  return issues;
}

/** Rule: a device must have a non-empty name. */
function checkDeviceNames(devices: Device[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const d of devices) {
    if (!d.name.trim()) {
      issues.push({
        id: issueId(),
        severity: 'warn',
        code: 'device-no-name',
        message: 'Device has no name.',
        objectIds: [d.id],
      });
    }
  }
  return issues;
}

/** Rule: duplicate device names (one issue per duplicated name, listing all). */
function checkDuplicateNames(devices: Device[]): ValidationIssue[] {
  const byName = new Map<string, string[]>();
  for (const d of devices) {
    const key = d.name.trim().toLowerCase();
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push(d.id);
    byName.set(key, list);
  }
  const issues: ValidationIssue[] = [];
  for (const [, ids] of byName) {
    if (ids.length > 1) {
      const name = devices.find((d) => d.id === ids[0])?.name ?? '';
      issues.push({
        id: issueId(),
        severity: 'warn',
        code: 'duplicate-name',
        message: `${ids.length} devices share the name "${name}".`,
        objectIds: ids,
      });
    }
  }
  return issues;
}

/** Rule: duplicate management IP addresses across devices. */
function checkDuplicateIps(devices: Device[]): ValidationIssue[] {
  const byIp = new Map<string, string[]>();
  for (const d of devices) {
    if (!d.managementIp) continue;
    const ip = stripPrefix(d.managementIp);
    if (!ip) continue;
    const list = byIp.get(ip) ?? [];
    list.push(d.id);
    byIp.set(ip, list);
  }
  const issues: ValidationIssue[] = [];
  for (const [ip, ids] of byIp) {
    if (ids.length > 1) {
      issues.push({
        id: issueId(),
        severity: 'error',
        code: 'duplicate-ip',
        message: `IP ${ip} is assigned to ${ids.length} devices.`,
        objectIds: ids,
      });
    }
  }
  return issues;
}

/** Rule: management IP is a valid IPv4/IPv6, and any /prefix is a valid CIDR. */
function checkInvalidIpCidr(devices: Device[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const d of devices) {
    const raw = d.managementIp?.trim();
    if (!raw) continue;
    if (raw.includes('/')) {
      if (!parseCidr(raw)) {
        issues.push({
          id: issueId(),
          severity: 'error',
          code: 'invalid-cidr',
          message: `"${raw}" is not a valid CIDR.`,
          objectIds: [d.id],
        });
      }
      continue;
    }
    if (!isValidIpv4(raw) && !isValidIpv6(raw)) {
      issues.push({
        id: issueId(),
        severity: 'error',
        code: 'invalid-ip',
        message: `"${raw}" is not a valid IP address.`,
        objectIds: [d.id],
      });
    }
  }
  return issues;
}

/** Rule: a link references a device that does not exist (missing endpoint). */
function checkMissingEndpoints(devices: Device[], links: Link[]): ValidationIssue[] {
  const ids = new Set(devices.map((d) => d.id));
  const issues: ValidationIssue[] = [];
  for (const l of links) {
    const missing: string[] = [];
    if (!ids.has(l.sourceId)) missing.push('source');
    if (!ids.has(l.targetId)) missing.push('target');
    if (missing.length > 0) {
      issues.push({
        id: issueId(),
        severity: 'error',
        code: 'missing-endpoint',
        message: `Link is missing its ${missing.join(' and ')} device.`,
        objectIds: [l.id],
      });
    }
  }
  return issues;
}

/** Rule: VLAN IDs must be unique. */
function checkDuplicateVlans(vlans: Vlan[]): ValidationIssue[] {
  const byId = new Map<number, string[]>();
  for (const v of vlans) {
    const list = byId.get(v.vlanId) ?? [];
    list.push(v.id);
    byId.set(v.vlanId, list);
  }
  const issues: ValidationIssue[] = [];
  for (const [vid, ids] of byId) {
    if (ids.length > 1) {
      issues.push({
        id: issueId(),
        severity: 'error',
        code: 'duplicate-vlan',
        message: `VLAN ID ${vid} is defined ${ids.length} times.`,
        objectIds: ids,
      });
    }
  }
  return issues;
}

/** Rule: VLAN IDs must be within 1–4094. */
function checkVlanRange(vlans: Vlan[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const v of vlans) {
    if (!Number.isInteger(v.vlanId) || v.vlanId < 1 || v.vlanId > 4094) {
      issues.push({
        id: issueId(),
        severity: 'error',
        code: 'invalid-vlan-range',
        message: `VLAN ID ${v.vlanId} is outside the valid range (1–4094).`,
        objectIds: [v.id],
      });
    }
  }
  return issues;
}

/** Rule: subnet CIDRs must be valid and not overlap. */
function checkSubnets(subnets: Subnet[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const s of subnets) {
    if (!parseCidr(s.cidr)) {
      issues.push({
        id: issueId(),
        severity: 'error',
        code: 'invalid-subnet-cidr',
        message: `"${s.cidr}" is not a valid subnet CIDR.`,
        objectIds: [s.id],
      });
    } else if (!s.gateway?.trim()) {
      issues.push({
        id: issueId(),
        severity: 'warn',
        code: 'subnet-no-gateway',
        message: `Subnet ${s.cidr} has no gateway.`,
        objectIds: [s.id],
      });
    }
  }
  // Pairwise overlap.
  for (let i = 0; i < subnets.length; i++) {
    for (let j = i + 1; j < subnets.length; j++) {
      const a = subnets[i]!;
      const b = subnets[j]!;
      if (parseCidr(a.cidr) && parseCidr(b.cidr) && cidrsOverlap(a.cidr, b.cidr)) {
        issues.push({
          id: issueId(),
          severity: 'warn',
          code: 'overlapping-subnet',
          message: `Subnets ${a.cidr} and ${b.cidr} overlap.`,
          objectIds: [a.id, b.id],
        });
      }
    }
  }
  return issues;
}

/** Rule: a device IP should fall within one of the defined subnets. */
function checkIpOutsideSubnet(devices: Device[], subnets: Subnet[]): ValidationIssue[] {
  const cidrs = subnets.map((s) => s.cidr).filter((c) => parseCidr(c));
  if (cidrs.length === 0) return [];
  const issues: ValidationIssue[] = [];
  for (const d of devices) {
    if (!d.managementIp) continue;
    const ip = stripPrefix(d.managementIp);
    if (!isValidIpv4(ip)) continue; // IPv6/invalid handled elsewhere
    if (!cidrs.some((c) => ipInCidr(ip, c))) {
      issues.push({
        id: issueId(),
        severity: 'warn',
        code: 'ip-outside-subnet',
        message: `${ip} is not within any defined subnet.`,
        objectIds: [d.id],
      });
    }
  }
  return issues;
}

/** Rule: rack RU placements must not collide or overflow. */
function checkRacks(devices: Device[], racks: Rack[]): ValidationIssue[] {
  if (racks.length === 0) return [];
  const byRack = new Map<string, number>();
  for (const r of racks) byRack.set(r.id, r.ruHeight);
  const issues: ValidationIssue[] = [];
  const placed = devices.filter((d) => d.rackId && d.ru != null);
  // Overflow / invalid range.
  for (const d of placed) {
    const height = byRack.get(d.rackId!);
    const span = d.ruSpan ?? 1;
    if (height == null) continue;
    if (d.ru! < 1 || d.ru! + span - 1 > height) {
      issues.push({
        id: issueId(),
        severity: 'warn',
        code: 'rack-ru-overflow',
        message: `${d.name} occupies U${d.ru}–U${d.ru! + span - 1}, outside rack capacity (${height}U).`,
        objectIds: [d.id],
      });
    }
  }
  // Collisions within the same rack.
  const byRackId = new Map<string, Device[]>();
  for (const d of placed) {
    const list = byRackId.get(d.rackId!) ?? [];
    list.push(d);
    byRackId.set(d.rackId!, list);
  }
  for (const [, list] of byRackId) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        const aTop = a.ru! + (a.ruSpan ?? 1) - 1;
        const bTop = b.ru! + (b.ruSpan ?? 1) - 1;
        if (a.ru! <= bTop && b.ru! <= aTop) {
          issues.push({
            id: issueId(),
            severity: 'error',
            code: 'rack-ru-collision',
            message: `${a.name} and ${b.name} overlap in the rack (U${a.ru} vs U${b.ru}).`,
            objectIds: [a.id, b.id],
          });
        }
      }
    }
  }
  return issues;
}

/** Rule: trunk links should carry VLANs; access links shouldn't carry several. */
function checkTrunkAccess(links: Link[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const l of links) {
    if (l.mode === 'trunk' && !l.vlan?.trim()) {
      issues.push({
        id: issueId(),
        severity: 'warn',
        code: 'trunk-missing-vlan',
        message: `Trunk link "${l.name ?? l.id}" carries no VLANs.`,
        objectIds: [l.id],
      });
    }
    if (
      l.mode === 'access' &&
      (l.vlan?.split(',').filter((s) => s.trim()).length ?? 0) > 1
    ) {
      issues.push({
        id: issueId(),
        severity: 'warn',
        code: 'access-multi-vlan',
        message: `Access link "${l.name ?? l.id}" carries multiple VLANs.`,
        objectIds: [l.id],
      });
    }
  }
  return issues;
}

/** Rule: a device with no links is likely orphaned. */
function checkOrphanedDevices(devices: Device[], links: Link[]): ValidationIssue[] {
  if (devices.length <= 1) return [];
  const connected = new Set<string>();
  for (const l of links) {
    connected.add(l.sourceId);
    connected.add(l.targetId);
  }
  const issues: ValidationIssue[] = [];
  for (const d of devices) {
    if (!connected.has(d.id)) {
      issues.push({
        id: issueId(),
        severity: 'info',
        code: 'orphaned-device',
        message: `${d.name} has no connections.`,
        objectIds: [d.id],
      });
    }
  }
  return issues;
}

/**
 * Rule: a link's interface reference must resolve to an interface on its endpoint
 * device, and a physical interface shouldn't carry more than one link.
 */
function checkInterfaces(devices: Device[], links: Link[]): ValidationIssue[] {
  const byDevice = new Map(devices.map((d) => [d.id, d]));
  const issues: ValidationIssue[] = [];
  // Count links per (device, interface) to find over-subscribed ports.
  const usage = new Map<string, { count: number; deviceId: string; name: string }>();

  const note = (deviceId: string, ifaceId: string | undefined, linkId: string) => {
    if (!ifaceId) return;
    const dev = byDevice.get(deviceId);
    const iface = dev?.interfaces?.find((i) => i.id === ifaceId);
    if (!iface) {
      issues.push({
        id: issueId(),
        severity: 'warn',
        code: 'dangling-interface',
        message: `A link references an interface that no longer exists on ${dev?.name ?? deviceId}.`,
        objectIds: [linkId, deviceId],
      });
      return;
    }
    const key = `${deviceId}|${ifaceId}`;
    const u = usage.get(key) ?? { count: 0, deviceId, name: `${dev?.name ?? ''} ${iface.name}`.trim() };
    u.count += 1;
    usage.set(key, u);
  };

  for (const l of links) {
    note(l.sourceId, l.sourceIfaceId, l.id);
    note(l.targetId, l.targetIfaceId, l.id);
  }
  for (const u of usage.values()) {
    if (u.count > 1) {
      issues.push({
        id: issueId(),
        severity: 'warn',
        code: 'oversubscribed-interface',
        message: `Interface ${u.name} carries ${u.count} links — a physical port usually has one.`,
        objectIds: [u.deviceId],
      });
    }
  }
  return issues;
}

/** Run all validations. Deterministic order: errors-worthy checks first. */
export function validate({
  devices,
  links,
  vlans = [],
  subnets = [],
  racks = [],
  locations = [],
}: ValidationInput): ValidationIssue[] {
  return [
    ...checkLocationCycles(locations),
    ...checkLocationOrphans(locations),
    ...checkLocationDuplicateCodes(locations),
    ...checkLocationNesting(locations),
    ...checkLocationRefs(devices, racks, locations),
    ...checkPortCoupling(devices),
    ...checkDuplicateIps(devices),
    ...checkInvalidIpCidr(devices),
    ...checkMissingEndpoints(devices, links),
    ...checkDuplicateVlans(vlans),
    ...checkVlanRange(vlans),
    ...checkSubnets(subnets),
    ...checkIpOutsideSubnet(devices, subnets),
    ...checkRacks(devices, racks),
    ...checkTrunkAccess(links),
    ...checkInterfaces(devices, links),
    ...checkDuplicateNames(devices),
    ...checkDeviceNames(devices),
    ...checkOrphanedDevices(devices, links),
  ];
}

/** Severity ranking helper for sorting/summary UI. */
export function severityRank(s: ValidationIssue['severity']): number {
  return { info: 0, warn: 1, error: 2, critical: 3 }[s];
}
