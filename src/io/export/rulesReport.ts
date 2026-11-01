/**
 * The declared rules as a report, shared by every export that carries them (CSV,
 * the standalone HTML viewer, the PDF appendix). One evaluation, so the formats
 * can't disagree about what's met.
 *
 * Always evaluated on the whole design, never an export scope, because rules
 * describe the design as a whole (a SPOF check on a partial graph would lie).
 * A rule this build doesn't know (written by a newer NexMap) is "not checked",
 * never silently "met".
 */
import {
  BUILT_IN_INVARIANTS,
  customRuleLabel,
  evaluateCustomRules,
  evaluateInvariants,
  explainOffenders,
  type Offender,
} from '@/model/invariants';
import type { CustomRuleSpec, Device, Link, RackCable, Subnet } from '@/model/types';

export interface RulesReportInput {
  devices: Device[];
  links: Link[];
  subnets: Subnet[];
  /** Rack patch cables — port evidence for VLAN rules. */
  rackCables?: RackCable[];
  /** Declared built-in invariant ids (schema v6). */
  invariants: readonly string[];
  /** Authored rules (schema v7). */
  customRules: readonly CustomRuleSpec[];
}

export type RuleStatus = 'met' | 'broken' | 'not checked';

export interface RuleReportEntry {
  label: string;
  /** 'built-in' or the custom rule kind. */
  kind: string;
  status: RuleStatus;
  /** Who breaks it and why; empty unless broken (and for a rule broken by absence). */
  offenders: Offender[];
  /** For a rule broken by absence (count): the gap, e.g. "1 present, 1 short". */
  detail?: string;
}

const KNOWN_CUSTOM_KINDS: ReadonlySet<string> = new Set(['connectivity', 'isolation', 'placement', 'count', 'naming']);

export function hasDeclaredRules(input: RulesReportInput | undefined): input is RulesReportInput {
  return !!input && (input.invariants.length > 0 || input.customRules.length > 0);
}

/** Every declared rule in panel order (built-ins, then authored), with its status. */
export function buildRulesReport(input: RulesReportInput): RuleReportEntry[] {
  const ctx = { devices: input.devices, links: input.links, subnets: input.subnets, rackCables: input.rackCables };
  const enabled = new Set(input.invariants);
  const violations = new Map(
    [...evaluateInvariants(ctx, enabled), ...evaluateCustomRules(input.customRules, ctx)].map((v) => [v.id, v]),
  );
  const builtInIds = new Set(BUILT_IN_INVARIANTS.map((i) => i.id));
  const declared: { id: string; label: string; kind: string; checked: boolean }[] = [
    ...BUILT_IN_INVARIANTS.filter((i) => enabled.has(i.id)).map((i) => ({
      id: i.id,
      label: i.label,
      kind: 'built-in',
      checked: true,
    })),
    ...[...enabled]
      .filter((id) => !builtInIds.has(id))
      .map((id) => ({ id, label: id, kind: 'built-in', checked: false })),
    ...input.customRules.map((r) => {
      const known = KNOWN_CUSTOM_KINDS.has(r.kind);
      return { id: r.id, label: known ? customRuleLabel(r) : `${r.kind} rule`, kind: r.kind, checked: known };
    }),
  ];
  return declared.map((d): RuleReportEntry => {
    if (!d.checked) return { label: d.label, kind: d.kind, status: 'not checked', offenders: [] };
    const v = violations.get(d.id);
    if (!v) return { label: d.label, kind: d.kind, status: 'met', offenders: [] };
    const entry: RuleReportEntry = {
      label: d.label,
      kind: d.kind,
      status: 'broken',
      offenders: explainOffenders(d.id, v.objectIds, ctx, input.customRules),
    };
    if (v.shortfall !== undefined) {
      const rule = input.customRules.find((r) => r.id === d.id);
      const have = (rule?.min ?? v.shortfall) - v.shortfall;
      entry.detail = `${have} present, ${v.shortfall} short`;
    }
    return entry;
  });
}

/** "3 of 5 rules met" — the one-line verdict every format leads with. */
export function rulesVerdict(entries: readonly RuleReportEntry[]): string {
  const met = entries.filter((e) => e.status === 'met').length;
  return `${met} of ${entries.length} rule${entries.length === 1 ? '' : 's'} met`;
}

const PDF_FOLD: Record<string, string> = {
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '≥': '>=',
  '≤': '<=',
  '—': '-',
  '–': '-',
  '…': '...',
  '→': '->',
};

/**
 * Text the PDF's built-in font can draw: it's Latin-1 only, and jsPDF garbles the
 * rest ("≥" comes out as '"e'). Fold the typography rule labels use, then replace
 * anything still outside Latin-1 rather than print garbage.
 */
export function pdfSafe(s: string): string {
  return s.replace(/[^\x20-\x7e\xa0-\xff]/g, (c) => PDF_FOLD[c] ?? '?');
}

/** The report as plain lines for the PDF appendix (unwrapped; the page wraps them). */
export function rulesReportLines(entries: readonly RuleReportEntry[]): string[] {
  const lines: string[] = [];
  for (const e of entries) {
    const tag = e.status === 'met' ? 'MET' : e.status === 'broken' ? 'BROKEN' : 'NOT CHECKED';
    lines.push(pdfSafe(`[${tag}] ${e.label}`));
    if (e.status === 'not checked') lines.push('    rule from a newer NexMap');
    if (e.detail) lines.push(pdfSafe(`    ${e.detail}`));
    for (const o of e.offenders) lines.push(pdfSafe(`    - ${o.name}: ${o.reason}`));
  }
  return lines;
}
