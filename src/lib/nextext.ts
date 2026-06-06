/**
 * NexText — a tiny, forgiving text-to-diagram language. Type a network as text,
 * get a laid-out, validated diagram. This is Stage 1's moat piece: the fastest way
 * to scaffold a topology, and it stays 100% local (pure functions, no network).
 *
 * Grammar (line-oriented, order-independent, `#` starts a comment):
 *   <type> <name> [key=value ...]      device     e.g.  router R1 vendor=Cisco
 *   <name> - <name> [key=value ...]    link        e.g.  R1 - SW1 vlan=10
 *   <name> -> <name>                   directed link (arrow at target)
 *   subnet <cidr> [key=value ...]      subnet      e.g.  subnet 10.0.0.0/24 gw=10.0.0.1
 *   vlan <id> [key=value ...]          vlan        e.g.  vlan 10 name=Users
 *
 * A name used in a link but never declared is auto-created as a generic node (with a
 * warning). Quote values with spaces: name="Core Switch". The parser is TOTAL — bad
 * input produces diagnostics, never an exception (this is the connectorLabelLines
 * lesson: malformed input must not crash a render).
 *
 * This module is pure and canvas-free. The store action `applyNexText` turns a parse
 * result into model objects and commits them; `buildModel` here does the conversion so
 * it can be unit-tested with a deterministic id generator.
 */
import { nanoid } from 'nanoid';
import { createDevice, createLink, createSubnet, createVlan, DEFAULT_DEVICE_SIZE } from '@/model/schema';
import type { Device, DeviceType, Link, Subnet, Vlan } from '@/model/types';
import { isValidCidr } from './ipcidr';
import { autoLayoutPositions } from './layout';

// ── Public types ────────────────────────────────────────────────────────────

export interface Diagnostic {
  line: number; // 1-based source line; 0 = whole-document
  severity: 'error' | 'warn';
  message: string;
}

export interface NexDevice {
  name: string;
  type: DeviceType;
  props: Partial<Device>;
  /** True when created implicitly by a link reference rather than declared. */
  auto: boolean;
}
export interface NexLink {
  source: string;
  target: string;
  props: Partial<Link>;
}
export interface NexSubnet {
  cidr: string;
  props: Partial<Subnet>;
}
export interface NexVlan {
  vlanId: number;
  props: Partial<Vlan>;
}

export interface ParseResult {
  devices: NexDevice[];
  links: NexLink[];
  subnets: NexSubnet[];
  vlans: NexVlan[];
  diagnostics: Diagnostic[];
}

export interface BuildOptions {
  layerId: string;
  idGen?: () => string;
}
export interface BuiltModel {
  devices: Device[];
  links: Link[];
  subnets: Subnet[];
  vlans: Vlan[];
}

// ── Type aliases ──────────────────────────────────────────────────────────────

/** Tokens (lowercased) the parser accepts for each device type. */
const TYPE_ALIASES: Record<string, DeviceType> = {
  router: 'router', r: 'router', rtr: 'router',
  switch: 'switch', sw: 'switch',
  firewall: 'firewall', fw: 'firewall',
  ap: 'access-point', 'access-point': 'access-point', accesspoint: 'access-point', wifi: 'access-point',
  wlc: 'wireless-controller', 'wireless-controller': 'wireless-controller',
  server: 'server', srv: 'server',
  storage: 'storage', nas: 'storage', san: 'storage',
  lb: 'load-balancer', 'load-balancer': 'load-balancer', loadbalancer: 'load-balancer',
  pc: 'end-user', host: 'end-user', endpoint: 'end-user', 'end-user': 'end-user', user: 'end-user', client: 'end-user',
  printer: 'printer',
  iot: 'iot',
  isp: 'isp', wan: 'isp', internet: 'isp',
  cloud: 'cloud',
  vm: 'vm',
  container: 'container', docker: 'container',
  rack: 'rack',
  'patch-panel': 'patch-panel', patchpanel: 'patch-panel', patch: 'patch-panel',
  ups: 'ups',
  camera: 'camera', cam: 'camera',
  vpc: 'vpc', vnet: 'vpc',
  igw: 'internet-gateway', 'internet-gateway': 'internet-gateway',
  nat: 'nat-gateway', 'nat-gateway': 'nat-gateway',
  'route-table': 'route-table', routetable: 'route-table',
  sg: 'security-group', 'security-group': 'security-group',
  vpn: 'vpn-gateway', 'vpn-gateway': 'vpn-gateway',
  k8s: 'k8s', kubernetes: 'k8s', kube: 'k8s',
  db: 'managed-db', 'managed-db': 'managed-db', database: 'managed-db',
  s3: 'object-storage', 'object-storage': 'object-storage', bucket: 'object-storage',
  'cloud-subnet': 'cloud-subnet',
  node: 'generic', generic: 'generic', device: 'generic',
};

