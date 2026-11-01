/**
 * Rule stakes — what a device means to the declared rules. Two questions an
 * engineer asks before touching a box:
 *  - BREAKS:   which rules does it break now, and why? (same reasons as the Rules tab)
 *  - HOLDS UP: which rules that hold now would break without it? Asked by removing
 *    the device and its links and re-running the same evaluators — so it can't
 *    disagree with what Conductor reports after a real delete.
 *
 * `newlyBroken` is the after-the-fact form of HOLDS UP, for any edit: the rules
 * that held before and don't after.
 */
import {
  countedDevices,
  isolationPath,
  evaluateCustomRules,
  evaluateInvariants,
  explainOffenders,
  violationTodo,
  type InvariantContext,
  type InvariantViolation,
} from './invariants';
import type { CustomRuleSpec, Link } from './types';
import { spofCountsWithout } from '@/sim/resilience';

export interface DeclaredRules {
  invariants: ReadonlySet<string>;
  customRules: readonly CustomRuleSpec[];
}

export interface RuleStake {
  /** Rule id (built-in invariant id or custom rule id). */
  id: string;
  label: string;
  /** Breaks: why this device breaks it. Holds up: what deleting it would leave ("1 short"). */
  detail: string;
}

export interface DeviceStakes {
  breaks: RuleStake[];
  holdsUp: RuleStake[];
}

/** Every violation of the declared rules, built-in then authored (panel order). */
export function evaluateDeclared(ctx: InvariantContext, rules: DeclaredRules): InvariantViolation[] {
  return [...evaluateInvariants(ctx, rules.invariants), ...evaluateCustomRules(rules.customRules, ctx)];
}

/**
 * The design without these objects: devices (with every link and cable touching
 * them) and links, by id. Other ids are ignored.
 */
export function without(ctx: InvariantContext, deviceIds: ReadonlySet<string>): InvariantContext {
  return {
    devices: ctx.devices.filter((d) => !deviceIds.has(d.id)),
    links: ctx.links.filter((l) => !deviceIds.has(l.id) && !deviceIds.has(l.sourceId) && !deviceIds.has(l.targetId)),
    subnets: ctx.subnets,
    rackCables: ctx.rackCables?.filter((c) => !deviceIds.has(c.aEnd.deviceId) && !deviceIds.has(c.bEnd.deviceId)),
  };
}

/** Rules violated in `after` that weren't violated in `before`. */
export function newlyBroken(
  before: readonly InvariantViolation[],
  after: readonly InvariantViolation[],
): InvariantViolation[] {
  const was = new Set(before.map((v) => v.id));
  return after.filter((v) => !was.has(v.id));
}

/** A device a met rule can't lose, and what losing it would leave. */
export interface RuleSupport {
  deviceId: string;
  name: string;
  /** What deleting it would leave ("1 short", "2 to fix"). */
  detail: string;
}

/** Above this many devices, "held up by" skips the SPOF rule (see ruleSupports). */
export const SPOF_SUPPORT_LIMIT = 1000;

/**
 * The rule-side view of HOLDS UP: for every declared rule that's met now, the
 * devices whose deletion alone would break it, by name. A met rule absent from the
 * map has no single point of support.
 *
 * It answers what `deviceStakes` answers by remove-and-re-check, per rule kind,
 * without re-running every rule once per device (that's O(V²) and too slow to run
 * with validation on a big design):
 *  - named / addressed / gateway, placement, isolation: a delete can't break them
 *    (fewer devices never adds a blank name, a stray address or a path).
 *  - count: met with exactly `min` → every counted device is load-bearing ("1 short").
 *  - connectivity: deleting a `to` device costs each `from` neighbor one; it breaks
 *    the rule for every neighbor sitting at exactly `min`.
 *  - no single point of failure: no exact shortcut — one cut-vertex pass per linked
 *    device on a graph indexed once (`spofCountsWithout`).
 * ruleStakes.test checks the result against the generic remove-and-re-check.
 */
