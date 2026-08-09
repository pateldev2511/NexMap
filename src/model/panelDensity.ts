/**
 * Physical port density of 19" rack panels — pure, model layer.
 *
 * These are facts about HARDWARE, not about drawing, which is why they live here
 * rather than in `rack/faceZones.ts`: `model/validate.ts` needs them, and the model
 * layer must never import from `rack/` (the same rule recorded in model/coupling.ts).
 */
/**
 * Keystone jacks that physically fit across one 19" panel row.
 *
 * A 19" panel has ~450mm of usable width and a keystone pitch is ~15.5mm, so ~29
 * fit in theory and 24 is the universal real-world density (Panduit, Leviton,
 * Tripp Lite all ship 24-per-U). 48 in a single row would need ~744mm — it does
 * not exist as hardware, and the old hardcoded `rows: 1` drew it anyway at ~6.4mm
 * per jack, under half a real keystone.
 */
export const PORTS_PER_PANEL_ROW = 24;

/** Rows a patch panel needs for `ports`, derived from physical density. */
export function patchPanelRows(ports: number): number {
  return Math.max(1, Math.ceil(ports / PORTS_PER_PANEL_ROW));
}

/**
 * How many keystone rows a chassis of `ruSpan` U can physically carry. One row per
 * U: a 1U panel is 24 ports, a 2U panel 48.
 */
export function patchPanelRowCapacity(ruSpan: number): number {
  return Math.max(1, Math.floor(ruSpan));
}

/**
 * True when a patch panel is asked to carry more ports than its height allows —
 * e.g. 48 ports in 1U. Reported by validation rather than silently redrawn,
 * because existing saved projects contain exactly this and their gear must not be
 * moved without the user asking.
 */
export function patchPanelOverCapacity(ports: number, ruSpan: number): boolean {
  return patchPanelRows(ports) > patchPanelRowCapacity(ruSpan);
}