/** Preferred token to emit per type when serializing (must round-trip through TYPE_ALIASES). */
const SERIALIZE_TOKEN: Record<DeviceType, string> = {
  router: 'router', switch: 'switch', firewall: 'firewall', 'access-point': 'ap',
  'wireless-controller': 'wlc', server: 'server', storage: 'storage', 'load-balancer': 'lb',
  'end-user': 'pc', printer: 'printer', iot: 'iot', isp: 'isp', cloud: 'cloud', vm: 'vm',
  container: 'container', rack: 'rack', 'patch-panel': 'patch-panel', ups: 'ups', camera: 'camera',
  vpc: 'vpc', 'cloud-subnet': 'cloud-subnet', 'internet-gateway': 'igw', 'nat-gateway': 'nat',
  'route-table': 'route-table', 'security-group': 'sg', 'vpn-gateway': 'vpn', k8s: 'k8s',
  'managed-db': 'db', 'object-storage': 's3', generic: 'node',
};

const LINK_OPS = new Set(['-', '--', '->', '<->', '<-']);
const RESERVED = new Set(['subnet', 'vlan']);

// ── Tokenizer ──────────────────────────────────────────────────────────────

/** Split a line into whitespace-delimited tokens, honoring double-quoted spans. */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    while (i < n && /\s/.test(line[i]!)) i++;
    if (i >= n) break;
    let tok = '';
    while (i < n && !/\s/.test(line[i]!)) {
      if (line[i] === '"') {
        i++;
        while (i < n && line[i] !== '"') tok += line[i++];
        i++; // closing quote (or EOL)
      } else {
        tok += line[i++];
      }
    }
    tokens.push(tok);
  }
  return tokens;
}

/** Strip a trailing `#` comment that is not inside a quoted span. */
function stripComment(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    else if (line[i] === '#' && !inQuote) return line.slice(0, i);
  }
  return line;
}

/** Parse `key=value` tokens; returns the map plus any tokens that lacked `=`. */
function parseAttrs(tokens: string[]): { attrs: Map<string, string>; bad: string[] } {
  const attrs = new Map<string, string>();
  const bad: string[] = [];
  for (const t of tokens) {
    const eq = t.indexOf('=');
    if (eq <= 0) {
      bad.push(t);
      continue;
    }
    attrs.set(t.slice(0, eq).toLowerCase(), t.slice(eq + 1));
  }
  return { attrs, bad };
}

// ── Attr → field mapping ─────────────────────────────────────────────────────

function applyDeviceAttrs(attrs: Map<string, string>, props: Partial<Device>, extra: Record<string, unknown>) {
  for (const [k, v] of attrs) {
    switch (k) {
      case 'vendor': props.vendor = v; break;
      case 'model': props.model = v; break;
      case 'role': props.role = v; break;
      case 'ip': case 'mgmt': case 'managementip': props.managementIp = v; break;
      case 'location': case 'loc': props.location = v; break;
      case 'notes': props.notes = v; break;
      case 'name': props.name = v; break;
      case 'fill': props.fill = v; break;
      default: extra[k] = v;
    }
  }
}

function applyLinkAttrs(attrs: Map<string, string>, props: Partial<Link>, extra: Record<string, unknown>) {
  for (const [k, v] of attrs) {
    switch (k) {
      case 'vlan': props.vlan = v; break;
      case 'bandwidth': case 'bw': props.bandwidth = v; break;
      case 'mode': props.mode = v === 'trunk' ? 'trunk' : 'access'; break;
      case 'type': props.linkType = v; break;
      case 'native': props.nativeVlan = v; break;
      case 'lacp': props.lacp = v; break;
      case 'circuit': props.circuitId = v; break;
      case 'name': props.name = v; break;
      default: extra[k] = v;
    }
  }
}

// ── Parser ──────────────────────────────────────────────────────────────────

