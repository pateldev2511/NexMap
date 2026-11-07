/**
 * Color-by-attribute for the multi-rack overview (schema v3). 'gear' is the default
 * realistic art; the others tint each device by a single attribute so you can scan a fleet
 * by lifecycle or owner at a glance. Pure + deterministic — same input, same color.
 */
import type { Device } from '@/model/types';
import type { FeedFailure } from './powerCords';

/** 'fail-a' / 'fail-b' tint what a feed failure takes down (see feedFailure). */
export type ColorByMode = 'gear' | 'status' | 'owner' | 'fail-a' | 'fail-b';

export const COLOR_BY_MODES: { value: ColorByMode; label: string }[] = [
  { value: 'gear', label: 'Gear (realistic)' },
  { value: 'status', label: 'Status' },
  { value: 'owner', label: 'Owner' },
  { value: 'fail-a', label: 'If feed A fails' },
  { value: 'fail-b', label: 'If feed B fails' },
];

/** The feed a failure mode fails, or null for an attribute mode. */
export function failedFeed(mode: ColorByMode): 'A' | 'B' | null {
  return mode === 'fail-a' ? 'A' : mode === 'fail-b' ? 'B' : null;
}

export const FAILURE_COLORS = {
  dark: '#ef4444',
  trips: '#f97316',
  deadStrip: '#64748b',
  up: '#10b981',
};

function failureTint(id: string, f: FeedFailure): string | null {
  if (f.dark.has(id)) return FAILURE_COLORS.dark;
  if (f.trippedPdus.has(id) || f.overloadedUps.has(id)) return FAILURE_COLORS.trips;
  if (f.deadSources.has(id)) return FAILURE_COLORS.deadStrip;
  if (f.up.has(id)) return FAILURE_COLORS.up;
  return null;
}

export const STATUS_COLORS: Record<string, string> = {
  planned: '#3b82f6',
  active: '#10b981',
  maintenance: '#f59e0b',
  decommissioned: '#ef4444',
};

/** A stable, distinct color for an arbitrary string (owner, team, …). */
const PALETTE = ['#2563eb', '#0d9488', '#dc2626', '#f59e0b', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#ea580c', '#475569'];
export function colorForString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/**
 * The tint for a device under a color-by mode, or null when it shouldn't be tinted. A
 * failure mode needs the simulated `failure`; passive gear and a rack UPS stay untinted.
 */
export function deviceColorBy(device: Device, mode: ColorByMode, failure?: FeedFailure | null): string | null {
  if (failedFeed(mode)) return failure ? failureTint(device.id, failure) : null;
  if (mode === 'status') return STATUS_COLORS[device.status ?? 'active'] ?? STATUS_COLORS.active!;
  if (mode === 'owner') return device.owner ? colorForString(device.owner) : null;
  return null;
}

/** Distinct {value,color} legend entries present in the given devices for a mode. */
export function colorByLegend(devices: Device[], mode: ColorByMode, failure?: FeedFailure | null): { value: string; color: string }[] {
  if (mode === 'gear') return [];
  if (failedFeed(mode)) {
    if (!failure) return [];
    return [
      { value: 'Loses power', color: FAILURE_COLORS.dark, n: failure.dark.size },
      { value: 'UPS overloads', color: FAILURE_COLORS.trips, n: failure.overloadedUps.size },
      { value: 'Strip trips', color: FAILURE_COLORS.trips, n: failure.trippedPdus.size },
      { value: 'Power down', color: FAILURE_COLORS.deadStrip, n: failure.deadSources.size },
      { value: 'Stays up', color: FAILURE_COLORS.up, n: failure.up.size },
    ].filter((e) => e.n > 0).map(({ value, color }) => ({ value, color }));
  }
  const seen = new Map<string, string>();
  for (const d of devices) {
    if (d.rackId == null) continue;
    const value = mode === 'status' ? (d.status ?? 'active') : (d.owner ?? '');
    if (!value) continue;
    const color = deviceColorBy(d, mode);
    if (color && !seen.has(value)) seen.set(value, color);
  }
  return [...seen.entries()].map(([value, color]) => ({ value, color })).sort((a, b) => a.value.localeCompare(b.value));
}
