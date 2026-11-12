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
  canonicalIp,
  isValidIpWithPrefix,
  isValidIpv4,
  isValidIpv6,
  parseCidr,
  parseIpv4,
  stripPrefix,
} from '@/lib/ipcidr';
import { intToIpv4, usableHostRange } from '@/lib/ipam';
import type { Device, Link, Rack, RackCable, Subnet, ValidationIssue, Vlan } from './types';
import { expectsLogicalLinks } from './topologyRole';
import { depthProblems, slotOf, slotsCollide } from '@/rack/rackModel';

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
  /** Physical patch cables: tells "cabled in the rack, not drawn" from "not connected". */
  rackCables?: RackCable[];
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

/**
 * Every address in the model, each tagged with the device that owns it: the
 * device's management IP plus every per-port interface IP (schema v5). The
 * address checks below all work off this one walk so management and port IPs
 * are validated identically.
 */
interface AddressRef {
  ip: string; // raw, may include a /prefix
  deviceId: string;
}
function allAddresses(devices: Device[]): AddressRef[] {
  const out: AddressRef[] = [];
  for (const d of devices) {
    if (d.managementIp?.trim()) out.push({ ip: d.managementIp, deviceId: d.id });
    for (const iface of d.interfaces ?? []) {
      if (iface.ip?.trim()) out.push({ ip: iface.ip, deviceId: d.id });
    }
  }
  return out;
}

/**
 * Rule: duplicate IP addresses across devices and their ports. Addresses meet in
 * their canonical spelling, so "2001:db8::1" and "2001:0db8:0:0:0:0:0:1" collide;
 * text that isn't an address buckets as itself (invalid-ip reports it).
 */
function checkDuplicateIps(devices: Device[]): ValidationIssue[] {
  const byIp = new Map<string, string[]>();
  for (const { ip: raw, deviceId } of allAddresses(devices)) {
    const ip = canonicalIp(raw) ?? stripPrefix(raw);
    if (!ip) continue;
    const list = byIp.get(ip) ?? [];
    list.push(deviceId);
    byIp.set(ip, list);
  }
  const issues: ValidationIssue[] = [];
  for (const [ip, ids] of byIp) {
    if (ids.length > 1) {
      // De-dupe object ids so a device with the same IP on two ports isn't double-listed.
      const objectIds = [...new Set(ids)];
      issues.push({
        id: issueId(),
        severity: 'error',
        code: 'duplicate-ip',
        message: `IP ${ip} is assigned to ${ids.length} interfaces.`,
        objectIds,
        address: ip,
      });
    }
  }
  return issues;
}

/**
 * Rule: every IP (management or per-port) is a valid IPv4/IPv6, and a /prefix on it
 * fits its family (/0–32 or /0–128).
 */