export function parseNexText(src: string): ParseResult {
  const devices: NexDevice[] = [];
  const links: NexLink[] = [];
  const subnets: NexSubnet[] = [];
  const vlans: NexVlan[] = [];
  const diagnostics: Diagnostic[] = [];
  const byName = new Map<string, NexDevice>();

  const warn = (line: number, message: string) => diagnostics.push({ line, severity: 'warn', message });
  const error = (line: number, message: string) => diagnostics.push({ line, severity: 'error', message });

  /** Ensure a device exists for `name`; auto-create a generic node if missing. */
  const ensureDevice = (name: string, line: number): NexDevice => {
    const existing = byName.get(name);
    if (existing) return existing;
    const d: NexDevice = { name, type: 'generic', props: {}, auto: true };
    byName.set(name, d);
    devices.push(d);
    warn(line, `"${name}" was used in a link but never declared — added as a generic node.`);
    return d;
  };

  const rawLines = src.split(/\r?\n/);
  for (let li = 0; li < rawLines.length; li++) {
    const lineNo = li + 1;
    const content = stripComment(rawLines[li]!).trim();
    if (!content) continue;
    const tokens = tokenize(content);
    if (tokens.length === 0) continue;

    const opIndex = tokens.findIndex((t) => LINK_OPS.has(t));

    // ── Link statement ──
    if (opIndex >= 0) {
      if (opIndex !== 1 || tokens.length < 3) {
        error(lineNo, `Link must be "<name> - <name> [key=value...]".`);
        continue;
      }
      const op = tokens[opIndex]!;
      const sourceName = tokens[0]!;
      const targetName = tokens[2]!;
      if (RESERVED.has(sourceName.toLowerCase()) || RESERVED.has(targetName.toLowerCase())) {
        error(lineNo, `Cannot link a reserved keyword (subnet/vlan).`);
        continue;
      }
      ensureDevice(sourceName, lineNo);
      ensureDevice(targetName, lineNo);
      const props: Partial<Link> = {};
      const extra: Record<string, unknown> = {};
      const { attrs, bad } = parseAttrs(tokens.slice(3));
      for (const b of bad) warn(lineNo, `Ignored "${b}" — expected key=value.`);
      applyLinkAttrs(attrs, props, extra);
      if (Object.keys(extra).length) props.extra = extra;
      if (op === '->') props.arrow = 'end';
      else if (op === '<->') props.arrow = 'both';
      links.push({ source: sourceName, target: targetName, props });
      continue;
    }

    const head = tokens[0]!.toLowerCase();

    // ── Subnet statement ──
    if (head === 'subnet') {
      const cidr = tokens[1];
      if (!cidr) {
        error(lineNo, `subnet needs a CIDR, e.g. "subnet 10.0.0.0/24".`);
        continue;
      }
      if (!isValidCidr(cidr)) warn(lineNo, `"${cidr}" is not a valid CIDR.`);
      const props: Partial<Subnet> = {};
      const { attrs, bad } = parseAttrs(tokens.slice(2));
      for (const b of bad) warn(lineNo, `Ignored "${b}" — expected key=value.`);
      for (const [k, v] of attrs) {
        if (k === 'name') props.name = v;
        else if (k === 'gateway' || k === 'gw') props.gateway = v;
        else if (k === 'zone') props.zone = v;
        else if (k === 'vlan') {
          const id = Number(v);
          if (Number.isInteger(id)) props.vlanId = id;
          else warn(lineNo, `vlan="${v}" is not a number.`);
        } else warn(lineNo, `Unknown subnet field "${k}".`);
      }
      subnets.push({ cidr, props });
      continue;
    }

    // ── VLAN statement ──
    if (head === 'vlan') {
      const idTok = tokens[1];
      const id = Number(idTok);
      if (!idTok || !Number.isInteger(id)) {
        error(lineNo, `vlan needs a numeric ID, e.g. "vlan 10 name=Users".`);
        continue;
      }
      if (id < 1 || id > 4094) warn(lineNo, `VLAN ${id} is outside the valid range 1–4094.`);
      const props: Partial<Vlan> = {};
      const { attrs, bad } = parseAttrs(tokens.slice(2));
      for (const b of bad) warn(lineNo, `Ignored "${b}" — expected key=value.`);
      for (const [k, v] of attrs) {
        if (k === 'name') props.name = v;
        else if (k === 'color') props.color = v;
        else if (k === 'zone') props.zone = v;
        else warn(lineNo, `Unknown vlan field "${k}".`);
      }
      vlans.push({ vlanId: id, props });
      continue;
    }

    // ── Device statement ──
    const type = TYPE_ALIASES[head];
    if (!type) {
      error(lineNo, `Unknown device type "${tokens[0]}". Try router, switch, server, …`);
      continue;
    }
    const name = tokens[1];
    if (!name) {
      error(lineNo, `Device needs a name, e.g. "${head} R1".`);
      continue;
    }
    const props: Partial<Device> = {};
    const extra: Record<string, unknown> = {};
    const { attrs, bad } = parseAttrs(tokens.slice(2));
    for (const b of bad) warn(lineNo, `Ignored "${b}" — expected key=value.`);
    applyDeviceAttrs(attrs, props, extra);
    if (Object.keys(extra).length) props.extra = extra;

    const existing = byName.get(name);
    if (existing) {
      if (!existing.auto) {
        warn(lineNo, `"${name}" was already declared — merging attributes.`);
      }
      existing.type = type;
      existing.auto = false;
      Object.assign(existing.props, props);
    } else {
      const d: NexDevice = { name, type, props, auto: false };
      byName.set(name, d);
      devices.push(d);
    }
  }

  return { devices, links, subnets, vlans, diagnostics };
}

