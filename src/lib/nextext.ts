/**
 * NexText — a tiny, forgiving text-to-diagram language. Type a network as text,
 * get a laid-out, validated diagram. This is Stage 1's moat piece: the fastest way
 * to scaffold a topology, and it stays 100% local (pure functions, no network).
 *
 * Statements (line-oriented, order-independent):
 *   <type> <handle> [key=value ...]    device     e.g.  router R1 vendor=Cisco
 *   <handle> - <handle> [key=value ...] link       e.g.  R1 - SW1 vlan=10
 *   <handle> -> <handle>               directed link (arrow at target)
 *   subnet <cidr> [key=value ...]      subnet      e.g.  subnet 10.0.0.0/24 gw=10.0.0.1
 *   vlan <id> [key=value ...]          vlan        e.g.  vlan 10 name=Users
 *
 * Lexical contract — ONE grammar, shared by the serializer (`quoteNexText`) and the
 * parser (`scanLine`), so every string the app can hold survives a round trip (#88):
 *   token   := bare | quoted | key '=' (bare | quoted)
 *   quoted  := '"' ( [^"\\\n] | '\\' ["\\ntr] )* '"'
 *   bare    := one or more chars, none of: whitespace, ", \
 *   comment := '#' at line start or after whitespace, outside quotes
 * Single quotes are ordinary characters (O'Brien). An unknown escape, an unterminated
 * string or a stray quote/backslash is an ERROR with line and column — never a silent
 * rewrite. A quoted token is always a literal: never an operator or a keyword.
 *
 * Identity — a device's first word is its HANDLE: what links refer to and what an
 * Apply matches against the existing diagram. It is the device's name when that name
 * is unique; same-named devices get `name~2`, `name~3` … plus an explicit
 * `name="…"` for the display name (`nexTextHandles`). Declaring a handle twice is an
 * error, not a merge.
 *
 * A handle used in a link but never declared is auto-created as a generic node (with a
 * warning). The parser is TOTAL — bad input produces diagnostics, never an exception
 * (this is the connectorLabelLines lesson: malformed input must not crash a render).
 *
 * This module is pure and canvas-free. `planNexText` reconciles a parse result with
 * the current model (#85): it patches only what the text can express and leaves ids,
 * positions, rack placement, interfaces and everything else alone. The store action
 * `applyNexText` commits that plan as one undoable step.
 */
import { nanoid } from 'nanoid';
import { createDevice, createLink, createSubnet, createVlan, DEFAULT_DEVICE_SIZE } from '@/model/schema';
import type { Device, DeviceType, Link, Rack, RackCable, Subnet, Vlan } from '@/model/types';
import { isValidCidr } from './ipcidr';
import { autoLayoutPositions } from './layout';

// ── Public types ────────────────────────────────────────────────────────────

export interface Diagnostic {
  line: number; // 1-based source line; 0 = whole-document
  /** 1-based column in that line, when the problem has a precise position. */
  col?: number;
  severity: 'error' | 'warn';
  message: string;
}

export interface NexDevice {
  /** The handle: the identity links refer to. The display name is `props.name ?? name`. */
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
  storage: 'storage', san: 'storage',
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
  laptop: 'laptop', notebook: 'laptop',
  phone: 'ip-phone', 'ip-phone': 'ip-phone', voip: 'ip-phone',
  mobile: 'mobile', smartphone: 'mobile', tablet: 'mobile',
  modem: 'modem', ont: 'modem', cpe: 'modem',
  nas: 'nas',
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
  laptop: 'laptop', 'ip-phone': 'phone', mobile: 'mobile', modem: 'modem', nas: 'nas',
  vpc: 'vpc', 'cloud-subnet': 'cloud-subnet', 'internet-gateway': 'igw', 'nat-gateway': 'nat',
  'route-table': 'route-table', 'security-group': 'sg', 'vpn-gateway': 'vpn', k8s: 'k8s',
  'managed-db': 'db', 'object-storage': 's3', generic: 'node',
};

const LINK_OPS = new Set(['-', '--', '->', '<->', '<-']);
const RESERVED = new Set(['subnet', 'vlan']);

// ── Lexer: the one string-literal contract ───────────────────────────────────

export interface NexToken {
  /** The token's value with quotes removed and escapes resolved. */
  text: string;
  /** True when the WHOLE token was a quoted literal — never an operator or keyword. */
  quoted: boolean;
  /** 1-based column of the token's first character. */
  col: number;
  /** Set when the token is `key=value`, split on its first unquoted `=`. */
  key?: string;
  value?: string;
}

export interface ScanResult {
  tokens: NexToken[];
  /** Set when the line is lexically malformed; `tokens` then holds what preceded it. */
  error?: { col: number; message: string };
}

const ESCAPE_TO_CHAR: Record<string, string> = { '"': '"', '\\': '\\', n: '\n', t: '\t', r: '\r' };
const CHAR_TO_ESCAPE: Record<string, string> = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\t': '\\t', '\r': '\\r' };
const isSpace = (c: string) => /\s/.test(c);

/**
 * Scan one source line into tokens (see the grammar in the file header). This is the
 * ONLY reader of NexText syntax: comments, quoting and `key=value` splitting all
 * happen here, so they cannot disagree with each other or with `quoteNexText`.
 */
