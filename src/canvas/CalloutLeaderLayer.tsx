import { memo } from 'react';
import type { TextObject } from '@/model/types';
import {
  DEFAULT_LEADER,
  leaderDashArray,
  leaderGeometry,
  resolveLeaderTarget,
  type LeaderRect,
  type TargetLookup,
} from '@/model/leader';
import styles from './Canvas.module.css';

interface CalloutLeaderLayerProps {
  texts: TextObject[];
  /** Resolve a device/object id → its scene bbox (null if it no longer exists). */
  lookup: TargetLookup;
  scale: number;
}

/**
 * Scene-space dotted leader lines from each anchored callout to its target. Draws
 * nothing for free notes or dangling anchors (lazy resolution — the box stays).
 * Geometry comes from the shared leaderGeometry() so flat / iso / export match.
 */
function CalloutLeaderLayerImpl({ texts, lookup, scale }: CalloutLeaderLayerProps) {
  const lines: React.ReactNode[] = [];
  for (const o of texts) {
    if (!o.anchor) continue;
    const target = resolveLeaderTarget(o.anchor, lookup);
    if (!target) continue;
    const box: LeaderRect = { x: o.x, y: o.y, width: o.width, height: o.height };
    const g = leaderGeometry(box, target);
    if (!g) continue;
    const style = o.leader ?? DEFAULT_LEADER;
    lines.push(
      <line
        key={o.id}
        className={styles.calloutLeader}
        data-leader-for={o.id}
        x1={g.x1}
        y1={g.y1}
        x2={g.x2}
        y2={g.y2}
        stroke={style.color}
        strokeWidth={style.width / scale}
        strokeDasharray={scaledDash(leaderDashArray(style), scale)}
      />,
    );
  }
  return <g>{lines}</g>;
}

/** Keep the dash pattern visually constant across zoom (it's in scene units). */
function scaledDash(dash: string | undefined, scale: number): string | undefined {
  if (!dash) return undefined;
  return dash
    .split(' ')
    .map((n) => Number(n) / scale)
    .join(' ');
}

export const CalloutLeaderLayer = memo(CalloutLeaderLayerImpl);
