/**
 * Unique-label helper. Keeps summoned devices and carved subnets from piling up
 * identical names ("Server", "Server", "Server") without numbering things that
 * don't need it.
 */
import type { Device } from './types';
import { defaultDeviceName } from './schema';

/**
 * `base` if it's free, otherwise `base 2`, `base 3`, … — the first suffix not
 * already in `taken`. The first of a kind stays unnumbered; duplicates count up.
 */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!set.has(candidate)) return candidate;
  }
}

/** A planned rename: give `deviceId` the new, now-distinct `name`. */
export interface RenameAssignment {
  deviceId: string;
  name: string;
}

/**
 * The first name of the form `base`, `base 2`, `base 3`, … that is free in
 * `takenLower` (a set of lower-cased names in use), then records it there. The
 * membership test is case-insensitive on purpose — validate.ts keys duplicate
 * names on `name.trim().toLowerCase()`, so a case-sensitive check could "resolve"
 * one clash while minting another (e.g. handing back "Core 2" over "core 2").
 */
function claimName(base: string, takenLower: Set<string>): string {
  let next = base;
  for (let k = 2; takenLower.has(next.toLowerCase()); k++) next = `${base} ${k}`;
  takenLower.add(next.toLowerCase());
  return next;
}

/** Lower-cased pool of every non-blank device name currently in use. */
function namesInUse(devices: readonly Device[]): Set<string> {
  const taken = new Set<string>();
  for (const d of devices) {
    const n = d.name.trim().toLowerCase();
    if (n) taken.add(n);
  }
  return taken;
}

/**
 * Conductor: resolve devices that share a name. For each clashing group the
 * lowest-id device keeps its name and the rest are numbered ("Core" → "Core 2",
 * "Core 3", …) so every name becomes distinct — clearing validate.ts's
 * `duplicate-name` warning.
 *
 * The grouping is case-insensitive to match validate.ts's duplicate-name check
 * exactly (it keys on `name.trim().toLowerCase()`); `claimName` keeps the
 * numbering case-insensitive for the same reason. Blank names are left alone —
 * an empty name is the separate `device-no-name` nudge, not a duplicate.
 */
export function planDeduplicateNames(devices: readonly Device[]): RenameAssignment[] {
  const groups = new Map<string, Device[]>();
  for (const d of devices) {
    const key = d.name.trim().toLowerCase();
    if (!key) continue;
    const g = groups.get(key);
    if (g) g.push(d);
    else groups.set(key, [d]);
  }
  const takenLower = namesInUse(devices);
  const assignments: RenameAssignment[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // Lowest id keeps its name; the rest are re-numbered off their own base.
    for (const d of sorted.slice(1)) {
      assignments.push({ deviceId: d.id, name: claimName(d.name.trim(), takenLower) });
    }
  }
  assignments.sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0));
  return assignments;
}

/**
 * Conductor: give every blank-named device a sensible label — its type's default
 * name ("Switch", "Server", …), numbered so the batch stays distinct ("Switch",
 * "Switch 2") and never collides with a name already on the board. Clears
 * validate.ts's `device-no-name` warning without ever creating a duplicate-name
 * one. Named devices (even oddly named ones) are left untouched; naming is the
 * user's call, and this only fills true blanks.
 */
export function planNameDevices(devices: readonly Device[]): RenameAssignment[] {
  const takenLower = namesInUse(devices);
  const assignments: RenameAssignment[] = [];
  // Deterministic order so the numbering is stable run to run.
  const blanks = devices
    .filter((d) => !d.name.trim())
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const d of blanks) {
    assignments.push({ deviceId: d.id, name: claimName(defaultDeviceName(d.type), takenLower) });
  }
  return assignments;
}