export function scanLine(line: string): ScanResult {
  const tokens: NexToken[] = [];
  const n = line.length;
  let i = 0;
  let error: ScanResult['error'];

  /** Read a quoted literal from its opening quote; leaves `i` just past the closing one. */
  const readQuoted = (): string | null => {
    const open = i;
    i++;
    let out = '';
    while (i < n) {
      const c = line[i]!;
      if (c === '"') {
        i++;
        return out;
      }
      if (c === '\\') {
        const e = line[i + 1];
        if (e === undefined) break; // a trailing backslash: the string never closes
        const ch = ESCAPE_TO_CHAR[e];
        if (ch === undefined) {
          error = { col: i + 1, message: `Unknown escape "\\${e}" — use \\" \\\\ \\n \\t or \\r.` };
          return null;
        }
        out += ch;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    error = { col: open + 1, message: 'Unterminated string — add a closing ".' };
    return null;
  };

  /** After a closing quote the token must end. */
  const endsCleanly = (): boolean => {
    if (i >= n || isSpace(line[i]!)) return true;
    error = { col: i + 1, message: 'Unexpected text right after a closing quote — add a space.' };
    return false;
  };

  while (i < n) {
    while (i < n && isSpace(line[i]!)) i++;
    if (i >= n) break;
    if (line[i] === '#') break; // comment: `#` at line start or after whitespace
    const col = i + 1;

    if (line[i] === '"') {
      const text = readQuoted();
      if (text === null || !endsCleanly()) return { tokens, error };
      tokens.push({ text, quoted: true, col });
      continue;
    }

    let bare = '';
    while (i < n && !isSpace(line[i]!) && line[i] !== '"' && line[i] !== '\\') bare += line[i++];
    if (i < n && line[i] === '\\') {
      return { tokens, error: { col: i + 1, message: 'A backslash is only allowed inside a quoted string.' } };
    }
    const eq = bare.indexOf('=');
    if (i < n && line[i] === '"') {
      // A quote may only open the whole token, or the value right after `key=`.
      if (eq <= 0 || eq !== bare.length - 1) {
        return {
          tokens,
          error: { col: i + 1, message: 'Unexpected quote — quote the whole value: "a b" or key="a b".' },
        };
      }
      const value = readQuoted();
      if (value === null || !endsCleanly()) return { tokens, error };
      tokens.push({ text: bare + value, quoted: false, col, key: bare.slice(0, eq), value });
      continue;
    }
    if (eq > 0) tokens.push({ text: bare, quoted: false, col, key: bare.slice(0, eq), value: bare.slice(eq + 1) });
    else tokens.push({ text: bare, quoted: false, col });
  }
  return { tokens };
}

/**
 * Write `s` as one NexText token that `scanLine` reads back as exactly `s`. Bare when
 * that is unambiguous; quoted (with `\" \\ \n \t \r` escapes) when it is empty, holds
 * whitespace, a quote, `#` or a backslash, or would read as a link operator or a
 * statement keyword. Used for handles, link endpoints, attribute values and CIDRs.
 */
export function quoteNexText(value: string): string {
  // Loaded files can hold non-strings where a string belongs (vlan: 10); never throw.
  const s = String(value ?? '');
  if (s !== '' && !/[\s"#\\]/.test(s) && !LINK_OPS.has(s) && !RESERVED.has(s.toLowerCase())) return s;
  return `"${s.replace(/["\\\n\t\r]/g, (c) => CHAR_TO_ESCAPE[c]!)}"`;
}

const DEVICE_ATTR_KEYS = new Set(['vendor', 'model', 'role', 'ip', 'mgmt', 'managementip', 'location', 'loc', 'notes', 'name', 'fill']);
const LINK_ATTR_KEYS = new Set(['vlan', 'bandwidth', 'bw', 'mode', 'type', 'native', 'lacp', 'circuit', 'name']);
const SUBNET_ATTR_KEYS = new Set(['name', 'gateway', 'gw', 'zone', 'vlan']);
const VLAN_ATTR_KEYS = new Set(['name', 'color', 'zone']);

/**
 * Collect `key=value` tokens; returns the map plus any tokens that were not one.
 * A token quoted as a whole — `"vendor=Cisco Systems"` — is still an attribute when
 * its key is one this statement knows (the long-standing spelling); any other quoted
 * token is a literal, so it is reported rather than guessed at.
 */
function parseAttrs(tokens: NexToken[], known: ReadonlySet<string>): { attrs: Map<string, string>; bad: NexToken[] } {
  const attrs = new Map<string, string>();
  const bad: NexToken[] = [];
  for (const t of tokens) {
    if (t.quoted) {
      const eq = t.text.indexOf('=');
      const key = eq > 0 ? t.text.slice(0, eq).toLowerCase() : '';
      if (known.has(key)) attrs.set(key, t.text.slice(eq + 1));
      else bad.push(t);
    } else if (t.key === undefined) bad.push(t);
    else attrs.set(t.key.toLowerCase(), t.value ?? '');
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
  /** Source line of each explicit declaration, for the duplicate-handle error. */
  const declaredAt = new Map<string, number>();

  const warn = (line: number, message: string, col?: number) =>
    diagnostics.push({ line, ...(col != null ? { col } : {}), severity: 'warn', message });
  const error = (line: number, message: string, col?: number) =>
    diagnostics.push({ line, ...(col != null ? { col } : {}), severity: 'error', message });

  /** Ensure a device exists for `name`; auto-create a generic node if missing. */
  const ensureDevice = (name: string, line: number, col: number): NexDevice => {
    const existing = byName.get(name);
    if (existing) return existing;
    const d: NexDevice = { name, type: 'generic', props: {}, auto: true };
    byName.set(name, d);
    devices.push(d);
    warn(line, `"${name}" was used in a link but never declared — added as a generic node.`, col);
    return d;
  };

  const rawLines = src.split(/\r?\n/);
  for (let li = 0; li < rawLines.length; li++) {
    const lineNo = li + 1;
    const scan = scanLine(rawLines[li]!);
    if (scan.error) {
      error(lineNo, scan.error.message, scan.error.col);
      continue;
    }
    const tokens = scan.tokens;
    if (tokens.length === 0) continue;
    const badAttrs = (bad: NexToken[]) => {
      for (const b of bad) warn(lineNo, `Ignored "${b.text}" — expected key=value.`, b.col);
    };

    // A quoted token is a literal, never an operator.
    const opIndex = tokens.findIndex((t) => !t.quoted && LINK_OPS.has(t.text));

    // ── Link statement ──
    if (opIndex >= 0) {
      if (opIndex !== 1 || tokens.length < 3) {
        error(lineNo, `Link must be "<name> - <name> [key=value...]".`, tokens[opIndex]!.col);
        continue;
      }
      const op = tokens[opIndex]!.text;
      const sourceTok = tokens[0]!;
      const targetTok = tokens[2]!;
      const reserved = [sourceTok, targetTok].find((t) => !t.quoted && RESERVED.has(t.text.toLowerCase()));
      if (reserved) {
        error(lineNo, `Cannot link a reserved keyword (subnet/vlan) — quote it to use it as a name.`, reserved.col);
        continue;
      }
      ensureDevice(sourceTok.text, lineNo, sourceTok.col);
      ensureDevice(targetTok.text, lineNo, targetTok.col);
      const props: Partial<Link> = {};
      const extra: Record<string, unknown> = {};
      const { attrs, bad } = parseAttrs(tokens.slice(3), LINK_ATTR_KEYS);
      badAttrs(bad);
      applyLinkAttrs(attrs, props, extra);
      if (Object.keys(extra).length) props.extra = extra;
      if (op === '->') props.arrow = 'end';
      else if (op === '<->') props.arrow = 'both';
      links.push({ source: sourceTok.text, target: targetTok.text, props });
      continue;
    }

    const headTok = tokens[0]!;
    // A quoted head is a literal, so it is never a statement or type keyword.
    const head = headTok.quoted ? '' : headTok.text.toLowerCase();

    // ── Subnet statement ──
    if (head === 'subnet') {
      const cidrTok = tokens[1];
      if (!cidrTok) {
        error(lineNo, `subnet needs a CIDR, e.g. "subnet 10.0.0.0/24".`, headTok.col);
        continue;
      }
      const cidr = cidrTok.text;
      if (!isValidCidr(cidr)) warn(lineNo, `"${cidr}" is not a valid CIDR.`, cidrTok.col);
      const props: Partial<Subnet> = {};
      const { attrs, bad } = parseAttrs(tokens.slice(2), SUBNET_ATTR_KEYS);
      badAttrs(bad);
      for (const [k, v] of attrs) {
        if (k === 'name') props.name = v;
        else if (k === 'gateway' || k === 'gw') props.gateway = v;
        else if (k === 'zone') props.zone = v;
        else if (k === 'vlan') {
          const id = Number(v);
          if (v.trim() !== '' && Number.isInteger(id)) props.vlanId = id;
          else warn(lineNo, `vlan="${v}" is not a number.`);
        } else warn(lineNo, `Unknown subnet field "${k}".`);
      }
      subnets.push({ cidr, props });
      continue;
    }

    // ── VLAN statement ──
    if (head === 'vlan') {
      const idTok = tokens[1];
      const id = Number(idTok?.text);
      if (!idTok || idTok.text.trim() === '' || !Number.isInteger(id)) {
        error(lineNo, `vlan needs a numeric ID, e.g. "vlan 10 name=Users".`, (idTok ?? headTok).col);
        continue;
      }
      if (id < 1 || id > 4094) warn(lineNo, `VLAN ${id} is outside the valid range 1–4094.`, idTok.col);
      const props: Partial<Vlan> = {};
      const { attrs, bad } = parseAttrs(tokens.slice(2), VLAN_ATTR_KEYS);
      badAttrs(bad);
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
    const type = head ? TYPE_ALIASES[head] : undefined;
    if (!type || !Object.prototype.hasOwnProperty.call(TYPE_ALIASES, head)) {
      error(lineNo, `Unknown device type "${headTok.text}". Try router, switch, server, …`, headTok.col);
      continue;
    }
    const nameTok = tokens[1];
    if (!nameTok) {
      error(lineNo, `Device needs a name, e.g. "${head} R1".`, headTok.col);
      continue;
    }
    const name = nameTok.text;
    const props: Partial<Device> = {};
    const extra: Record<string, unknown> = {};
    const { attrs, bad } = parseAttrs(tokens.slice(2), DEVICE_ATTR_KEYS);
    badAttrs(bad);
    applyDeviceAttrs(attrs, props, extra);
    if (Object.keys(extra).length) props.extra = extra;

    const existing = byName.get(name);
    if (existing && !existing.auto) {
      // Two declarations sharing a handle used to merge silently, collapsing distinct
      // same-named devices into one (#85). Identity must be unambiguous.
      error(
        lineNo,
        `"${name}" is already declared on line ${declaredAt.get(name)}. Each device needs its own first word — ` +
          `e.g. ${quoteNexText(`${name}~2`)} name=${quoteNexText(name)} keeps the same display name.`,
        nameTok.col,
      );
      continue;
    }
    declaredAt.set(name, lineNo);
    if (existing) {
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

// ── What the text can carry ────────────────────────────────────────────────────
//
// One rule, shared by the serializer and the planner: anything the serializer cannot
// write faithfully is INVISIBLE to the planner. An entity it cannot write is never
// matched or removed; a field value it cannot write is never patched or cleared unless
// the text sets that field explicitly. Otherwise an unedited Apply would "fix" or
// delete data merely for being unusual.

/** A field as the text sees it: absent and empty are the same, everything else a string. */
const text = (v: unknown): string => (v == null ? '' : String(v));

/** A VLAN statement needs an integer id; `vlan 10.5` or `vlan NaN` would not parse. */
const canWriteVlan = (v: Pick<Vlan, 'vlanId'>) => Number.isInteger(v.vlanId);
/** The link operator spells only these; anything else (a hand-edited 'start') is opaque. */
const canWriteArrow = (l: Pick<Link, 'arrow'>) =>
  l.arrow == null || l.arrow === 'none' || l.arrow === 'end' || l.arrow === 'both';
/** `mode=` reads back as trunk or access only. */
const canWriteMode = (l: Pick<Link, 'mode'>) => l.mode == null || l.mode === 'trunk' || l.mode === 'access';
const canWriteSubnetVlan = (s: Pick<Subnet, 'vlanId'>) => s.vlanId == null || Number.isInteger(s.vlanId);

// ── Identity ──────────────────────────────────────────────────────────────────

/**
 * The stable text identity of every device: `Map<device id, handle>`. A device's handle
 * is its name when no earlier device took it; later same-named devices get `name~2`,
 * `name~3` … (skipping anything that is itself a real device name), so handles are
 * always unique. The serializer writes them and the planner matches on them — both
 * MUST use this one function, over the devices in the same order.
 */
export function nexTextHandles(devices: readonly Pick<Device, 'id' | 'name'>[]): Map<string, string> {
  const realNames = new Set(devices.map((d) => text(d.name)));
  const used = new Set<string>();
  const handles = new Map<string, string>();
  for (const d of devices) {
    const name = text(d.name);
    let handle = name;
    if (used.has(handle)) {
      let n = 2;
      while (used.has(`${name}~${n}`) || realNames.has(`${name}~${n}`)) n++;
      handle = `${name}~${n}`;
    }
    used.add(handle);
    handles.set(d.id, handle);
  }
  return handles;
}

// ── Planner (reconcile text with the existing model) ────────────────────────────

/** What the planner needs to know about the current diagram. */
export interface NexTextModel {
  devices: readonly Device[];
  links: readonly Link[];
  subnets?: readonly Subnet[];
  vlans?: readonly Vlan[];
  /** Only read to describe what a removed device takes with it. */
  racks?: readonly Pick<Rack, 'id' | 'name'>[];
  rackCables?: readonly RackCable[];
  /**
   * Devices and links a delete may not remove (locked, or on a locked layer — the
   * store's `deletable()` guard). Their lines can be edited, but deleting the line
   * keeps them, and the plan says so in `kept`.
   */
  protectedDeviceIds?: ReadonlySet<string>;
  protectedLinkIds?: ReadonlySet<string>;
}

export interface NexTextUpdate<T> {
  id: string;
  /** The patched keys' current values (for undo) … */
  before: Partial<T>;
  /** … and their new ones. Only keys that actually change appear. */
  after: Partial<T>;
}

/** What goes with one removed device — data the text cannot express or bring back. */
export interface NexTextDeviceLoss {
  id: string;
  name: string;
  handle: string;
  interfaces: number;
  /** Set when the device is mounted in a rack. */
  rack?: { name?: string; ru?: number };
  /** Physical rack cables plugged into it. */
  cables: number;
  /** Logical links attached to it. */
  links: number;
}

export interface NexTextPlan {
  deviceUpdates: NexTextUpdate<Device>[];
  addDevices: Device[];
  removeDeviceIds: string[];
  linkUpdates: NexTextUpdate<Link>[];
  addLinks: Link[];
  /** Links removed on their own; links of removed devices cascade and are not listed. */
  removeLinkIds: string[];
  subnetUpdates: NexTextUpdate<Subnet>[];
  addSubnets: Subnet[];
  removeSubnetIds: string[];
  vlanUpdates: NexTextUpdate<Vlan>[];
  addVlans: Vlan[];
  removeVlanIds: string[];
  /** Everything an Apply would destroy. Counts are distinct totals across the plan. */
  losses: {
    devices: NexTextDeviceLoss[];
    interfaces: number;
    rackMounts: number;
    cables: number;
    /** Every link that goes: listed in removeLinkIds or cascaded from a removed device. */
    links: number;
    subnets: string[];
    vlans: number[];
  };
  /**
   * What the text dropped but a lock protects: it stays, exactly as it is. A kept
   * device keeps its links too. Not a change, so it does not make a plan non-empty.
   */
  kept: { devices: { id: string; name: string; handle: string }[]; links: number };
  /** True when the text already matches the diagram: applying would change nothing. */
  isEmpty: boolean;
}

// The keys the serializer writes — and therefore the ONLY keys whose absence from the
// text means "clear it". Anything else on an entity is invisible to NexText and is
// never touched unless the text sets it explicitly.
const DEVICE_TEXT_KEYS = ['vendor', 'model', 'role', 'managementIp', 'location', 'notes'] as const;
const LINK_TEXT_KEYS = ['vlan', 'bandwidth', 'mode', 'linkType', 'nativeVlan', 'lacp', 'circuitId'] as const;
const SUBNET_TEXT_KEYS = ['name', 'gateway', 'vlanId', 'zone'] as const;
const VLAN_TEXT_KEYS = ['zone'] as const;

/** Space between the existing diagram and newly added devices, and the layout grid. */
const NEW_DEVICE_GAP = 96;
const GRID = 16;

/**
 * Diff the serializer-written keys. Empty and absent are the same thing (the
 * serializer omits empty values), so `vendor: ''` vs no vendor is not a change.
 */
function diffTextKeys<T extends object>(
  cur: T,
  props: Partial<T>,
  keys: readonly (keyof T)[],
  before: Partial<T>,
  after: Partial<T>,
  /** Keys whose current value the serializer could not write: untouched unless set. */
  opaque: readonly (keyof T)[] = [],
): void {
  for (const k of keys) {
    if (props[k] === undefined && opaque.includes(k)) continue;
    // Compared as text: a loaded `vlan: 10` and the `vlan=10` it was written as agree.
    const a = text(cur[k]);
    const b = text(props[k]);
    if (a === b) continue;
    before[k] = cur[k];
    after[k] = (b === '' ? undefined : props[k]) as T[keyof T];
  }
}

type Diff<T> = { before: Partial<T>; after: Partial<T> };

/**
 * Pair text statements with the existing entities that share their key (an endpoint
 * pair, a CIDR, a VLAN id). Duplicates are legal, so position alone is not identity:
 * a statement first claims an entity it already describes EXACTLY (in order), and only
 * the statements left over — the edited ones — fall back to the k-th entity left over.
 * Deleting the first of two parallel links therefore removes the first, instead of
 * rewriting it into the second and removing that.
 */
function matchPool<S, E>(
  statements: readonly S[],
  pool: Map<string, E[]>,
  keyOf: (s: S) => string,
  diff: (cur: E, s: S) => Diff<E>,
  matches: Map<S, E>,
  eligible: (s: S) => boolean = () => true,
): void {
  const open = statements.filter((st) => !matches.has(st) && eligible(st));
  for (const st of open) {
    const q = pool.get(keyOf(st));
    const i = q ? q.findIndex((e) => !hasKeys(diff(e, st).after)) : -1;
    if (i >= 0) matches.set(st, q!.splice(i, 1)[0]!);
  }
  for (const st of open) {
    if (matches.has(st)) continue;
    const e = pool.get(keyOf(st))?.shift();
    if (e !== undefined) matches.set(st, e);
  }
}

function pooled<E>(items: readonly E[], keyOf: (e: E) => string): Map<string, E[]> {
  const pool = new Map<string, E[]>();
  for (const e of items) {
    const k = keyOf(e);
    const q = pool.get(k);
    if (q) q.push(e);
    else pool.set(k, [e]);
  }
  return pool;
}

/** A key the serializer never writes: set it only when the text names it. */
function diffExplicit<T extends object, K extends keyof T>(
  cur: T,
  props: Partial<T>,
  key: K,
  before: Partial<T>,
  after: Partial<T>,
): void {
  const v = props[key];
  if (v === undefined || v === cur[key]) return;
  before[key] = cur[key];
  after[key] = v;
}

/** Unknown `key=value` pairs land in `extra`: merge them in, never replace the bag. */
function diffExtra<T extends { extra?: Record<string, unknown> }>(
  cur: T,
  props: Partial<T>,
  before: Partial<T>,
  after: Partial<T>,
): void {
  const add = props.extra;
  if (!add) return;
  const curExtra = cur.extra;
  if (!Object.keys(add).some((k) => curExtra?.[k] !== add[k])) return;
  before.extra = curExtra;
  after.extra = { ...curExtra, ...add };
}

const hasKeys = (o: object) => Object.keys(o).length > 0;

/** Racked gear is parked far off-canvas; it is not part of the diagram's footprint. */
const isOnCanvas = (d: Device) => !(d.rackId != null && d.x <= -9000 && d.y <= -9000);

/**
 * Reconcile a parse result with the current model — the lossless "sync" behind Apply
 * (#85). Pure: returns what to patch, add and remove, and mutates nothing.
 *
 *  - Devices match by HANDLE (`handles`, from `nexTextHandles`), so same-named devices
 *    stay distinct and a matched device keeps its id, position, rack slot, interfaces …
 *  - Links: the k-th text link for an ordered (source, target) pair is the k-th
 *    existing link for that pair. A text link with no arrow direction (`-`, `<->`) left
 *    over after that also matches an existing link the other way round — `B - A` is
 *    the same cable as `A - B`.
 *  - Subnets match by CIDR and VLANs by id (k-th occurrence of each).
 *  - Only keys the serializer writes are patched; see the *_TEXT_KEYS lists.
 *  - Existing entities the serializer cannot write (a link with a missing endpoint, a
 *    device without a handle) are never removed. Canvas objects, racks and layers are
 *    not in the plan at all.
 *
 * Against an empty model this is plain generation: everything is an addition.
 */
export function planNexText(
  result: ParseResult,
  current: NexTextModel,
  handles: ReadonlyMap<string, string> = nexTextHandles(current.devices),
  opts: BuildOptions = { layerId: current.devices[0]?.layerId ?? '' },
): NexTextPlan {
  const idGen = opts.idGen ?? nanoid;

  // ── Devices ──
  const byHandle = new Map<string, Device>();
  for (const d of current.devices) {
    const h = handles.get(d.id);
    if (h !== undefined && !byHandle.has(h)) byHandle.set(h, d);
  }
  const handleToId = new Map<string, string>();
  const matched = new Set<string>();
  const deviceUpdates: NexTextUpdate<Device>[] = [];
  const addDevices: Device[] = [];

  for (const nd of result.devices) {
    const cur = byHandle.get(nd.name);
    if (!cur) {
      const id = idGen();
      handleToId.set(nd.name, id);
      addDevices.push(createDevice(nd.type, 0, 0, opts.layerId, { ...nd.props, id, name: nd.props.name ?? nd.name }));
      continue;
    }
    matched.add(cur.id);
    handleToId.set(nd.name, cur.id);
    // Referenced by a link but not declared: the text says nothing about the device
    // itself, so leave it exactly as it is rather than resetting it to a generic node.
    if (nd.auto) continue;
    const before: Partial<Device> = {};
    const after: Partial<Device> = {};
    // A type this build cannot spell is written as `node`; reading that back is not an edit.
    const unspellable = SERIALIZE_TOKEN[cur.type] === undefined && nd.type === 'generic';
    if (cur.type !== nd.type && !unspellable) {
      before.type = cur.type;
      after.type = nd.type;
    }
    const name = nd.props.name ?? nd.name;
    if (name !== text(cur.name)) {
      before.name = cur.name;
      after.name = name;
    }
    diffTextKeys(cur, nd.props, DEVICE_TEXT_KEYS, before, after);
    diffExplicit(cur, nd.props, 'fill', before, after);
    diffExtra(cur, nd.props, before, after);
    if (hasKeys(after)) deviceUpdates.push({ id: cur.id, before, after });
  }

  // A device the serializer wrote and the text no longer has is removed — unless a
  // lock protects it, in which case it stays (with its links) and the plan says so.
  const dropped = current.devices.filter(
    (d) => handles.has(d.id) && byHandle.get(handles.get(d.id)!) === d && !matched.has(d.id),
  );
  const keptDevices = dropped.filter((d) => current.protectedDeviceIds?.has(d.id));
  const keptDeviceIds = new Set(keptDevices.map((d) => d.id));
  const removedDevices = dropped.filter((d) => !keptDeviceIds.has(d.id));
  const removedDeviceIds = new Set(removedDevices.map((d) => d.id));

  // ── Links ──
  // Only links the serializer writes take part; one with a missing endpoint is not in
  // the text, so its absence there means nothing.
  const written = (id: string) => {
    const h = handles.get(id);
    return h !== undefined && byHandle.get(h)?.id === id;
  };
  const pairKey = (s: string, t: string) => `${s}\u0000${t}`;
  type ParsedLink = { sourceId: string; targetId: string; props: Partial<Link> };
  const diffLink = (cur: Link, pl: ParsedLink): Diff<Link> => {
    const before: Partial<Link> = {};
    const after: Partial<Link> = {};
    // The operator: `-` reads back as no arrow, which is what both absent and 'none'
    // mean. An arrow the operator cannot spell was written as `-`; only an explicit
    // `->` / `<->` in the text replaces it.
    const curArrow = cur.arrow === 'none' ? undefined : cur.arrow;
    if (curArrow !== pl.props.arrow && (canWriteArrow(cur) || pl.props.arrow !== undefined)) {
      before.arrow = cur.arrow;
      after.arrow = pl.props.arrow;
    }
    diffTextKeys(cur, pl.props, LINK_TEXT_KEYS, before, after, canWriteMode(cur) ? [] : ['mode']);
    diffExplicit(cur, pl.props, 'name', before, after);
    diffExtra(cur, pl.props, before, after);
    return { before, after };
  };

  const linkPool = pooled(
    current.links.filter((l) => written(l.sourceId) && written(l.targetId)),
    (l) => pairKey(l.sourceId, l.targetId),
  );
  const parsedLinks: ParsedLink[] = result.links.flatMap((l) => {
    const sourceId = handleToId.get(l.source);
    const targetId = handleToId.get(l.target);
    // unreachable: the parser auto-creates every referenced handle
    return sourceId && targetId ? [{ sourceId, targetId, props: l.props }] : [];
  });
  const linkMatch = new Map<ParsedLink, Link>();
  // As written first; then, for a line with no arrow direction, the other way round.
  matchPool(parsedLinks, linkPool, (pl) => pairKey(pl.sourceId, pl.targetId), diffLink, linkMatch);
  matchPool(
    parsedLinks,
    linkPool,
    (pl) => pairKey(pl.targetId, pl.sourceId),
    diffLink,
    linkMatch,
    (pl) => pl.props.arrow !== 'end',
  );

  const linkUpdates: NexTextUpdate<Link>[] = [];
  const addLinks: Link[] = [];
  for (const pl of parsedLinks) {
    const cur = linkMatch.get(pl);
    if (!cur) {
      addLinks.push(createLink(pl.sourceId, pl.targetId, opts.layerId, { ...pl.props, id: idGen() }));
      continue;
    }
    const d = diffLink(cur, pl);
    if (hasKeys(d.after)) linkUpdates.push({ id: cur.id, ...d });
  }
  // Left in the pool: links the text dropped. Those of a removed device cascade with
  // it; those of a kept (locked) device, or on a locked layer, stay.
  const droppedLinks = [...linkPool.values()]
    .flat()
    .filter((l) => !removedDeviceIds.has(l.sourceId) && !removedDeviceIds.has(l.targetId));
  const linkIsKept = (l: Link) =>
    keptDeviceIds.has(l.sourceId) || keptDeviceIds.has(l.targetId) || !!current.protectedLinkIds?.has(l.id);
  const removeLinkIds = droppedLinks.filter((l) => !linkIsKept(l)).map((l) => l.id);
  const keptLinks = droppedLinks.filter(linkIsKept).length;
  const cascadedLinks = current.links.filter(
    (l) => removedDeviceIds.has(l.sourceId) || removedDeviceIds.has(l.targetId),
  );

  // ── New devices: laid out together, then set down beside the existing diagram ──
  const pos = autoLayoutPositions(
    addDevices.map((d) => ({ id: d.id, width: d.width, height: d.height })),
    addLinks.map((l) => ({ sourceId: l.sourceId, targetId: l.targetId })),
  );
  for (const d of addDevices) {
    const p = pos.get(d.id);
    if (p) {
      d.x = p.x;
      d.y = p.y;
    }
  }
  const anchors = current.devices.filter((d) => !removedDeviceIds.has(d.id) && isOnCanvas(d));
  if (anchors.length && addDevices.length) {
    const right = Math.max(...anchors.map((d) => d.x + d.width));
    const top = Math.min(...anchors.map((d) => d.y));
    const dx = Math.ceil((right + NEW_DEVICE_GAP - Math.min(...addDevices.map((d) => d.x))) / GRID) * GRID;
    const dy = Math.round((top - Math.min(...addDevices.map((d) => d.y))) / GRID) * GRID;
    for (const d of addDevices) {
      d.x += dx;
      d.y += dy;
    }
  }

  // ── Subnets (by CIDR) ──
  const diffSubnet = (cur: Subnet, ns: NexSubnet): Diff<Subnet> => {
    const before: Partial<Subnet> = {};
    const after: Partial<Subnet> = {};
    diffTextKeys(cur, ns.props, SUBNET_TEXT_KEYS, before, after, canWriteSubnetVlan(cur) ? [] : ['vlanId']);
    return { before, after };
  };
  const subnetPool = pooled(current.subnets ?? [], (s) => text(s.cidr));
  const subnetMatch = new Map<NexSubnet, Subnet>();
  matchPool(result.subnets, subnetPool, (ns) => ns.cidr, diffSubnet, subnetMatch);
  const subnetUpdates: NexTextUpdate<Subnet>[] = [];
  const addSubnets: Subnet[] = [];
  for (const ns of result.subnets) {
    const cur = subnetMatch.get(ns);
    if (!cur) {
      addSubnets.push(createSubnet(ns.cidr, { ...ns.props, id: idGen() }));
      continue;
    }
    const d = diffSubnet(cur, ns);
    if (hasKeys(d.after)) subnetUpdates.push({ id: cur.id, ...d });
  }
  const removedSubnets = [...subnetPool.values()].flat();

  // ── VLANs (by id). One the serializer cannot write is not in the pool at all. ──
  const diffVlan = (cur: Vlan, nv: NexVlan): Diff<Vlan> => {
    const before: Partial<Vlan> = {};
    const after: Partial<Vlan> = {};
    // `name` is required on a VLAN: an unnamed one in text gets the generated default.
    const curName = text(cur.name);
    const name = nv.props.name || (curName ? `VLAN ${nv.vlanId}` : curName);
    if (name !== curName) {
      before.name = cur.name;
      after.name = name;
    }
    diffTextKeys(cur, nv.props, VLAN_TEXT_KEYS, before, after);
    diffExplicit(cur, nv.props, 'color', before, after);
    return { before, after };
  };
  const vlanPool = pooled((current.vlans ?? []).filter(canWriteVlan), (v) => String(v.vlanId));
  const vlanMatch = new Map<NexVlan, Vlan>();
  matchPool(result.vlans, vlanPool, (nv) => String(nv.vlanId), diffVlan, vlanMatch);
  const vlanUpdates: NexTextUpdate<Vlan>[] = [];
  const addVlans: Vlan[] = [];
  for (const nv of result.vlans) {
    const cur = vlanMatch.get(nv);
    if (!cur) {
      addVlans.push(createVlan(nv.vlanId, nv.props.name ?? `VLAN ${nv.vlanId}`, { ...nv.props, id: idGen() }));
      continue;
    }
    const d = diffVlan(cur, nv);
    if (hasKeys(d.after)) vlanUpdates.push({ id: cur.id, ...d });
  }
  const removedVlans = [...vlanPool.values()].flat();

  // ── What a removal takes with it ──
  const rackNames = new Map((current.racks ?? []).map((r) => [r.id, r.name]));
  const cables = current.rackCables ?? [];
  const touches = (c: RackCable, id: string) => c.aEnd.deviceId === id || c.bEnd.deviceId === id;
  const deviceLosses: NexTextDeviceLoss[] = removedDevices.map((d) => ({
    id: d.id,
    name: text(d.name),
    handle: handles.get(d.id) ?? text(d.name),
    interfaces: d.interfaces?.length ?? 0,
    ...(d.rackId != null ? { rack: { name: rackNames.get(d.rackId), ru: d.ru } } : {}),
    cables: cables.filter((c) => touches(c, d.id)).length,
    links: current.links.filter((l) => l.sourceId === d.id || l.targetId === d.id).length,
  }));

  const plan: Omit<NexTextPlan, 'isEmpty'> = {
    deviceUpdates,
    addDevices,
    removeDeviceIds: removedDevices.map((d) => d.id),
    linkUpdates,
    addLinks,
    removeLinkIds,
    subnetUpdates,
    addSubnets,
    removeSubnetIds: removedSubnets.map((s) => s.id),
    vlanUpdates,
    addVlans,
    removeVlanIds: removedVlans.map((v) => v.id),
    losses: {
      devices: deviceLosses,
      interfaces: deviceLosses.reduce((n, l) => n + l.interfaces, 0),
      rackMounts: deviceLosses.filter((l) => l.rack).length,
      cables: cables.filter((c) => removedDeviceIds.has(c.aEnd.deviceId) || removedDeviceIds.has(c.bEnd.deviceId)).length,
      links: removeLinkIds.length + cascadedLinks.length,
      subnets: removedSubnets.map((s) => text(s.cidr)),
      vlans: removedVlans.map((v) => v.vlanId),
    },
    kept: {
      devices: keptDevices.map((d) => ({ id: d.id, name: text(d.name), handle: handles.get(d.id) ?? text(d.name) })),
      links: keptLinks,
    },
  };
  return { ...plan, isEmpty: nexTextPlanCounts(plan).total === 0 };
}

/** How many entities a plan updates, adds and removes (devices, links, subnets, VLANs). */
export function nexTextPlanCounts(plan: Omit<NexTextPlan, 'isEmpty'>): {
  updated: number;
  added: number;
  removed: number;
  total: number;
} {
  const updated =
    plan.deviceUpdates.length + plan.linkUpdates.length + plan.subnetUpdates.length + plan.vlanUpdates.length;
  const added = plan.addDevices.length + plan.addLinks.length + plan.addSubnets.length + plan.addVlans.length;
  const removed =
    plan.removeDeviceIds.length + plan.losses.links + plan.removeSubnetIds.length + plan.removeVlanIds.length;
  return { updated, added, removed, total: updated + added + removed };
}

/** One line for the dialog footer: "No changes" or "2 updated · 1 added · 1 removed". */
export function summarizeNexTextPlan(plan: NexTextPlan): string {
  if (plan.isEmpty) {
    const k = plan.kept.devices.length;
    return k ? `No changes — ${k} locked ${k === 1 ? 'device is' : 'devices are'} kept` : 'No changes';
  }
  const c = nexTextPlanCounts(plan);
  return [
    c.updated ? `${c.updated} updated` : '',
    c.added ? `${c.added} added` : '',
    c.removed ? `${c.removed} removed` : '',
    plan.kept.devices.length ? `${plan.kept.devices.length} locked, kept` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What an Apply would destroy, one precise line per thing — the text of the
 * confirmation. Empty when nothing is removed (then there is nothing to confirm).
 * e.g. "Removes SW3 — 24 interfaces, rack position U12, 1 cable".
 */
export function describeNexTextLosses(plan: NexTextPlan): string[] {
  const lines: string[] = [];
  for (const d of plan.losses.devices) {
    const parts: string[] = [];
    if (d.interfaces) parts.push(count(d.interfaces, 'interface'));
    if (d.rack) {
      const where = [d.rack.name, d.rack.ru != null ? `U${d.rack.ru}` : ''].filter(Boolean).join(' ');
      parts.push(where ? `rack position ${where}` : 'rack position');
    }
    if (d.cables) parts.push(count(d.cables, 'cable'));
    if (d.links) parts.push(count(d.links, 'link'));
    const label = d.name === '' ? '(unnamed device)' : d.name;
    const shown = d.handle !== d.name && d.name !== '' ? `${label} (${d.handle})` : label;
    lines.push(parts.length ? `Removes ${shown} — ${parts.join(', ')}` : `Removes ${shown}`);
  }
  if (plan.removeLinkIds.length) {
    lines.push(`Removes ${count(plan.removeLinkIds.length, 'link')} between devices that stay`);
  }
  for (const cidr of plan.losses.subnets) lines.push(`Removes subnet ${cidr}`);
  for (const id of plan.losses.vlans) lines.push(`Removes VLAN ${id}`);
  return lines;
}

/**
 * What the text dropped but a lock keeps, e.g. "A is locked and will be kept" — so the
 * preview and the confirmation never promise a removal that will not happen.
 */
export function describeNexTextKept(plan: NexTextPlan): string[] {
  const lines = plan.kept.devices.map((d) => {
    const label = d.name === '' ? '(unnamed device)' : d.name;
    return `${d.handle !== d.name && d.name !== '' ? `${label} (${d.handle})` : label} is locked and will be kept`;
  });
  // Links of a kept device stay with it; only a lock of their own needs saying.
  if (plan.kept.links && !plan.kept.devices.length) {
    lines.push(`${count(plan.kept.links, 'link')} on a locked layer will be kept`);
  }
  return lines;
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Convert a parse result into laid-out model objects. Pure given an id generator.
 * This is `planNexText` against an empty diagram, so generating into a blank project
 * and applying to one are the same code path.
 */
export function buildModel(result: ParseResult, opts: BuildOptions): BuiltModel {
  const plan = planNexText(result, { devices: [], links: [] }, new Map(), opts);
  return { devices: plan.addDevices, links: plan.addLinks, subnets: plan.addSubnets, vlans: plan.addVlans };
}

// ── Serializer ─────────────────────────────────────────────────────────────────

function attr(key: string, value: unknown): string {
  const v = text(value);
  return v === '' ? '' : ` ${key}=${quoteNexText(v)}`;
}

/**
 * Render the current model to NexText. `parseNexText` + `planNexText` of the result
 * against the same model is an empty plan — that round trip is what makes an unedited
 * Apply a no-op. Ids, layout, rack placement and interfaces are not encoded; they are
 * preserved by the planner matching on handles instead.
 */
export function serializeNexText(model: {
  devices: readonly Device[];
  links: readonly Link[];
  subnets?: readonly Subnet[];
  vlans?: readonly Vlan[];
}): string {
  const out: string[] = [];
  const handles = nexTextHandles(model.devices);

  if (model.devices.length) {
    out.push('# Devices');
    for (const d of model.devices) {
      const handle = handles.get(d.id)!;
      let line = `${SERIALIZE_TOKEN[d.type] ?? 'node'} ${quoteNexText(handle)}`;
      // Same-named devices: the handle disambiguates, name= carries the real name.
      if (handle !== text(d.name)) line += ` name=${quoteNexText(text(d.name))}`;
      line += attr('vendor', d.vendor) + attr('model', d.model) + attr('role', d.role);
      line += attr('ip', d.managementIp) + attr('location', d.location) + attr('notes', d.notes);
      out.push(line);
    }
  }

  // A link with a missing endpoint cannot be written; the planner knows to leave it be.
  const links = model.links.filter((l) => handles.has(l.sourceId) && handles.has(l.targetId));
  if (links.length) {
    out.push('', '# Links');
    for (const l of links) {
      // An arrow or mode the text cannot spell is left out; the planner then leaves it alone.
      const op = l.arrow === 'end' ? '->' : l.arrow === 'both' ? '<->' : '-';
      let line = `${quoteNexText(handles.get(l.sourceId)!)} ${op} ${quoteNexText(handles.get(l.targetId)!)}`;
      line += attr('vlan', l.vlan) + attr('bandwidth', l.bandwidth) + (canWriteMode(l) ? attr('mode', l.mode) : '');
      line += attr('type', l.linkType) + attr('native', l.nativeVlan) + attr('lacp', l.lacp) + attr('circuit', l.circuitId);
      out.push(line);
    }
  }

  const subnets = model.subnets ?? [];
  if (subnets.length) {
    out.push('', '# Subnets');
    for (const s of subnets) {
      out.push(
        `subnet ${quoteNexText(text(s.cidr))}` +
          attr('name', s.name) +
          attr('gateway', s.gateway) +
          (s.vlanId != null && canWriteSubnetVlan(s) ? ` vlan=${s.vlanId}` : '') +
          attr('zone', s.zone),
      );
    }
  }

  // A VLAN without an integer id cannot be a `vlan <id>` statement: it is left out, and
  // the planner leaves it alone (it must not block Apply, nor be removed by it).
  const vlans = (model.vlans ?? []).filter(canWriteVlan);
  if (vlans.length) {
    out.push('', '# VLANs');
    for (const v of vlans) out.push(`vlan ${v.vlanId}` + attr('name', v.name) + attr('zone', v.zone));
  }

  return out.join('\n');
}

/** Convenience re-export so callers don't import the constant separately. */
export const DEVICE_SIZE = DEFAULT_DEVICE_SIZE;
