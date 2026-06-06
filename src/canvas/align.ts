/**
 * Alignment snapping ("smart guides"): while dragging, snap the moving
 * selection's edges/centers to nearby static objects' edges/centers, and report
 * guide lines to draw. Pure and standalone so it's unit-testable and never drags
 * React or the store in.
 *
 * The store calls {@link computeAlignSnap} during a drag with the *proposed*
 * (unsnapped) bounding box of the selection plus the boxes of nearby static
 * objects. It returns an (adjX, adjY) nudge that lands the closest edge pair
 * exactly together, and the guide segments to render. If no edge is within
 * threshold on an axis, that axis reports `adj: null` and the caller falls back
 * to grid snapping.
 */
import type { Box } from '@/lib/spatial-index';

export interface AlignGuide {
  axis: 'x' | 'y';
  /** Canvas coordinate of the guide line (x for vertical, y for horizontal). */
  pos: number;
  /** Extent of the guide along the perpendicular axis. */
  start: number;
  end: number;
}

export interface AlignSnap {
  /** Nudge to apply on each axis to land the aligned edges exactly, or null. */
  adjX: number | null;
  adjY: number | null;
  guides: AlignGuide[];
}

function edgesX(b: Box): number[] {
  return [b.x, b.x + b.width / 2, b.x + b.width];
}
function edgesY(b: Box): number[] {
  return [b.y, b.y + b.height / 2, b.y + b.height];
}

interface Match {
  adj: number;
  pos: number;
  /** The static box that matched, for computing the guide extent. */
  other: Box;
}

/** Best edge match on one axis: smallest |static - moving| under threshold. */
function bestMatch(
  movingEdges: number[],
  statics: Box[],
  edgesOf: (b: Box) => number[],
  threshold: number,
): Match | null {
  let best: Match | null = null;
  for (const s of statics) {
    for (const se of edgesOf(s)) {
      for (const me of movingEdges) {
        const d = se - me;
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.adj))) {
          best = { adj: d, pos: se, other: s };
        }
      }
    }
  }
  return best;
}

/**
 * @param moving   proposed bounding box of the dragged selection
 * @param statics  bounding boxes of nearby objects NOT being dragged
 * @param threshold max edge distance (in canvas units) that counts as a snap
 */
export function computeAlignSnap(
  moving: Box,
  statics: Box[],
  threshold: number,
): AlignSnap {
  const guides: AlignGuide[] = [];
  if (statics.length === 0) return { adjX: null, adjY: null, guides };

  const mx = bestMatch(edgesX(moving), statics, edgesX, threshold);
  const my = bestMatch(edgesY(moving), statics, edgesY, threshold);

  const adjX = mx ? mx.adj : null;
  const adjY = my ? my.adj : null;

  // Build guide extents using the *snapped* moving box so the line reaches it.
  const snapped: Box = { ...moving, x: moving.x + (adjX ?? 0), y: moving.y + (adjY ?? 0) };
  if (mx) {
    guides.push({
      axis: 'x',
      pos: mx.pos,
      start: Math.min(snapped.y, mx.other.y),
      end: Math.max(snapped.y + snapped.height, mx.other.y + mx.other.height),
    });
  }
  if (my) {
    guides.push({
      axis: 'y',
      pos: my.pos,
      start: Math.min(snapped.x, my.other.x),
      end: Math.max(snapped.x + snapped.width, my.other.x + my.other.width),
    });
  }
  return { adjX, adjY, guides };
}

// ── Equal-spacing snap (Stage 4) ────────────────────────────────────────────
//
// While dragging, snap so the moving box sits at a gap EQUAL to a gap that already
// exists between other boxes — the "distribute as you drag" feel. Two patterns per
// axis, needing ≥3 reference boxes total (moving + 2 statics):
//   • extend a sequence: two statics with gap g → place moving outside with the same g
//   • center between two flanking statics → equal gaps on both sides
// Pure; the store calls it on axes that alignment snapping didn't already claim.

export interface SpacingSnap {
  adjX: number | null;
  adjY: number | null;
}

function spacingAdjForAxis(
  moving: Box,
  statics: Box[],
  threshold: number,
  axis: 'x' | 'y',
): number | null {
  const lo = (b: Box) => (axis === 'x' ? b.x : b.y);
  const hi = (b: Box) => (axis === 'x' ? b.x + b.width : b.y + b.height);
  const size = axis === 'x' ? moving.width : moving.height;
  const mLo = lo(moving);
  const mHi = hi(moving);

  if (statics.length < 2) return null;
  const sorted = [...statics].sort((a, b) => lo(a) - lo(b));
  const targets: number[] = []; // candidate target `lo` positions for the moving box

  // Extend an existing gap to the outside of either end of each consecutive pair.
  for (let i = 0; i + 1 < sorted.length; i++) {
    const g = lo(sorted[i + 1]!) - hi(sorted[i]!);
    if (g < 0) continue;
    targets.push(hi(sorted[i + 1]!) + g); // after the right box, same gap
    targets.push(lo(sorted[i]!) - g - size); // before the left box, same gap
  }

  // Center between the nearest static on each side of the moving box.
  let left: Box | null = null;
  let right: Box | null = null;
  for (const s of sorted) {
    if (hi(s) <= mLo && (!left || hi(s) > hi(left))) left = s;
    if (lo(s) >= mHi && (!right || lo(s) < lo(right))) right = s;
  }
  if (left && right) {
    const equalGap = (lo(right) - hi(left) - size) / 2;
    if (equalGap >= 0) targets.push(hi(left) + equalGap);
  }

  let best: number | null = null;
  for (const t of targets) {
    const d = t - mLo;
    if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) {
      best = d;
    }
  }
  return best;
}

/**
 * Equal-spacing nudge for the moving box against nearby static boxes. Returns a per-axis
 * adjustment (or null) — the caller should only use an axis where alignment didn't snap.
 */
export function computeSpacingSnap(
  moving: Box,
  statics: Box[],
  threshold: number,
): SpacingSnap {
  if (statics.length < 2) return { adjX: null, adjY: null };
  return {
    adjX: spacingAdjForAxis(moving, statics, threshold, 'x'),
    adjY: spacingAdjForAxis(moving, statics, threshold, 'y'),
  };
}
