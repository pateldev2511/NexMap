/**
 * Generated document-block content (schema v4): title blocks and legends are just
 * ordinary callouts whose `blocks` are produced here from project / rack / cable
 * data. Snapshot at generation, then freely editable — a "Regenerate" action calls
 * these again. Pure + deterministic (dates are passed in, never read from a clock).
 */
import type { CalloutBlock } from './types';

export interface TitleBlockInput {
  projectName: string;
  /** Rack name, when the title block is scoped to one rack elevation. */
  rackName?: string;
  /** Pre-formatted date string (caller supplies — keeps this pure). */
  date: string;
  deviceCount?: number;
  revision?: string;
}

/** Heading = project, then rack / date / device count / revision as body lines. */
export function titleBlockBlocks(input: TitleBlockInput): CalloutBlock[] {
  const blocks: CalloutBlock[] = [
    { kind: 'heading', spans: [{ text: input.projectName || 'Untitled' }] },
  ];
  if (input.rackName) blocks.push({ kind: 'subheading', spans: [{ text: input.rackName }] });
  const lines: string[] = [`Date: ${input.date}`];
  if (input.deviceCount != null) {
    lines.push(`Devices: ${input.deviceCount}`);
  }
  lines.push(`Rev: ${input.revision ?? 'A'}`);
  for (const line of lines) blocks.push({ kind: 'paragraph', spans: [{ text: line }] });
  return blocks;
}

export interface LegendEntry {
  color: string;
  label: string;
}

/**
 * Collapse cables to distinct colors, joining the labels seen for each. Unlabeled
 * cables contribute "(unlabeled)". Sorted by color for a stable legend.
 */
export function legendEntries(cables: { color: string; label?: string }[]): LegendEntry[] {
  const byColor = new Map<string, Set<string>>();
  for (const c of cables) {
    const set = byColor.get(c.color) ?? new Set<string>();
    set.add(c.label?.trim() || '(unlabeled)');
    byColor.set(c.color, set);
  }
  return [...byColor.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([color, labels]) => ({ color, label: [...labels].join(', ') }));
}

/**
 * Legend callout: a heading + one bullet per distinct color. The color hex leads
 * each line so it's identifiable in a text-only callout (swatch chips would need a
 * renderer change — a documented future refinement).
 */
export function legendBlocks(entries: LegendEntry[]): CalloutBlock[] {
  if (entries.length === 0) {
    return [
      { kind: 'heading', spans: [{ text: 'Legend' }] },
      { kind: 'paragraph', spans: [{ text: 'No cables to describe.' }] },
    ];
  }
  return [
    { kind: 'heading', spans: [{ text: 'Legend' }] },
    {
      kind: 'bullets',
      items: entries.map((e) => [
        { text: `${e.color} `, marks: ['code'] as const },
        { text: e.label },
      ]),
    },
  ];
}
