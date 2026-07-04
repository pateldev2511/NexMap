/**
 * One-time "scroll now pans" hint for the rack wheel flip (behavior change #1
 * of the pointer-native plan). Only RETURNING users see it — they are the
 * ones whose muscle memory the change breaks; a fresh install has no habit to
 * migrate. "Returning" = localStorage had ANY prior NexMap state when this
 * module first loaded (before this session wrote anything).
 */
const hadPriorState =
  typeof localStorage !== 'undefined' &&
  (() => {
    try {
      return localStorage.length > 0;
    } catch {
      return false;
    }
  })();

const FLAG = 'nexmap.hint.rackWheelPan';

/** True exactly once, and only for returning users. Marks the flag either way. */
export function consumeRackWheelHint(): boolean {
  try {
    if (localStorage.getItem(FLAG)) return false;
    localStorage.setItem(FLAG, '1');
    return hadPriorState;
  } catch {
    return false;
  }
}

export const RACK_WHEEL_HINT_EVENT = 'nexmap:rack-wheel-hint';
export const RACK_WHEEL_HINT_TEXT =
  'Scroll now pans — restore scroll-to-zoom in Settings';
