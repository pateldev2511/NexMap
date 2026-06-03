import { memo } from 'react';
import type { Device } from '@/model/types';
import { deviceVisual, LOD_GLYPH_ONLY, LOD_LABEL_HIDE } from './deviceVisuals';
import styles from './Canvas.module.css';

interface DeviceNodeProps {
  device: Device;
  selected: boolean;
  /** Current zoom — drives level-of-detail (DA-DES-3.4). */
  scale: number;
  /** Highlighted as a valid drop target while connecting. */
  validTarget?: boolean;
  /** Carries an error/critical validation issue → badge. */
  hasIssue?: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
}

const LOCK_GLYPH = '\u{1F512}';

/**
 * One device. Memoized so panning (which changes only the parent transform)
 * doesn't re-render every node. LOD hides the name label when zoomed out, which
 * is both a legibility and a paint-cost win at scale.
 */
function DeviceNodeImpl({
  device,
  selected,
  scale,
  validTarget,
  hasIssue,
  onPointerDown,
}: DeviceNodeProps) {
  const visual = deviceVisual(device.type);
  const showLabel = scale >= LOD_LABEL_HIDE;
  const detailed = scale >= LOD_GLYPH_ONLY;
  const { width, height } = device;

  return (
    <g
      className={`${styles.node} ${selected ? styles.selected : ''} ${
        validTarget ? styles.validTarget : ''
      }`}
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
      {device.locked && detailed && (
        <text className={styles.lockGlyph} x={width - 2} y={height - 2}>
          {LOCK_GLYPH}
        </text>
      )}
      {/* Validation badge — color + glyph (non-color indicator, DA-DES-6.2). */}
      {hasIssue && detailed && (
        <g className={styles.issueBadge} transform={`translate(${width - 6} -6)`}>
          <circle r={7} />
          <text y={0.5}>!</text>
        </g>
      )}
    </g>
  );
}

export const DeviceNode = memo(DeviceNodeImpl);
