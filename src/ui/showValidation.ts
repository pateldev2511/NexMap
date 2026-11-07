/**
 * Ask the bottom panel to open on Validation with its first finding focused —
 * the guided example's single next step (#47). A tiny module of its own so the
 * first-run screen can ask without pulling the lazy BottomPanel chunk in.
 *
 * The request is held until the panel takes it: the panel may mount after the
 * example loads (its chunk is lazy), so the event alone could be missed.
 */
export const SHOW_VALIDATION_EVENT = 'nexmap:show-validation';

let pending = false;

export function showValidation(): void {
  pending = true;
  window.dispatchEvent(new CustomEvent(SHOW_VALIDATION_EVENT));
}

/** True once per request: the panel calls this on mount and on each event. */
export function takeShowValidation(): boolean {
  const was = pending;
  pending = false;
  return was;
}
