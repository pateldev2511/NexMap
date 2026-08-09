/**
 * Zoom-tiered level of detail for the unified rack canvas (W6) — pure, no React.
 *
 * One canvas has to serve three jobs that want different drawings:
 *   far  — "where is everything?"      rack outlines + utilisation, no faceplate art
 *   mid  — "what is in this rack?"     faceplates, no individual ports
 *   near — "which port goes where?"    ports, labels, inline cabling
 *
 * HYSTERESIS IS THE WHOLE POINT (edge case E19). A single threshold per boundary
 * makes the drawing flicker while a user rests at the boundary or pinches gently:
 * one pixel of wheel jitter flips the tier, re-renders every device, and the canvas
 * strobes. So each boundary has a SEPARATE enter and exit threshold, and the tier
 * depends on where you came from as well as the current scale. Between the two
 * thresholds is a dead band where nothing changes.
 *
 * Kept pure and separate from the renderer so the dead band is provable by test
 * rather than eyeballed at a zoom slider.
 */

export type LodTier = 'far' | 'mid' | 'near';

/**
 * Boundary pairs. `*Enter` is always ABOVE `*Exit`: you need to zoom in past the
 * enter threshold to gain detail, and back out past the lower exit threshold to
 * lose it again.
 *
 * Values chosen against the rack geometry in rackLayout.ts (U_PX = 30): at ~0.5
 * scale a 1U faceplate is ~15px tall — enough to read as a box, not enough for
 * port art; by ~1.15 a jack is a comfortably clickable target.
 */
export const LOD = {
  midEnter: 0.55,
  midExit: 0.45,
  nearEnter: 1.15,
  nearExit: 1.0,
} as const;

/**
 * The tier for a scale with NO history — used on first render and after a
 * fit-to-screen, where there is no previous tier to be sticky about. Uses the
 * `enter` thresholds so a fresh view never starts in a state it could not have
 * reached by zooming in.
 */
export function initialLodTier(scale: number): LodTier {
  if (scale >= LOD.nearEnter) return 'near';
  if (scale >= LOD.midEnter) return 'mid';
  return 'far';
}

/**
 * The tier for `scale`, given the tier currently displayed.
 *
 * Total and idempotent: calling it with its own output and an unchanged scale
 * always returns that same tier — which is exactly what stops the flicker.
 */
export function lodTier(scale: number, prev: LodTier): LodTier {
  switch (prev) {
    case 'far':
      // Only gaining detail from here, and only past the (higher) enter thresholds.
      if (scale >= LOD.nearEnter) return 'near';
      if (scale >= LOD.midEnter) return 'mid';
      return 'far';
    case 'mid':
      if (scale >= LOD.nearEnter) return 'near';
      // Losing detail needs the (lower) exit threshold — the dead band.
      if (scale < LOD.midExit) return 'far';
      return 'mid';
    case 'near':
      if (scale >= LOD.nearExit) return 'near';
      // Dropped out of near; it may have fallen far enough to skip mid entirely.
      if (scale < LOD.midExit) return 'far';
      return 'mid';
  }
}

/** Faceplate art is drawn from mid upward; far draws a cheap outline instead. */
export function showsFaceplates(tier: LodTier): boolean {
  return tier !== 'far';
}

/**
 * Individual ports are drawn ONLY at near. Below that a jack is a couple of pixels
 * wide, so drawing it is a lie about how precisely you can aim.
 */
export function showsPorts(tier: LodTier): boolean {
  return tier === 'near';
}

/**
 * Whether a pointer may resolve to a PORT (edge case E20).
 *
 * Deliberately the same predicate as `showsPorts`, and deliberately a separate
 * exported function so the intent is explicit: hit-testing is SUPPRESSED, not
 * merely visually hidden. Letting an invisible 2px target win over the device body
 * would make dragging a device at low zoom randomly start a cable instead.
 */
export function portsHittable(tier: LodTier): boolean {
  return showsPorts(tier);
}

/** Utilisation heat replaces detail at far, where a whole row is on screen. */
export function showsUtilisation(tier: LodTier): boolean {
  return tier === 'far';
}