// ── Builder ───────────────────────────────────────────────────────────────────

/** Convert a parse result into laid-out model objects. Pure given an id generator. */
export function buildModel(result: ParseResult, opts: BuildOptions): BuiltModel {
  const idGen = opts.idGen ?? nanoid;
  const nameToId = new Map<string, string>();

  const devices: Device[] = result.devices.map((d) => {
    const id = idGen();
    nameToId.set(d.name, id);
    return createDevice(d.type, 0, 0, opts.layerId, {
      ...d.props,
      id,
      name: d.props.name ?? d.name,
    });
  });

  const links: Link[] = [];
  for (const l of result.links) {
    const sourceId = nameToId.get(l.source);
    const targetId = nameToId.get(l.target);
    if (!sourceId || !targetId) continue; // unreachable: parser auto-creates referenced nodes
    links.push(createLink(sourceId, targetId, opts.layerId, { ...l.props, id: idGen() }));
  }

  // Bake auto-layout positions so devices land tidy on first paint.
  const pos = autoLayoutPositions(
    devices.map((d) => ({ id: d.id, width: d.width, height: d.height })),
    links.map((l) => ({ sourceId: l.sourceId, targetId: l.targetId })),
  );
  for (const d of devices) {
    const p = pos.get(d.id);
    if (p) {
      d.x = p.x;
      d.y = p.y;
    }
  }

  const subnets: Subnet[] = result.subnets.map((s) =>
    createSubnet(s.cidr, { ...s.props, id: idGen() }),
  );
  const vlans: Vlan[] = result.vlans.map((v) =>
    createVlan(v.vlanId, v.props.name ?? `VLAN ${v.vlanId}`, { ...v.props, id: idGen() }),
  );

  return { devices, links, subnets, vlans };
}

// ── Serializer ─────────────────────────────────────────────────────────────────

function attr(key: string, value: string | undefined): string {
  if (value == null || value === '') return '';
  const v = /\s/.test(value) ? `"${value}"` : value;
  return ` ${key}=${v}`;
}

/**
 * Render the current model back to NexText. Round-trips with parseNexText at the
 * semantic level (types, names, links, known fields) — IDs and layout are not encoded.
 */
export function serializeNexText(model: {
  devices: Device[];
  links: Link[];
  subnets?: Subnet[];
  vlans?: Vlan[];
}): string {
  const out: string[] = [];
  const idToName = new Map<string, string>();
  for (const d of model.devices) idToName.set(d.id, d.name);

  if (model.devices.length) {
    out.push('# Devices');
    for (const d of model.devices) {
      let line = `${SERIALIZE_TOKEN[d.type]} ${maybeQuote(d.name)}`;
      line += attr('vendor', d.vendor) + attr('model', d.model) + attr('role', d.role);
      line += attr('ip', d.managementIp) + attr('location', d.location) + attr('notes', d.notes);
      out.push(line);
    }
  }

  if (model.links.length) {
    out.push('', '# Links');
    for (const l of model.links) {
      const s = idToName.get(l.sourceId);
      const t = idToName.get(l.targetId);
      if (!s || !t) continue;
      const op = l.arrow === 'end' ? '->' : l.arrow === 'both' ? '<->' : '-';
      let line = `${maybeQuote(s)} ${op} ${maybeQuote(t)}`;
      line += attr('vlan', l.vlan) + attr('bandwidth', l.bandwidth);
      line += l.mode ? attr('mode', l.mode) : '';
      line += attr('type', l.linkType) + attr('native', l.nativeVlan) + attr('lacp', l.lacp) + attr('circuit', l.circuitId);
      out.push(line);
    }
  }

  const subnets = model.subnets ?? [];
  if (subnets.length) {
    out.push('', '# Subnets');
    for (const s of subnets) {
      out.push(
        `subnet ${s.cidr}` +
          attr('name', s.name) +
          attr('gateway', s.gateway) +
          (s.vlanId != null ? ` vlan=${s.vlanId}` : '') +
          attr('zone', s.zone),
      );
    }
  }

  const vlans = model.vlans ?? [];
  if (vlans.length) {
    out.push('', '# VLANs');
    for (const v of vlans) out.push(`vlan ${v.vlanId}` + attr('name', v.name) + attr('zone', v.zone));
  }

  return out.join('\n');
}

function maybeQuote(name: string): string {
  return /\s/.test(name) ? `"${name}"` : name;
}

/** Convenience re-export so callers don't import the constant separately. */
export const DEVICE_SIZE = DEFAULT_DEVICE_SIZE;
