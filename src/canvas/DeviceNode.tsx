import { memo } from 'react';
import type { Device } from '@/model/types';
import { NexIcon } from '@/ui/icons/NexIcon';
import { deviceVisual, LOD_GLYPH_ONLY, LOD_LABEL_HIDE } from './deviceVisuals';
import { IsoIcon } from './IsoIcon';
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
  /** Double-click the on-top name label → edit it inline. */
  onLabelDoubleClick?: (e: React.MouseEvent, id: string) => void;
}

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
  onLabelDoubleClick,
}: DeviceNodeProps) {
  const visual = deviceVisual(device.type);
  const showLabel = scale >= LOD_LABEL_HIDE;
  const detailed = scale >= LOD_GLYPH_ONLY;
  const { width, height } = device;
  const cx = width / 2;
  const cy = height / 2 - 1;
  const iconSize = Math.max(22, Math.min(width * 0.72, height * 0.82));

  return (
    <g
      className={`${styles.node} ${selected ? styles.selected : ''} ${
        validTarget ? styles.validTarget : ''
      }`}
      transform={`translate(${device.x} ${device.y})`}
      onPointerDown={(e) => onPointerDown(e, device.id)}
      data-id={device.id}
    >
      <rect className={styles.hitArea} width={width} height={height} rx={8} />
      <ellipse
        className={styles.deviceIconHalo}
        cx={cx}
        cy={cy + iconSize * 0.14}
        rx={iconSize * 0.68}
        ry={iconSize * 0.52}
      />
      {detailed ? (
        <IsoIcon
          type={device.type}
          accent={visual.accent}
          cx={cx}
          cy={cy}
          size={iconSize}
        />
      ) : (
        <text className={styles.glyph} x={cx} y={cy} fill={visual.accent}>
          {visual.glyph}
        </text>
      )}
      {showLabel && (
        <text
          className={styles.labelTop}
          x={cx}
          y={-6}
          onDoubleClick={(e) => onLabelDoubleClick?.(e, device.id)}
        >
          {device.name}
        </text>
      )}
      {device.locked && detailed && (
        <NexIcon
          name="lock"
          className={styles.lockMark}
          size={12}
          x={cx + iconSize * 0.33}
          y={cy + iconSize * 0.22}
        />
      )}
      {/* Validation badge: color plus vector mark for non-color recognition. */}
      {hasIssue && detailed && (
        <g
          className={styles.issueBadge}
          transform={`translate(${cx + iconSize * 0.46} ${cy - iconSize * 0.45})`}
        >
          <circle r={7} />
          <path d="M0 -3.8v4.3" />
          <circle className={styles.issueDot} cx={0} cy={3.4} r={1} />
        </g>
      )}
    </g>
  );
}

export const DeviceNode = memo(DeviceNodeImpl);
