/**
 * Rule intent — read a custom rule out of a sentence typed into ⌘K, so a rule can
 * be declared the way you'd say it: "every camera lives in CCTV", "no guest may
 * reach internal", "every access connects to at least 2 core".
 *
 * Deliberately a small, deterministic grammar (local-first: no model, no network).
 * It either reads the sentence exactly or returns null — it never half-guesses a
 * rule. Roles and subnets are single tokens, or "quoted phrases" for multi-word
 * names. A plural role ("cameras") resolves to a known singular role ("camera")
 * when the design has one, so the sentence reads naturally either way. A count
 * ("at least 2 firewalls") also resolves against device types, since that's what
 * a count usually means.
 */
import { DEVICE_TYPES } from './schema';
import { MAX_RULE_MIN } from './invariants';
import type { CustomRuleSpec } from './types';

/** A parsed rule, ready for `addCustomRule(kind, fromRole, target, min)`. */
export interface RuleIntent {
  kind: CustomRuleSpec['kind'];
  fromRole: string;
  /** The target role (connectivity/isolation) or subnet ref (placement); '' for count. */
  target: string;
  /** Connectivity / count minimum; 0 for the other kinds. */
  min: number;
}

/** A role or subnet: "a quoted phrase" or one token (letters, digits, - _ . / :). */
const TERM = String.raw`("[^"]+"|[\w./:-]+)`;
const NUM = String.raw`(\d+)`;
/** A name template: "a quoted phrase" or one token that may hold `#` (number) and `*` (anything). */
const PAT = String.raw`("[^"]+"|[\w./:#*-]+)`;
const QUANT = String.raw`(?:at\s+least\s+|>=\s*|≥\s*)?`;
/** A generic noun after a counted term ("at least 2 firewall devices"), dropped. */
const FILLER = String.raw`(?:\s+(?:devices?|nodes?|boxes|units?))?`;
const MAY = String.raw`(?:may|can|should|must|shall)\s+(?:not|never)|cannot|can't|mustn't|shouldn't`;

const PATTERNS: { re: RegExp; build: (m: RegExpMatchArray) => RuleIntent | null }[] = [
  {
    // every firewall is named FW-#   ·   all switches are named like "SW #"   ·   firewalls named FW-#
    re: new RegExp(
      String.raw`^(?:(?:every|each|all)\s+)?${TERM}\s+(?:(?:is|are|must\s+be|should\s+be)\s+)?named\s+(?:like\s+)?${PAT}$`,
      'i',
    ),
    build: (m) => ({ kind: 'naming', fromRole: m[1]!, target: m[2]!, min: 0 }),
  },
  {
    // name every firewall FW-#   ·   name firewalls like FW-#
    re: new RegExp(String.raw`^name\s+(?:(?:every|each|all)\s+)?${TERM}\s+(?:like\s+)?${PAT}$`, 'i'),
    build: (m) => ({ kind: 'naming', fromRole: m[1]!, target: m[2]!, min: 0 }),
  },
  {
    // at least 2 firewalls   ·   need at least 2 core   ·   there must be ≥2 "core switch" devices
    re: new RegExp(
      String.raw`^(?:(?:we\s+)?(?:need|require|want|keep)\s+|there\s+(?:must|should)\s+be\s+|have\s+)?(?:at\s+least\s+|>=\s*|≥\s*)${NUM}\s+${TERM}${FILLER}$`,
      'i',
    ),
    build: (m) => {
      const min = Number(m[1]);
      return min >= 1 && min <= MAX_RULE_MIN ? { kind: 'count', fromRole: m[2]!, target: '', min } : null;
    },
  },
  {
    // every access connects to (at least|≥) 2 core   ·   each access links to 2 cores
    re: new RegExp(String.raw`^(?:every|each|all)\s+${TERM}\s+(?:connects?|links?|uplinks?)\s+(?:to\s+)?${QUANT}${NUM}\s+${TERM}$`, 'i'),
    build: (m) => {
      const min = Number(m[2]);
      return min >= 1 && min <= MAX_RULE_MIN ? { kind: 'connectivity', fromRole: m[1]!, target: m[3]!, min } : null;
    },
  },
  {
    // no guest may reach internal   ·   no guests can reach "core network"
    re: new RegExp(String.raw`^no\s+${TERM}\s+(?:may|can|should|shall|must)\s+reach\s+${TERM}$`, 'i'),
    build: (m) => ({ kind: 'isolation', fromRole: m[1]!, target: m[2]!, min: 0 }),
  },
  {
    // guest must not reach internal   ·   guests cannot reach internal
    re: new RegExp(String.raw`^${TERM}\s+(?:${MAY})\s+reach\s+${TERM}$`, 'i'),
    build: (m) => ({ kind: 'isolation', fromRole: m[1]!, target: m[2]!, min: 0 }),
  },
  {
    // isolate guest from internal
    re: new RegExp(String.raw`^isolate\s+${TERM}\s+from\s+${TERM}$`, 'i'),
    build: (m) => ({ kind: 'isolation', fromRole: m[1]!, target: m[2]!, min: 0 }),
  },
  {
    // every camera is on VLAN 20   ·   cameras on vlan20   ·   all printers live in VLAN 30
    re: new RegExp(
      String.raw`^(?:(?:every|each|all)\s+)?${TERM}\s+(?:(?:lives?|belongs?|sits?|is|are|goes?|stays?)\s+)?(?:in|on)\s+(?:the\s+)?vlan\s*-?\s*${NUM}$`,
      'i',
    ),
    build: (m) => {
      const id = Number(m[2]);
      return id >= 1 && id <= 4094 ? { kind: 'placement', fromRole: m[1]!, target: `VLAN ${id}`, min: 0 } : null;
    },
  },
  {
    // every camera lives in CCTV   ·   all cameras live in subnet 10.20.0.0/24   ·   every camera in CCTV
    re: new RegExp(String.raw`^(?:every|each|all)\s+${TERM}\s+(?:(?:lives?|belongs?|sits?|is|are)\s+)?in\s+(?:subnet\s+|the\s+)?${TERM}(?:\s+subnet)?$`, 'i'),
    build: (m) => ({ kind: 'placement', fromRole: m[1]!, target: m[2]!, min: 0 }),
  },
];

