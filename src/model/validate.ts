/**
 * Validation engine — the heart of NexMap's wedge ("the diagram that validates
 * itself"). MVP ships exactly four checks (PLAN.md §4 item 12); the engine is
 * structured so Post-MVP checks (overlapping subnets, VLAN ranges, rack collisions)
 * slot in as additional rule functions.
 *
 * Pure: takes devices + links, returns issues. The store runs this debounced in
 * M5; here it's just a function so it's trivially testable and worker-portable.
 */
import { cidrsOverlap, ipInCidr, isValidIpv4, isValidIpv6, parseCidr, stripPrefix } from '@/lib/ipcidr';
import type { Device, Link, Rack, Subnet, ValidationIssue, Vlan } from './types';

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
    if (l.mode === 'access' && (l.vlan?.split(',').filter((s) => s.trim()).length ?? 0) > 1) {
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

/** Run all validations. Deterministic order: errors-worthy checks first. */
export function validate({
  devices,
  links,
  vlans = [],
  subnets = [],
  racks = [],
}: ValidationInput): ValidationIssue[] {
  return [
    ...checkDuplicateIps(devices),
    ...checkInvalidIpCidr(devices),
    ...checkMissingEndpoints(devices, links),
    ...checkDuplicateVlans(vlans),
    ...checkVlanRange(vlans),
    ...checkSubnets(subnets),
    ...checkIpOutsideSubnet(devices, subnets),
    ...checkRacks(devices, racks),
    ...checkTrunkAccess(links),
    ...checkDuplicateNames(devices),
    ...checkDeviceNames(devices),
    ...checkOrphanedDevices(devices, links),
  ];
}

/** Severity ranking helper for sorting/summary UI. */
export function severityRank(s: ValidationIssue['severity']): number {
  return { info: 0, warn: 1, error: 2, critical: 3 }[s];
}
