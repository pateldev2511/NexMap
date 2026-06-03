import { memo } from 'react';
import type { Device } from '@/model/types';
import { deviceVisual, LOD_GLYPH_ONLY, LOD_LABEL_HIDE } from './deviceVisuals';
import styles from './Canvas.module.css';

interface DeviceNodeProps {
  device: Device;
  selected: boolean;
  /** Current zoom — drives level-of-detail (DA-DES-3.4). */
  scale: number;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
}

/**
 * One device. Memoized so panning (which changes only the parent transform)
 * doesn't re-render every node. LOD hides the name label when zoomed out, which
 * is both a legibility and a paint-cost win at scale.
 */
function DeviceNodeImpl({ device, selected, scale, onPointerDown }: DeviceNodeProps) {
  const visual = deviceVisual(device.type);
  const showLabel = scale >= LOD_LABEL_HIDE;
  const detailed = scale >= LOD_GLYPH_ONLY;
  const { width, height } = device;

  return (
    <g
      className={`${styles.node} ${selected ? styles.selected : ''}`}
      transform={`translate(${device.x} ${device.y})`}
      onPointerDown={(e) => onPointerDown(e, device.id)}
      data-id={device.id}
    >
      <rect className={styles.body} width={width} height={height} rx={6} />
      {detailed && (
        <rect className={styles.accent} x={4} y={4} width={18} height={height - 8} rx={3} fill={visual.accent} />
      )}
      <text className={styles.glyph} x={detailed ? 13 : width / 2} y={height / 2}>
        {visual.glyph}
      </text>
      {showLabel && (
        <text className={styles.label} x={width / 2} y={height + 4}>
          {device.name}
        </text>
      )}
    </g>
  );
}

export const DeviceNode = memo(DeviceNodeImpl);