export function ruleSupports(
  ctx: InvariantContext,
  rules: DeclaredRules,
  /** Ids of the rules broken now, when the caller already evaluated them. */
  brokenNow?: ReadonlySet<string>,
): Map<string, RuleSupport[]> {
  const out = new Map<string, RuleSupport[]>();
  if (rules.invariants.size === 0 && rules.customRules.length === 0) return out;
  const broken = brokenNow ?? new Set(evaluateDeclared(ctx, rules).map((v) => v.id));
  const byId = new Map(ctx.devices.map((d) => [d.id, d]));
  const add = (ruleId: string, deviceId: string, detail: string) => {
    const d = byId.get(deviceId)!;
    const list = out.get(ruleId) ?? out.set(ruleId, []).get(ruleId)!;
    list.push({ deviceId, name: d.name.trim() || d.type, detail });
  };
  const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

  // Distinct-neighbor adjacency, as the evaluators build it.
  const neighbors = new Map<string, Set<string>>();
  for (const d of ctx.devices) neighbors.set(d.id, new Set());
  for (const l of ctx.links) {
    if (l.sourceId === l.targetId) continue;
    const a = neighbors.get(l.sourceId);
    const b = neighbors.get(l.targetId);
    if (a && b) {
      a.add(l.targetId);
      b.add(l.sourceId);
    }
  }

  const SPOF = 'no-single-point-of-failure';
  // Quadratic at heart (~55 ms at 1000 devices): past SPOF_SUPPORT_LIMIT devices
  // the SPOF rule shows plain "met" rather than stall every edit.
  if (rules.invariants.has(SPOF) && !broken.has(SPOF) && ctx.devices.length <= SPOF_SUPPORT_LIMIT) {
    for (const [id, spofs] of spofCountsWithout(ctx.devices, ctx.links)) {
      add(SPOF, id, violationTodo({ id: SPOF, label: '', objectIds: Array(spofs).fill('') }));
    }
  }

  for (const r of rules.customRules) {
    if (broken.has(r.id)) continue;
    const from = norm(r.fromRole);
    if (r.kind === 'count') {
      if (!from || !(r.min >= 1)) continue;
      const counted = countedDevices(from, ctx.devices);
      if (counted.length === r.min) for (const d of counted) add(r.id, d.id, violationTodo({ id: r.id, label: '', objectIds: [], shortfall: 1 }));
    } else if (r.kind === 'connectivity') {
      const to = norm(r.toRole);
      if (!from || !to) continue;
      // How many `to` neighbors each `from` device has now.
      const have = new Map<string, number>();
      for (const d of ctx.devices) {
        if (norm(d.role) !== from) continue;
        let n = 0;
        for (const x of neighbors.get(d.id)!) if (norm(byId.get(x)?.role) === to) n++;
        have.set(d.id, n);
      }
      for (const d of ctx.devices) {
        if (norm(d.role) !== to) continue;
        let left = 0; // from-neighbors this delete would drop below min
        for (const x of neighbors.get(d.id)!) if (x !== d.id && have.get(x) === r.min) left++;
        if (left > 0) add(r.id, d.id, violationTodo({ id: r.id, label: '', objectIds: Array(left).fill('') }));
      }
    }
    // placement, isolation, unknown kinds: a delete can't break them.
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return out;
}

/** deviceId → how many met rules it holds up (the canvas's load-bearing mark). */
export function supportCounts(supports: ReadonlyMap<string, readonly RuleSupport[]>): Map<string, number> {
  const out = new Map<string, number>();
  for (const list of supports.values()) for (const s of list) out.set(s.deviceId, (out.get(s.deviceId) ?? 0) + 1);
  return out;
}

/** Above this many selected objects, `deleteStakes` doesn't work out "only together". */
const TOGETHER_LIMIT = 40;

/** A rule a delete would break, and whether the deleted objects only hold it up together. */
export interface DeleteStake extends RuleStake {
  /** No one of the selected devices holds it up alone — only the group does. */
  together: boolean;
}

/**
 * What deleting a whole selection (devices and/or links) would do to the declared
 * rules: which held rules it breaks, and for each whether it's the group that holds
 * it up (two redundant firewalls: neither alone, both together). Same evaluators as
 * the Rules tab, so the preview matches the delete.
 */
export function deleteStakes(ids: readonly string[], ctx: InvariantContext, rules: DeclaredRules): DeleteStake[] {
  if (ids.length === 0 || (rules.invariants.size === 0 && rules.customRules.length === 0)) return [];
  const now = evaluateDeclared(ctx, rules);
  const gone = new Set(ids);
  const broke = newlyBroken(now, evaluateDeclared(without(ctx, gone), rules));
  if (broke.length === 0) return [];
  // Which of these a single selected object would already break on its own (one
  // re-check per object, so only for selections small enough to read as a group).
  const alone = new Set<string>();
  const judgeTogether = ids.length > 1 && ids.length <= TOGETHER_LIMIT;
  for (const id of judgeTogether ? ids : []) {
    for (const v of newlyBroken(now, evaluateDeclared(without(ctx, new Set([id])), rules))) alone.add(v.id);
  }
  return broke.map((v) => ({ id: v.id, label: v.label, detail: violationTodo(v), together: judgeTogether && !alone.has(v.id) }));
}

/** What the declared rules make of one device. Empty when nothing is declared. */
export function deviceStakes(deviceId: string, ctx: InvariantContext, rules: DeclaredRules): DeviceStakes {
  if (rules.invariants.size === 0 && rules.customRules.length === 0) return { breaks: [], holdsUp: [] };
  const now = evaluateDeclared(ctx, rules);
  const breaks: RuleStake[] = [];
  for (const v of now) {
    if (!v.objectIds.includes(deviceId)) continue;
    const why = explainOffenders(v.id, [deviceId], ctx, rules.customRules)[0];
    breaks.push({ id: v.id, label: v.label, detail: why?.reason ?? 'breaks this rule' });
  }
  const holdsUp = newlyBroken(now, evaluateDeclared(without(ctx, new Set([deviceId])), rules)).map((v) => ({
    id: v.id,
    label: v.label,
    detail: violationTodo(v),
  }));
  return { breaks, holdsUp };
}

/**
 * What to say when a step broke rules that held: "That delete broke X; Y and 1
 * more. ⌘Z puts it back." The verb follows the step (an undo is put back with
 * redo); `label` is the history command's label.
 */
export function brokeMessage(
  broke: readonly InvariantViolation[],
  step: { kind: 'do' | 'undo' | 'redo'; label: string },
): string {
  const names = broke.slice(0, 2).map((v) => v.label).join('; ');
  const more = broke.length > 2 ? ` and ${broke.length - 2} more` : '';
  const what =
    step.kind === 'undo'
      ? 'That undo'
      : step.kind === 'redo'
        ? 'That redo'
        : /^(delete|remove)\b/i.test(step.label)
          ? 'That delete'
          : 'That edit';
  return `${what} broke ${names}${more}. ${step.kind === 'undo' ? '⌘⇧Z' : '⌘Z'} puts it back.`;
}

/**
 * What to say when an edit was taken back because it broke an enforced rule:
 * "Blocked: that delete would break At least 2 “firewall”, which is enforced. …"
 */
export function blockedMessage(enforced: readonly InvariantViolation[], step: { label: string }): string {
  const names = enforced.slice(0, 2).map((v) => v.label).join('; ');
  const more = enforced.length > 2 ? ` and ${enforced.length - 2} more` : '';
  const what = /^(delete|remove)\b/i.test(step.label) ? 'that delete' : 'that edit';
  const one = enforced.length === 1;
  return `Blocked: ${what} would break ${names}${more}, which ${one ? 'is' : 'are'} enforced. Stop enforcing ${
    one ? 'it' : 'them'
  } in the Rules tab to make this change.`;
}

/**
 * The fix for one offender of a broken "every A connects to ≥N B" rule: which B
 * devices to link it to. Prefers the B with the fewest A devices already on it
 * (spread the load), then by name; never one it's already linked to; and never one
 * whose link would break another rule that holds now (connecting a guest switch to
 * a core can break "no guest may reach core") — judged together with the others
 * it suggests. As many as it's short, or fewer when that's all there is. Conductor only suggests — you click to connect.
 */
export function suggestUplinks(
  rule: CustomRuleSpec,
  deviceId: string,
  ctx: InvariantContext,
  rules: DeclaredRules,
): { id: string; name: string }[] {
  if (rule.kind !== 'connectivity') return [];
  const norm = (x: string | undefined) => (x ?? '').trim().toLowerCase();
  const from = norm(rule.fromRole);
  const to = norm(rule.toRole);
  const self = ctx.devices.find((d) => d.id === deviceId);
  if (!from || !to || !self || norm(self.role) !== from) return [];
  const neighbors = new Map<string, Set<string>>();
  for (const d of ctx.devices) neighbors.set(d.id, new Set());
  for (const l of ctx.links) {
    if (l.sourceId === l.targetId) continue;
    neighbors.get(l.sourceId)?.add(l.targetId);
    neighbors.get(l.targetId)?.add(l.sourceId);
  }
  const mine = neighbors.get(deviceId)!;
  const byId = new Map(ctx.devices.map((d) => [d.id, d]));
  const have = [...mine].filter((id) => norm(byId.get(id)?.role) === to).length;
  const need = rule.min - have;
  if (need <= 0) return [];
  const load = (id: string) => [...neighbors.get(id)!].filter((n) => norm(byId.get(n)?.role) === from).length;
  const nameOf = (id: string) => byId.get(id)!.name.trim() || byId.get(id)!.type;
  const candidates = ctx.devices
    .filter((d) => d.id !== deviceId && norm(d.role) === to && !mine.has(d.id))
    .sort((a, b) => load(a.id) - load(b.id) || nameOf(a.id).localeCompare(nameOf(b.id), undefined, { numeric: true }));
  const others: DeclaredRules = {
    invariants: rules.invariants,
    customRules: rules.customRules.filter((r) => r.id !== rule.id),
  };
  const now = evaluateDeclared(ctx, others);
  const out: { id: string; name: string }[] = [];
  // Each candidate is tried on top of the ones already chosen, so the suggested
  // links are safe together, not just one at a time.
  const chosen: Link[] = [];
  for (const c of candidates) {
    if (out.length >= need) break;
    const trial: Link = { id: `\u0000trial${chosen.length}`, kind: 'link', sourceId: deviceId, targetId: c.id, layerId: '' };
    if (newlyBroken(now, evaluateDeclared({ ...ctx, links: [...ctx.links, ...chosen, trial] }, others)).length > 0) continue;
    chosen.push(trial);
    out.push({ id: c.id, name: nameOf(c.id) });
  }
  return out;
}

/**
 * The fix for one offender of a broken "no A may reach B" rule: a link to cut. It
 * walks the shortest path from the offender to the B it reaches and offers the hops
 * whose single cut separates them — offender side first (cutting the guest's own
 * uplink walls it off before anything shared) — skipping doubled links (one cut
 * wouldn't separate), an uplink a connectivity rule is counting on (even one that's
 * already broken: the cut would deepen it), and any cut that would break another
 * rule that holds now.
 * At most two. Conductor only suggests; you click, and ⌘Z puts the link back.
 */
export function suggestCuts(
  rule: CustomRuleSpec,
  deviceId: string,
  ctx: InvariantContext,
  rules: DeclaredRules,
): { linkId: string; label: string }[] {
  if (rule.kind !== 'isolation') return [];
  const path = isolationPath(rule.toRole, deviceId, ctx);
  if (!path) return [];
  const byId = new Map(ctx.devices.map((d) => [d.id, d]));
  const nameOf = (id: string) => byId.get(id)!.name.trim() || byId.get(id)!.type;
  const others: DeclaredRules = {
    invariants: rules.invariants,
    customRules: rules.customRules.filter((r) => r.id !== rule.id),
  };
  const now = evaluateDeclared(ctx, others);
  // An uplink a "connects to ≥N" rule is counting on (its switch has no spare) is
  // never the cut — even when that rule is already broken, cutting would deepen it.
  const norm = (x: string | undefined) => (x ?? '').trim().toLowerCase();
  const nbrs = new Map<string, Set<string>>();
  for (const l of ctx.links) {
    if (l.sourceId === l.targetId) continue;
    (nbrs.get(l.sourceId) ?? nbrs.set(l.sourceId, new Set()).get(l.sourceId)!).add(l.targetId);
    (nbrs.get(l.targetId) ?? nbrs.set(l.targetId, new Set()).get(l.targetId)!).add(l.sourceId);
  }
  const needed = (x: string, y: string) =>
    rules.customRules.some((r) => {
      if (r.kind !== 'connectivity' || norm(byId.get(x)?.role) !== norm(r.fromRole)) return false;
      if (norm(byId.get(y)?.role) !== norm(r.toRole)) return false;
      const have = [...(nbrs.get(x) ?? [])].filter((n) => norm(byId.get(n)?.role) === norm(r.toRole)).length;
      return have <= r.min;
    });
  const out: { linkId: string; label: string }[] = [];
  for (let i = 0; i < path.length - 1 && out.length < 2; i++) {
    const [a, b] = [path[i]!, path[i + 1]!];
    const between = ctx.links.filter(
      (l) => (l.sourceId === a && l.targetId === b) || (l.sourceId === b && l.targetId === a),
    );
    if (between.length !== 1) continue; // doubled: one cut leaves the other
    const cut = between[0]!;
    if (needed(a, b) || needed(b, a)) continue;
    const trial = { ...ctx, links: ctx.links.filter((l) => l.id !== cut.id) };
    if (evaluateCustomRules([rule], trial)[0]?.objectIds.includes(deviceId)) continue; // another way round
    if (newlyBroken(now, evaluateDeclared(trial, others)).length > 0) continue;
    out.push({ linkId: cut.id, label: `${nameOf(a)}–${nameOf(b)}` });
  }
  return out;
}

/** One concrete, user-clicked fix for one offender of a broken rule. */
export type RuleFix = {
  /** Stable key (React lists, ⌘K ids). */
  key: string;
  ruleId: string;
  ruleLabel: string;
  deviceId: string;
  deviceName: string;
} & (
  | { kind: 'connect'; targetId: string; targetName: string }
  | { kind: 'cut'; linkId: string; linkLabel: string }
);

/**
 * Every quick fix Conductor can offer right now: a link for each device short of a
 * connectivity rule, a cut for each device reaching what an isolation rule walls
 * off (see suggestUplinks / suggestCuts), planned together: links are chosen as if
 * the suggested cuts were made. `onlyDevice` narrows to one device; `max` caps the
 * offenders looked at (each costs a few re-checks). Shared by the Rules
 * tab, the Inspector and ⌘K so they always offer the same fixes.
 */
export function ruleFixes(
  ctx: InvariantContext,
  rules: DeclaredRules,
  opts: { onlyDevice?: string; max?: number; ruleId?: string; kind?: RuleFix['kind'] } = {},
): RuleFix[] {
  const byId = new Map(ctx.devices.map((d) => [d.id, d]));
  const nameOf = (id: string) => byId.get(id)!.name.trim() || byId.get(id)!.type;
  const violations = evaluateCustomRules(rules.customRules, ctx);
  const ruleOf = (id: string) => rules.customRules.find((r) => r.id === id);
  // Cuts first: uplinks are then planned against the design with those cuts made, so
  // Conductor never suggests a link that would become the walled-off role's way back
  // in once you've taken its suggested cut. Each cut costs a few whole-design
  // re-checks, so only a bounded number of breaches are planned — the asked-for
  // device's first (it's the one being shown).
  const cuts = new Map<string, RuleFix[]>(); // `${ruleId}:${deviceId}` → its cut fixes
  const cutFirst = new Set<string>();
  const breaches: { v: InvariantViolation; rule: CustomRuleSpec; deviceId: string }[] = [];
  for (const v of violations) {
    const rule = ruleOf(v.id);
    if (rule?.kind !== 'isolation') continue;
    for (const deviceId of v.objectIds) if (byId.has(deviceId)) breaches.push({ v, rule, deviceId });
  }
  breaches.sort((a, b) => Number(b.deviceId === opts.onlyDevice) - Number(a.deviceId === opts.onlyDevice));
  // Other breaches' cuts only matter for planning uplinks: when the device asked for
  // isn't short of any, its own cuts are all there is to plan.
  const needsUplinks =
    !opts.onlyDevice ||
    violations.some((v) => ruleOf(v.id)?.kind === 'connectivity' && v.objectIds.includes(opts.onlyDevice!));
  const planned = needsUplinks ? breaches.slice(0, CUT_PLAN_LIMIT) : breaches.filter((x) => x.deviceId === opts.onlyDevice);
  for (const { v, rule, deviceId } of planned) {
    const found = suggestCuts(rule, deviceId, ctx, rules);
    if (found[0]) cutFirst.add(found[0].linkId);
    const list = cuts.get(`${v.id}:${deviceId}`) ?? [];
    for (const c of found) {
      list.push({
        ruleId: rule.id,
        ruleLabel: v.label,
        deviceId,
        deviceName: nameOf(deviceId),
        key: `cut:${rule.id}:${deviceId}:${c.linkId}`,
        kind: 'cut',
        linkId: c.linkId,
        linkLabel: c.label,
      });
    }
    cuts.set(`${v.id}:${deviceId}`, list);
  }
  const repaired = cutFirst.size > 0 ? { ...ctx, links: ctx.links.filter((l) => !cutFirst.has(l.id)) } : ctx;

  const out: RuleFix[] = [];
  let looked = 0;
  for (const v of violations) {
    const rule = ruleOf(v.id);
    if (!rule || (rule.kind !== 'connectivity' && rule.kind !== 'isolation')) continue;
    if (opts.ruleId && rule.id !== opts.ruleId) continue;
    if (opts.kind && (opts.kind === 'cut') !== (rule.kind === 'isolation')) continue;
    for (const deviceId of v.objectIds) {
      if (opts.onlyDevice && deviceId !== opts.onlyDevice) continue;
      if (!byId.has(deviceId)) continue;
      if (opts.max !== undefined && looked >= opts.max) return out;
      looked++;
      if (rule.kind === 'isolation') {
        out.push(...(cuts.get(`${v.id}:${deviceId}`) ?? []));
        continue;
      }
      const base = { ruleId: rule.id, ruleLabel: v.label, deviceId, deviceName: nameOf(deviceId) };
      for (const t of suggestUplinks(rule, deviceId, repaired, rules)) {
        out.push({ ...base, key: `connect:${rule.id}:${deviceId}:${t.id}`, kind: 'connect', targetId: t.id, targetName: t.name });
      }
    }
  }
  return out;
}

/** How many isolation breaches `ruleFixes` plans cuts for in one call (each costs re-checks). */
const CUT_PLAN_LIMIT = 30;

/** A fix as a button or command reads: "Connect to C2" / "Cut G–C1". */
export function ruleFixLabel(f: RuleFix): string {
  return f.kind === 'connect' ? `Connect to ${f.targetName}` : `Cut ${f.linkLabel}`;
}
