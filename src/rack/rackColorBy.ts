/**
 * Color-by-attribute for the multi-rack overview (schema v3). 'gear' is the default
 * realistic art; the others tint each device by a single attribute so you can scan a fleet
 * by lifecycle or owner at a glance. Pure + deterministic — same input, same color.
 */
import type { Device } from '@/model/types';

export type ColorByMode = 'gear' | 'status' | 'owner';

export const COLOR_BY_MODES: { value: ColorByMode; label: string }[] = [
  { value: 'gear', label: 'Gear (realistic)' },
  { value: 'status', label: 'Status' },
  { value: 'owner', label: 'Owner' },
];

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

/** The tint for a device under a color-by mode, or null when it shouldn't be tinted. */
export function deviceColorBy(device: Device, mode: ColorByMode): string | null {
  if (mode === 'status') return STATUS_COLORS[device.status ?? 'active'] ?? STATUS_COLORS.active!;
  if (mode === 'owner') return device.owner ? colorForString(device.owner) : null;
  return null;
}

/** Distinct {value,color} legend entries present in the given devices for a mode. */
export function colorByLegend(devices: Device[], mode: ColorByMode): { value: string; color: string }[] {
  if (mode === 'gear') return [];
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
