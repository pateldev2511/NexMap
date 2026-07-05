import { memo } from 'react';
import type { Device } from '@/model/types';
import styles from './MiniMap.module.css';

/**
 * The device dots of the MiniMap, split out and memoized (M4f). During a pan
 * or zoom the parent re-renders every frame with a fresh viewRect, but as long
 * as the viewport stays inside the scene's device bounds the projection
 * (k/offX/offY) and the devices array are IDENTICAL — so this whole N-element
 * layer skips re-rendering. It only re-renders when the model changes (new
 * devices array identity via the store rev) or the projection truly shifts
 * (viewport panned beyond the scene, changing the fitted scale).
 */
export const MiniDots = memo(function MiniDots({
  devices,
  k,
  offX,
  offY,
}: {
  devices: Device[];
  k: number;
  offX: number;
  offY: number;
}) {
  if (import.meta.env.MODE === 'test') {
    (globalThis as { __miniDotsRenders?: number }).__miniDotsRenders =
      ((globalThis as { __miniDotsRenders?: number }).__miniDotsRenders ?? 0) + 1;
  }
  return (
    <g>
      {devices.map((d) => (
        <rect
          key={d.id}
          className={styles.node}
          x={d.x * k + offX}
          y={d.y * k + offY}
          width={Math.max(2, d.width * k)}
          height={Math.max(2, d.height * k)}
          rx={1}
        />
      ))}
    </g>
  );
});
