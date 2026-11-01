/**
 * Rules files — a design's declared rules as a small, reusable file, so a team's
 * standards ("two firewalls per site", "cameras on VLAN 20") carry from one design
 * to the next instead of being retyped. Local-first like everything else: written
 * with a download, read with a file picker, never sent anywhere.
 *
 * Reading also accepts a whole `.nexmap` design and takes only its rules, so "use
 * the rules from the Boston site" works without exporting anything first.
 */
import { nanoid } from 'nanoid';
import { clampRuleMin, findRestated, hasMinimum, placementRef } from '@/model/invariants';
import type { CustomRuleSpec } from '@/model/types';

export const RULES_FORMAT = 'nexmap-rules';
export const RULES_FILE_VERSION = 1;
export const RULES_EXTENSION = '.nexrules';

/** The design's declared rules (same shape as the store's, kept local to stay pure). */
export interface DeclaredRuleSet {
  invariants: ReadonlySet<string>;
  customRules: readonly CustomRuleSpec[];
  /** Declared rule ids that are enforced (see the store's rule guard). */
  enforced?: ReadonlySet<string>;
}

/** An authored rule as a file carries it: no id, and whether it's enforced. */
export type FileRule = Omit<CustomRuleSpec, 'id'> & { enforced?: boolean };

/** What a rules file holds: built-in rule ids and authored rules (ids dropped). */
interface RulesFileJson {
  format: typeof RULES_FORMAT;
  version: number;
  /** Where the rules came from, for the person reading the file. */
  from?: string;
  invariants: string[];
  /** Built-in rules (of `invariants`) that are enforced. Absent → none. */
  enforcedInvariants?: string[];
  customRules: FileRule[];
}

/** "Boston site" → "Boston site rules.nexrules" (same character rules as other exports). */
export function rulesFileName(projectName: string): string {
  const base = projectName.trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 70) || 'nexmap';
  return `${base} rules${RULES_EXTENSION}`;
}

/** Serialize the declared rules. Ids are left out: they're per-design. */
export function writeRulesFile(rules: DeclaredRuleSet, from: string): string {
  const enforced = rules.enforced ?? new Set<string>();
  const enforcedInvariants = [...rules.invariants].filter((id) => enforced.has(id)).sort();
  const json: RulesFileJson = {
    format: RULES_FORMAT,
    version: RULES_FILE_VERSION,
    from,
    invariants: [...rules.invariants].sort(),
    ...(enforcedInvariants.length > 0 ? { enforcedInvariants } : {}),
    customRules: rules.customRules.map(({ id, ...rest }) => (enforced.has(id) ? { ...rest, enforced: true } : rest)),
  };
  return `${JSON.stringify(json, null, 2)}\n`;
}

