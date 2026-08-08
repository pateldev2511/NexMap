/**
 * Port coupling integrity (schema v5) — pure, model layer.
 *
 * A patch panel's front jack and its rear punchdown are one physical circuit,
 * modelled as two `Interface`s joined by a symmetric `throughTo` pair. This module
 * owns the rules for what a SOUND coupling is.
 *
 * It lives in `model/` rather than `rack/` because `Interface.throughTo` is a model
 * concept and `model/validate.ts` needs these rules — `model/` is the base layer and
 * must never import from `rack/`. The trace engine (`rack/cableTrace.ts`) consumes
 * `coupledPartner` from here.
 *
 * Faults are REPORTED, never repaired: choosing which half of an asymmetric pair to
 * believe would silently rewire the user's documentation.
 */
import type { Device, Interface } from './types';

export type CouplingFault = 'self' | 'missing' | 'cross-device' | 'asymmetric';

export interface CouplingProblem {
  kind: CouplingFault;
  deviceId: string;
  ifaceId: string;
  /** The offending `throughTo` value. */
  targetId: string;
}

function ifaceOf(device: Device | undefined, ifaceId: string): Interface | undefined {
  return device?.interfaces?.find((i) => i.id === ifaceId);
}

/**
 * The port internally coupled to `iface` on the SAME device, or undefined when the
 * coupling is absent or malformed.
 *
 * Rejects, in order: no `throughTo` (E8 — an unpaired port is normal, not an error);
 * self-reference (E4); a target absent from this device, which covers both a
 * cross-device id and a dangling one (E2/E3); and a partner that does not point back
 * (E1). Every rejection means "no coupling here", so a trace ends honestly instead of
 * inventing a hop.
 */
export function coupledPartner(device: Device, iface: Interface): Interface | undefined {
  const target = iface.throughTo;
  if (!target || target === iface.id) return undefined;
  const partner = ifaceOf(device, target);
  if (!partner) return undefined;
  if (partner.throughTo !== iface.id) return undefined;
  return partner;
}

/** True when this port has a sound, symmetric pass-through partner. */
export function isCoupled(device: Device, iface: Interface): boolean {
  return coupledPartner(device, iface) !== undefined;
}

/**
 * Structural faults in `throughTo` wiring across all devices.
 *
 * One issue per UNRECIPROCATED CLAIM. A sound pair reports nothing; a three-way
 * mis-pointing (A→B→C→A) legitimately reports three, because all three claims are
 * individually wrong.
 */
export function couplingProblems(devices: readonly Device[]): CouplingProblem[] {
  // Global port index, so a `throughTo` aimed at another device is distinguishable
  // from one aimed at nothing at all.
  const owner = new Map<string, string>();
  for (const d of devices) {
    for (const i of d.interfaces ?? []) owner.set(i.id, d.id);
  }

  const out: CouplingProblem[] = [];
  for (const d of devices) {
    const local = new Map((d.interfaces ?? []).map((i) => [i.id, i]));
    for (const i of d.interfaces ?? []) {
      const target = i.throughTo;
      if (!target) continue; // E8: unpaired is normal.
      const base = { deviceId: d.id, ifaceId: i.id, targetId: target };
      if (target === i.id) {
        out.push({ ...base, kind: 'self' });
        continue;
      }
      const partner = local.get(target);
      if (!partner) {
        // E2 vs E3: does the id exist on another device, or nowhere at all?
        out.push({ ...base, kind: owner.has(target) ? 'cross-device' : 'missing' });
        continue;
      }
      if (partner.throughTo !== i.id) out.push({ ...base, kind: 'asymmetric' });
    }
  }
  return out;
}
