/**
 * Search ranking for the command palette. Pure and component-free (so it's
 * testable, and CommandPalette.tsx keeps exporting only its component).
 *
 * Matching stays forgiving — a loose in-order subsequence still counts — but
 * results are RANKED so that what you typed literally wins: typing "restore"
 * should land on "Restore 1 declared rule", not on "Add a redundant twin…" just
 * because r‑e‑s‑t‑o‑r‑e happens to appear in it in order.
 */

/** Subsequence fuzzy match: every char of `q` appears in order within `text`. */
export function fuzzy(text: string, q: string): boolean {
  let i = 0;
  for (const ch of text) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return q.length === 0;
}

const isWordChar = (ch: string | undefined) => !!ch && /[a-z0-9]/i.test(ch);

/**
 * How well a command matches `q` (already trimmed + lower-cased); lower is
 * better, null means no match. Tiers:
 *   0 label starts with q · 1 q starts a word in the label · 2 q anywhere in
 *   the label · 3 q in the hint · 4 loose in-order subsequence of the label.
 */
export function matchScore(label: string, hint: string | undefined, q: string): number | null {
  const l = label.toLowerCase();
  if (l.startsWith(q)) return 0;
  for (let i = l.indexOf(q); i !== -1; i = l.indexOf(q, i + 1)) {
    if (!isWordChar(l[i - 1])) return 1;
  }
  if (l.includes(q)) return 2;
  if (hint?.toLowerCase().includes(q)) return 3;
  if (fuzzy(l, q)) return 4;
  return null;
}

/**
 * Filter + rank commands for a query. Empty query returns the list untouched;
 * otherwise matches are ordered by score, ties keeping their original order.
 */
export function rankCommands<T extends { label: string; hint?: string }>(
  commands: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...commands];
  const scored: { c: T; s: number; i: number }[] = [];
  commands.forEach((c, i) => {
    const s = matchScore(c.label, c.hint, q);
    if (s !== null) scored.push({ c, s, i });
  });
  scored.sort((a, b) => a.s - b.s || a.i - b.i);
  return scored.map((x) => x.c);
}
