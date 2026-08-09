/**
 * Power ports — pure, model layer.
 *
 * A UPS or PDU outlet is a real, cablable port: documenting which feed a device is
 * corded into is ordinary infrastructure work. But a power run is NOT part of the
 * logical topology — nobody draws mains in a network diagram — so the physical/
 * logical reconciler must not report every power cable as "cabled, not documented".
 * That is what this module exists to decide.
 *
 * Lives in `model/` because `model/validate.ts` and `rack/reconcile.ts` both need it
 * and the model layer must never import from `rack/` (see model/coupling.ts).
 */
import type { Device, DeviceType, Interface } from './types';

/**
 * Connector families that carry mains rather than data. Matched case-insensitively
 * as a substring, so "C13", "IEC C13" and "c13/c14" all read as power.
 */
export const POWER_MEDIA: readonly string[] = [
  'c13',
  'c14',
  'c19',
  'c20',
  'iec',
  'nema',
  'schuko',
  'outlet',
  'mains',
];

export function isPowerMedia(kind: string | undefined): boolean {
  if (!kind) return false;
  const k = kind.toLowerCase();
  return POWER_MEDIA.some((m) => k.includes(m));
}

/** Device types whose ports are outlets rather than data jacks. */
export function isPowerDevice(type: DeviceType): boolean {
  return type === 'ups';
}

/**
 * Is this port an outlet?
 *
 * An explicit media wins, so a UPS's network-management ethernet port (kind "RJ45")
 * is correctly treated as DATA and its outlets as power. With no media set, fall back
 * to the device type — which is what existing projects have, since the PDU/UPS
 * library presets never set `kind`.
 */
export function isPowerPort(device: Device, iface: Interface): boolean {
  if (iface.kind) return isPowerMedia(iface.kind);
  return isPowerDevice(device.type);
}

/** The media string stamped on generated outlets, so intent survives a round-trip. */
export const DEFAULT_OUTLET_MEDIA = 'C13';

/**
 * True when a cable joins a power port to a data port — physically impossible, and
 * usually a mis-drag onto a neighbouring jack. Reported by validation rather than
 * refused, matching how the app treats other modelling mistakes.
 */
export function isPowerDataMismatch(
  a: { device: Device; iface: Interface },
  b: { device: Device; iface: Interface },
): boolean {
  return isPowerPort(a.device, a.iface) !== isPowerPort(b.device, b.iface);
}
