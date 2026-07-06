/**
 * "Earned quiet" (M3c): idle chrome demotion only ARMS after the first
 * COMPLETED canvas gesture of the session — a first-time user never watches
 * the UI fade while they are still reading it; quiet is something the
 * session earns by working.
 */
let earned = false;
const listeners = new Set<() => void>();

/** Called by the canvas adapters on every machine 'commit' effect. */
export function markGestureComplete(): void {
  if (earned) return;
  earned = true;
  for (const fn of listeners) fn();
}

export function isQuietEarned(): boolean {
  return earned;
}

export function onQuietEarned(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
