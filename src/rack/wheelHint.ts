/**
 * One-time "scroll now pans" hint for the rack wheel flip (behavior change #1
 * of the pointer-native plan). Only RETURNING users see it — they are the
 * ones whose muscle memory the change breaks; a fresh install has no habit to
 * migrate. "Returning" = localStorage had ANY prior NexMap state when this
 * module first loaded (before this session wrote anything).
 */
import { readPref, storedPrefCount, writePref } from '@/lib/prefs';

// Through the guarded prefs layer: a blocked localStorage throws even on access.
const hadPriorState = storedPrefCount() > 0;

const FLAG = 'nexmap.hint.rackWheelPan';

/** True exactly once, and only for returning users. Marks the flag either way. */
export function consumeRackWheelHint(): boolean {
  if (readPref(FLAG)) return false;
  writePref(FLAG, '1');
  return hadPriorState;
}

export const RACK_WHEEL_HINT_EVENT = 'nexmap:rack-wheel-hint';
export const RACK_WHEEL_HINT_TEXT =
  'Scroll now pans — restore scroll-to-zoom in Settings';
