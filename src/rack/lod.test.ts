/**
 * Zoom-tiered LOD (W6). The tests that matter are the hysteresis ones: a single
 * threshold per boundary would make the canvas strobe while a user rests at the
 * boundary (edge case E19), and that is invisible in a screenshot but provable here.
 */
import { describe, expect, it } from 'vitest';
import {
  LOD,
  initialLodTier,
  lodTier,
  portsHittable,
  showsFaceplates,
  showsPorts,
  showsUtilisation,
  type LodTier,
} from './lod';

const TIERS: LodTier[] = ['far', 'mid', 'near'];

describe('threshold sanity', () => {
  it('every enter threshold sits ABOVE its exit threshold', () => {
    // If this ever inverts, the dead band becomes negative and the tier oscillates.
    expect(LOD.midEnter).toBeGreaterThan(LOD.midExit);
    expect(LOD.nearEnter).toBeGreaterThan(LOD.nearExit);
  });

  it('the mid band sits entirely below the near band', () => {
    expect(LOD.midEnter).toBeLessThan(LOD.nearExit);
  });
});

describe('initialLodTier (no history)', () => {
  it('is far when zoomed out', () => {
    expect(initialLodTier(0.1)).toBe('far');
    expect(initialLodTier(LOD.midEnter - 0.01)).toBe('far');
  });

  it('is mid from midEnter up to nearEnter', () => {
    expect(initialLodTier(LOD.midEnter)).toBe('mid');
    expect(initialLodTier(1.0)).toBe('mid');
    expect(initialLodTier(LOD.nearEnter - 0.01)).toBe('mid');
  });

  it('is near at and above nearEnter', () => {
    expect(initialLodTier(LOD.nearEnter)).toBe('near');
    expect(initialLodTier(4)).toBe('near');
  });

  it('uses ENTER thresholds, so a fresh view never starts somewhere unreachable', () => {
    // 1.05 is inside the near dead band. With no history it must read as mid —
    // you have not yet zoomed past nearEnter.
    expect(initialLodTier(1.05)).toBe('mid');
  });
});

describe('gaining detail (zooming in)', () => {
  it('far → mid at midEnter, not before', () => {
    expect(lodTier(LOD.midEnter - 0.001, 'far')).toBe('far');
    expect(lodTier(LOD.midEnter, 'far')).toBe('mid');
  });

  it('mid → near at nearEnter, not before', () => {
    expect(lodTier(LOD.nearEnter - 0.001, 'mid')).toBe('mid');
    expect(lodTier(LOD.nearEnter, 'mid')).toBe('near');
  });

  it('far jumps straight to near on a big zoom', () => {
    expect(lodTier(3, 'far')).toBe('near');
  });
});

describe('losing detail (zooming out)', () => {
  it('near holds until below nearExit', () => {
    expect(lodTier(LOD.nearExit, 'near')).toBe('near');
    expect(lodTier(LOD.nearExit - 0.001, 'near')).toBe('mid');
  });

  it('mid holds until below midExit', () => {
    expect(lodTier(LOD.midExit, 'mid')).toBe('mid');
    expect(lodTier(LOD.midExit - 0.001, 'mid')).toBe('far');
  });

  it('near drops straight to far on a big zoom-out', () => {
    expect(lodTier(0.1, 'near')).toBe('far');
  });
});

describe('the dead band — this is the anti-flicker guarantee', () => {
  it('a scale between midExit and midEnter is STICKY both ways', () => {
    const inBand = (LOD.midExit + LOD.midEnter) / 2;
    // Same scale, two different histories, two different answers. That asymmetry
    // IS the hysteresis; with one threshold both would collapse to the same tier.
    expect(lodTier(inBand, 'far')).toBe('far');
    expect(lodTier(inBand, 'mid')).toBe('mid');
  });

  it('a scale between nearExit and nearEnter is STICKY both ways', () => {
    const inBand = (LOD.nearExit + LOD.nearEnter) / 2;
    expect(lodTier(inBand, 'mid')).toBe('mid');
    expect(lodTier(inBand, 'near')).toBe('near');
  });

  it('resting exactly at a boundary never changes tier twice', () => {
    for (const scale of [LOD.midExit, LOD.midEnter, LOD.nearExit, LOD.nearEnter]) {
      for (const start of TIERS) {
        const once = lodTier(scale, start);
        const twice = lodTier(scale, once);
        expect(twice).toBe(once);
      }
    }
  });
});

describe('property: totality and idempotence over the whole zoom range', () => {
  it('always returns a valid tier and settles in ONE step', () => {
    // MIN_SCALE 0.1 → MAX_SCALE 4 in fine steps, from every possible prior tier.
    for (let scale = 0.1; scale <= 4; scale += 0.005) {
      for (const prev of TIERS) {
        const next = lodTier(scale, prev);
        expect(TIERS).toContain(next);
        // Idempotent: feeding the answer back changes nothing. A renderer that
        // recomputes each frame therefore cannot strobe at a fixed zoom.
        expect(lodTier(scale, next)).toBe(next);
      }
    }
  });

  it('a slow sweep in and back out crosses each boundary exactly ONCE', () => {
    let tier = initialLodTier(0.1);
    let transitions = 0;
    // Zoom all the way in…
    for (let scale = 0.1; scale <= 4; scale += 0.001) {
      const next = lodTier(scale, tier);
      if (next !== tier) transitions += 1;
      tier = next;
    }
    expect(tier).toBe('near');
    expect(transitions).toBe(2); // far→mid, mid→near
    // …and all the way back out.
    for (let scale = 4; scale >= 0.1; scale -= 0.001) {
      const next = lodTier(scale, tier);
      if (next !== tier) transitions += 1;
      tier = next;
    }
    expect(tier).toBe('far');
    expect(transitions).toBe(4); // plus near→mid, mid→far
  });

  it('jitter inside a dead band produces ZERO transitions', () => {
    // Simulates a trackpad resting at the boundary: tiny alternating deltas.
    const centre = (LOD.nearExit + LOD.nearEnter) / 2;
    const halfBand = (LOD.nearEnter - LOD.nearExit) / 2;
    let tier: LodTier = 'near';
    let transitions = 0;
    for (let i = 0; i < 500; i++) {
      const scale = centre + (i % 2 === 0 ? halfBand * 0.9 : -halfBand * 0.9);
      const next = lodTier(scale, tier);
      if (next !== tier) transitions += 1;
      tier = next;
    }
    expect(transitions).toBe(0);
    expect(tier).toBe('near');
  });
});

describe('what each tier draws', () => {
  it('faceplates from mid upward', () => {
    expect(showsFaceplates('far')).toBe(false);
    expect(showsFaceplates('mid')).toBe(true);
    expect(showsFaceplates('near')).toBe(true);
  });

  it('ports only at near', () => {
    expect(showsPorts('far')).toBe(false);
    expect(showsPorts('mid')).toBe(false);
    expect(showsPorts('near')).toBe(true);
  });

  it('utilisation heat only at far', () => {
    expect(showsUtilisation('far')).toBe(true);
    expect(showsUtilisation('mid')).toBe(false);
    expect(showsUtilisation('near')).toBe(false);
  });

  // E20: an invisible 2px target must not beat the device body.
  it('port hit-testing is suppressed exactly where ports are not drawn', () => {
    for (const tier of TIERS) {
      expect(portsHittable(tier)).toBe(showsPorts(tier));
    }
  });
});
