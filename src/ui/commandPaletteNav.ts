/**
 * Keyboard-navigation helpers for the command palette. Pure and component-free
 * so the skip-disabled logic stays testable — and so CommandPalette.tsx exports
 * only its component (react-refresh).
 */

/** First runnable index, or -1 when every command is disabled. */
export function firstSelectable(items: readonly { disabled?: boolean }[]): number {
  return items.findIndex((c) => !c.disabled);
}

/**
 * Step from `from` in `dir` (+1 / -1), skipping disabled commands and clamping
 * at the ends — if nothing runnable lies that way, `from` is kept. Keeps the
 * keyboard highlight from ever landing on an un-runnable row.
 */
export function nextSelectable(
  items: readonly { disabled?: boolean }[],
  from: number,
  dir: 1 | -1,
): number {
  for (let i = from + dir; i >= 0 && i < items.length; i += dir) {
    if (!items[i]!.disabled) return i;
  }
  return from;
}
