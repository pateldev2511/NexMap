/**
 * Screen-reader announcement channel (M3): severity color always pairs with
 * a non-color signal, and transient canvas feedback (rejected drops) must
 * outlive its flash for assistive tech. ValidationAnnouncer's polite live
 * region listens for this event.
 */
export const ANNOUNCE_EVENT = 'nexmap:announce';

export function announce(text: string): void {
  window.dispatchEvent(new CustomEvent(ANNOUNCE_EVENT, { detail: text }));
}