function checkInvalidIpCidr(devices: Device[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const { ip, deviceId } of allAddresses(devices)) {
    const raw = ip.trim();
    if (!raw) continue;
    if (raw.includes('/')) {
      if (!isValidIpWithPrefix(raw)) {
        issues.push({
          id: issueId(),
          severity: 'error',
          code: 'invalid-cidr',
          message: `"${raw}" is not a valid CIDR.`,
          objectIds: [deviceId],
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
        objectIds: [deviceId],
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

/** A finding before this run stamps it with an issue id. */
type Finding = Omit<ValidationIssue, 'id'>;

/** A valid subnet's index in the plan and its inclusive address range (uint32). */
interface SubnetRange {
  index: number;
  start: number;
  end: number;
}

/**
 * Rule: a valid subnet's gateway is a usable host inside it. Missing, malformed,
 * off-subnet and network/broadcast gateways each get their own finding, and each
 * says which addresses would do (the project's /31 and /32 host rules apply).
 */
function gatewayFinding(s: Subnet): Finding | null {
  const raw = s.gateway?.trim();
  const objectIds = [s.id];
  if (!raw) {
    return { severity: 'warn', code: 'subnet-no-gateway', message: `Subnet ${s.cidr} has no gateway.`, objectIds };
  }
  const hosts = usableHostRange(s.cidr)!;
  const first = intToIpv4(hosts.firstInt);
  const fix = hosts.count === 1 ? `use ${first}` : `use a host in ${first}–${intToIpv4(hosts.lastInt)}`;
  const ip = stripPrefix(raw);
  const v = parseIpv4(ip);
  if (v === null) {
    return {
      severity: 'error',
      code: 'subnet-gateway-invalid',
      message: `Gateway "${raw}" on ${s.cidr} is not an IPv4 address — ${fix}.`,
      objectIds,
    };
  }
  const { network, prefix } = parseCidr(s.cidr)!;
  if (v < network || v > network + 2 ** (32 - prefix) - 1) {
    return {
      severity: 'warn',
      code: 'subnet-gateway-outside',
      message: `Gateway ${ip} is outside ${s.cidr} — ${fix}.`,
      objectIds,
    };
  }
  if (v < hosts.firstInt || v > hosts.lastInt) {
    return {
      severity: 'warn',
      code: 'subnet-gateway-unusable',
      message: `Gateway ${ip} is the ${v === network ? 'network' : 'broadcast'} address of ${s.cidr} — ${fix}.`,
      objectIds,
    };
  }
  return null;
}

/**
 * Every overlapping pair, from one sorted sweep instead of comparing all pairs.
 * CIDR blocks never partly overlap — two either nest or are disjoint — so with the
 * ranges ordered by start (broader first) the still-open ranges form a chain of
 * containers, and each new range overlaps exactly the ones left open. Pairs come
 * back in the original (i, j) order so the findings match the pairwise rule's.
 */
function overlapFindings(subnets: Subnet[], ranges: SubnetRange[]): Finding[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end || a.index - b.index);
  const open: SubnetRange[] = [];
  const pairs: [number, number][] = [];
  for (const r of sorted) {
    while (open.length && open[open.length - 1]!.end < r.start) open.pop();
    for (const o of open) pairs.push(o.index < r.index ? [o.index, r.index] : [r.index, o.index]);
    open.push(r);
  }
  pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return pairs.map(([i, j]) => {
    const a = subnets[i]!;
    const b = subnets[j]!;
    return {
      severity: 'warn',
      code: 'overlapping-subnet',
      message: `Subnets ${a.cidr} and ${b.cidr} overlap.`,
      objectIds: [a.id, b.id],
    };
  });
}

/** The IP plan parsed once: its findings, and the merged ranges it covers (sorted). */
interface PlanCheck {
  key: string;
  findings: Finding[];
  covered: [number, number][];
}

/**
 * The plan checks read only each subnet's id, CIDR and gateway, so the last
 * result is kept and reused while those are unchanged — an edit elsewhere in the
 * diagram never re-checks a 1,000-subnet plan. Keyed on content, not identity, so
 * a subnet edited in place is never served stale.
 */
let lastPlan: PlanCheck | null = null;

function checkPlan(subnets: Subnet[]): PlanCheck {
  const key = subnets.map((s) => `${s.id}\u0000${s.cidr}\u0000${s.gateway ?? ''}`).join('\u0001');
  if (lastPlan?.key === key) return lastPlan;
  const findings: Finding[] = [];
  const ranges: SubnetRange[] = [];
  subnets.forEach((s, index) => {
    const p = parseCidr(s.cidr);
    if (!p) {
      findings.push(
        s.cidr.includes(':') && isValidIpWithPrefix(s.cidr.trim())
          ? {
              severity: 'info',
              code: 'ipv6-subnet-unsupported',
              message: `"${s.cidr}" is an IPv6 prefix — the IP Plan checks IPv4 subnets only, so its overlaps and gateway aren't checked.`,
              objectIds: [s.id],
            }
          : {
              severity: 'error',
              code: 'invalid-subnet-cidr',
              message: `"${s.cidr}" is not a valid subnet CIDR.`,
              objectIds: [s.id],
            },
      );
      return;
    }
    ranges.push({ index, start: p.network, end: p.network + 2 ** (32 - p.prefix) - 1 });
    const gw = gatewayFinding(s);
    if (gw) findings.push(gw);
  });
  findings.push(...overlapFindings(subnets, ranges));

  const covered: [number, number][] = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = covered[covered.length - 1];
    if (last && r.start <= last[1] + 1) last[1] = Math.max(last[1], r.end);
    else covered.push([r.start, r.end]);
  }
  lastPlan = { key, findings, covered };
  return lastPlan;
}

/** Rule: subnet CIDRs must be valid, have a usable gateway, and not overlap. */
function checkSubnets(subnets: Subnet[]): ValidationIssue[] {
  return checkPlan(subnets).findings.map((f) => ({ id: issueId(), ...f, objectIds: [...f.objectIds] }));
}

/** True if `v` falls in one of the sorted, disjoint `covered` ranges (binary search). */
function isCovered(covered: [number, number][], v: number): boolean {
  let lo = 0;
  let hi = covered.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = covered[mid]!;
    if (v < start) hi = mid - 1;
    else if (v > end) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Rule: every IP (management or per-port) should fall within one of the defined subnets. */
function checkIpOutsideSubnet(devices: Device[], subnets: Subnet[]): ValidationIssue[] {
  const { covered } = checkPlan(subnets);
  if (covered.length === 0) return [];
  const issues: ValidationIssue[] = [];
  for (const { ip: raw, deviceId } of allAddresses(devices)) {
    const ip = stripPrefix(raw);
    const v = parseIpv4(ip);
    if (v === null) continue; // IPv6/invalid handled elsewhere
    if (!isCovered(covered, v)) {
      issues.push({
        id: issueId(),
        severity: 'warn',
        code: 'ip-outside-subnet',
        message: `${ip} is not within any defined subnet.`,
        objectIds: [deviceId],
      });
    }
  }
  return issues;
}

/**
 * Rule: rack placements must not collide or overflow, and must fit the rack's depth.
 * Collisions follow the rack designer's own rule (rackModel.slotsCollide): opposite
 * faces, half-bays and 0U rail items share a U legitimately. Depth only ever warns:
 * a unit deeper than the rack, or a front + rear pair whose depths add up past it.
 */
function checkRacks(devices: Device[], racks: Rack[]): ValidationIssue[] {
  if (racks.length === 0) return [];
  const rackById = new Map(racks.map((r) => [r.id, r]));
  const issues: ValidationIssue[] = [];
  const placed = devices.filter((d) => d.rackId && d.ru != null && rackById.has(d.rackId));
  // Overflow / invalid range.
  for (const d of placed) {
    const height = rackById.get(d.rackId!)!.ruHeight;
    const span = d.ruSpan ?? 1;
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
  // Collisions within the same rack (the designer's own face/bay/rail/depth rule).
  const byRackId = new Map<string, Device[]>();
  for (const d of placed) {
    const list = byRackId.get(d.rackId!) ?? [];
    list.push(d);
    byRackId.set(d.rackId!, list);
  }
  for (const [rackId, list] of byRackId) {
    const rack = rackById.get(rackId)!;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        const sa = slotOf(a);
        const sb = slotOf(b);
        if (slotsCollide(sa, sb, rack.depthMm)) {
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
  // Depth: deeper than the rack, or front + rear too deep to share a U (warn only).
  for (const rack of racks) {
    const { tooDeep, clashes } = depthProblems(rack, placed);
    for (const d of tooDeep) {
      issues.push({
        id: issueId(),
        severity: 'warn',
        code: 'rack-depth-overflow',
        message: `${d.name} is ${d.depthMm} mm deep; ${rack.name} fits ${rack.depthMm} mm.`,
        objectIds: [d.id],
      });
    }
    for (const [a, b] of clashes) {
      issues.push({
        id: issueId(),
        severity: 'warn',
        code: 'rack-depth-clash',
        message: `${a.name} (${a.depthMm} mm) and ${b.name} (${b.depthMm} mm) sit front and rear of the same U but need ${
          a.depthMm! + b.depthMm!
        } mm of ${rack.name}'s ${rack.depthMm} mm.`,
        objectIds: [a.id, b.id],
      });
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

/**
 * Rule: a network device with no logical link is likely orphaned. One that is cabled in
 * the rack says so instead. Passive rack assets (power, cable management, panels) are
 * not expected to have links: they get one summary line, with no object ids — it is a
 * note about the design, not something to open.
 */
function checkOrphanedDevices(
  devices: Device[],
  links: Link[],
  rackCables: RackCable[],
): ValidationIssue[] {
  if (devices.length <= 1) return [];
  const connected = new Set<string>();
  for (const l of links) {
    connected.add(l.sourceId);
    connected.add(l.targetId);
  }
  const cabled = new Set<string>();
  for (const c of rackCables) {
    cabled.add(c.aEnd.deviceId);
    cabled.add(c.bEnd.deviceId);
  }
  const issues: ValidationIssue[] = [];
  let passive = 0;
  for (const d of devices) {
    if (connected.has(d.id)) continue;
    if (!expectsLogicalLinks(d)) {
      passive += 1;
    } else if (cabled.has(d.id)) {
      issues.push({
        id: issueId(),
        severity: 'info',
        code: 'cabled-no-logical-link',
        message: `${d.name} is cabled in the rack but has no link in the network diagram.`,
        objectIds: [d.id],
      });
    } else {
      issues.push({
        id: issueId(),
        severity: 'info',
        code: 'orphaned-device',
        message: `${d.name} has no logical connections.`,
        objectIds: [d.id],
      });
    }
  }
  if (passive > 0) {
    issues.push({
      id: issueId(),
      severity: 'info',
      code: 'passive-assets',
      message:
        passive === 1
          ? '1 passive rack asset (power, cable management, panels) is not expected to have network links.'
          : `${passive} passive rack assets (power, cable management, panels) are not expected to have network links.`,
      objectIds: [],
    });
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
  rackCables = [],
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
    ...checkInterfaces(devices, links),
    ...checkDuplicateNames(devices),
    ...checkDeviceNames(devices),
    ...checkOrphanedDevices(devices, links, rackCables),
  ];
}

/** Severity ranking helper for sorting/summary UI. */
export function severityRank(s: ValidationIssue['severity']): number {
  return { info: 0, warn: 1, error: 2, critical: 3 }[s];
}
