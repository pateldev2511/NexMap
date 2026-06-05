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