export type ReadRules =
  | {
      ok: true;
      invariants: string[];
      /** Of `invariants`, the enforced ones. */
      enforcedInvariants: string[];
      customRules: FileRule[];
      source: 'rules' | 'design';
    }
  | { ok: false; error: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** One authored rule from untrusted JSON, or null when it isn't one. */
function readCustomRule(x: unknown, enforced: (x: Record<string, unknown>) => boolean): FileRule | null {
  if (!isObj(x) || typeof x.kind !== 'string' || typeof x.fromRole !== 'string') return null;
  const kind = x.kind as CustomRuleSpec['kind'];
  const raw = typeof x.min === 'number' && Number.isFinite(x.min) ? x.min : 0;
  return {
    // An unknown kind (from a newer build) is kept: it round-trips and reads "not checked".
    kind,
    fromRole: x.fromRole,
    toRole: typeof x.toRole === 'string' ? x.toRole : '',
    // Known kinds get a sane whole minimum; an unknown kind keeps its number as-is.
    min: kind === 'count' || kind === 'connectivity' ? clampRuleMin(kind, raw) : raw,
    ...(typeof x.subnet === 'string' ? { subnet: kind === 'placement' ? placementRef(x.subnet) : x.subnet } : {}),
    ...(typeof x.pattern === 'string' ? { pattern: x.pattern } : {}),
    ...(enforced(x) ? { enforced: true } : {}),
  };
}

/**
 * A design's stored rule, sanitized: the same checks as reading a rules file, plus
 * an id (kept when it's a string, minted otherwise). Null when it isn't a rule. The
 * store runs every loaded rule through this, so a hand-edited or damaged `.nexmap`
 * can't crash loading halfway.
 */
export function sanitizeStoredRule(x: unknown): CustomRuleSpec | null {
  // Enforcement lives in the design's own list, not on the rule: never read it here.
  const rule = readCustomRule(x, () => false);
  if (!rule || !isObj(x)) return null;
  return { ...rule, id: typeof x.id === 'string' && x.id ? x.id : nanoid() };
}

/**
 * Read rules from a rules file or a `.nexmap` design. Anything that isn't one —
 * bad JSON, another app's file, a design with no rules — says why instead of
 * importing nothing silently.
 */
export function readRulesFile(text: string): ReadRules {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'it isn’t a rules file or a NexMap design (not valid JSON)' };
  }
  if (!isObj(json)) return { ok: false, error: 'it isn’t a rules file or a NexMap design' };
  const isRules = json.format === RULES_FORMAT;
  const isDesign = !isRules && typeof json.schemaVersion === 'number' && Array.isArray(json.devices);
  if (!isRules && !isDesign) return { ok: false, error: 'it isn’t a rules file or a NexMap design' };
  if (isRules && typeof json.version === 'number' && json.version > RULES_FILE_VERSION) {
    return { ok: false, error: 'it was written by a newer NexMap — update to read it' };
  }
  const invariants = Array.isArray(json.invariants) ? json.invariants.filter((x): x is string => typeof x === 'string') : [];
  // A rules file flags enforcement per rule; a design lists enforced ids.
  const designEnforced = new Set(
    isDesign && Array.isArray(json.enforcedRules) ? json.enforcedRules.filter((x): x is string => typeof x === 'string') : [],
  );
  const customRules = (Array.isArray(json.customRules) ? json.customRules : [])
    .map((x) => readCustomRule(x, (r) => (isRules ? r.enforced === true : designEnforced.has(String(r.id)))))
    .filter((r): r is FileRule => r !== null);
  const enforcedInvariants = isRules
    ? (Array.isArray(json.enforcedInvariants) ? json.enforcedInvariants : []).filter(
        (x): x is string => typeof x === 'string' && invariants.includes(x),
      )
    : invariants.filter((id) => designEnforced.has(id));
  if (invariants.length === 0 && customRules.length === 0) {
    return { ok: false, error: isDesign ? 'that design declares no rules' : 'the file holds no rules' };
  }
  return { ok: true, invariants, enforcedInvariants, customRules, source: isRules ? 'rules' : 'design' };
}

export interface RulesMerge {
  next: { invariants: Set<string>; customRules: CustomRuleSpec[]; enforced: Set<string> };
  /** Rules this design didn't have. */
  added: number;
  /** Rules it had with another minimum, now taking the file's ("2 → 3"). */
  changed: number;
  /** Rules it already had exactly. */
  same: number;
  /** Rules the file enforces that weren't enforced here before. */
  newlyEnforced: number;
}

/**
 * Merge imported rules into the declared ones. A file is a standard to adopt, so
 * the same rule with another minimum takes the file's number, and a rule the file
 * enforces is enforced here too; anything already declared exactly is left alone;
 * nothing declared — or enforced — is ever dropped.
 */
export function mergeRules(
  current: DeclaredRuleSet,
  incoming: { invariants: readonly string[]; enforcedInvariants?: readonly string[]; customRules: readonly FileRule[] },
): RulesMerge {
  const invariants = new Set(current.invariants);
  const customRules = [...current.customRules];
  const enforced = new Set(current.enforced ?? []);
  const enforcedBefore = enforced.size;
  let added = 0;
  let changed = 0;
  let same = 0;
  for (const id of incoming.enforcedInvariants ?? []) enforced.add(id);
  for (const id of new Set(incoming.invariants)) {
    if (invariants.has(id)) same++;
    else {
      invariants.add(id);
      added++;
    }
  }
  for (const { enforced: enforce, ...r } of incoming.customRules) {
    const have = findRestated(customRules, r);
    let id: string;
    if (!have) {
      id = nanoid();
      customRules.push({ ...r, id });
      added++;
    } else if (hasMinimum(r.kind) && have.min !== r.min && r.min >= 1) {
      id = have.id;
      customRules[customRules.indexOf(have)] = { ...have, min: clampRuleMin(r.kind, r.min) };
      changed++;
    } else {
      id = have.id;
      same++;
    }
    if (enforce) enforced.add(id);
  }
  return {
    next: { invariants, customRules, enforced },
    added,
    changed,
    same,
    newlyEnforced: enforced.size - enforcedBefore,
  };
}