const unquote = (s: string) => s.replace(/^"(.*)"$/, '$1').trim();

/**
 * Resolve a typed role against the design's roles: an exact (case-insensitive)
 * match keeps the design's spelling; a plural that's a known role minus its "s"
 * (or "es") resolves to that role; anything else is kept as typed (the rule can
 * name a role before any device carries it).
 */
export function resolveRole(typed: string, knownRoles: readonly string[]): string {
  const t = typed.trim();
  const find = (s: string) => knownRoles.find((r) => r.trim().toLowerCase() === s.toLowerCase());
  return find(t) ?? (/es$/i.test(t) ? find(t.slice(0, -2)) : undefined) ?? (/s$/i.test(t) ? find(t.slice(0, -1)) : undefined) ?? t;
}

/**
 * Parse a typed sentence into a custom rule, or null when it isn't one. Trailing
 * punctuation and extra whitespace are ignored; roles resolve against `knownRoles`
 * (see `resolveRole`); a placement's subnet takes the spelling of a matching
 * `knownSubnets` entry (name or CIDR), else stays as typed — it's resolved by name
 * or CIDR when the rule is evaluated, so it can name a subnet you'll draw later.
 */
export function parseRuleIntent(
  text: string,
  knownRoles: readonly string[] = [],
  knownSubnets: readonly string[] = [],
): RuleIntent | null {
  const q = text.trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '');
  if (!q) return null;
  for (const { re, build } of PATTERNS) {
    const m = q.match(re);
    if (!m) continue;
    const raw = build(m);
    if (!raw) return null;
    const byType = raw.kind === 'count' || raw.kind === 'naming';
    const fromRole = resolveRole(unquote(raw.fromRole), byType ? [...knownRoles, ...DEVICE_TYPES] : knownRoles);
    if (raw.kind === 'count') return fromRole ? { ...raw, fromRole } : null;
    // A name template keeps its exact spelling and case.
    if (raw.kind === 'naming') return fromRole && unquote(raw.target) ? { ...raw, fromRole, target: unquote(raw.target) } : null;
    const typedTarget = unquote(raw.target);
    const target =
      raw.kind === 'placement'
        ? (knownSubnets.find((s) => s.trim().toLowerCase() === typedTarget.toLowerCase()) ?? typedTarget)
        : resolveRole(typedTarget, knownRoles);
    if (!fromRole || !target) return null;
    return { ...raw, fromRole, target };
  }
  return null;
}
