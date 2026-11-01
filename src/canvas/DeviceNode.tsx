import { memo } from 'react';
import type { Device } from '@/model/types';
import { NexIcon } from '@/ui/icons/NexIcon';
import { defaultDeviceName } from '@/model/schema';
import { deviceVisual, LOD_GLYPH_ONLY, LOD_LABEL_HIDE } from './deviceVisuals';
import { FlatIcon } from './FlatIcon';
import { NodeInfoCard } from './NodeInfoCard';
import { HoldsBadge, RuleBadge } from './RuleBadge';
import { clampIconScale, DEFAULT_LABEL_HEIGHT } from './nodeCard';
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
  /** Breaks a declared rule (Conductor invariant) → rule badge. */
  breaksRule?: boolean;
  /** How many met declared rules can't lose this device (0/absent → none). */
  holdsUp?: number;
  /** At least one rule it holds up is enforced (a delete would be blocked). */
  holdsEnforced?: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  /** Double-click the on-top name label → edit it inline. */
  onLabelDoubleClick?: (e: React.MouseEvent, id: string) => void;
  /** Keyboard select (Tab to the node, Enter/Space to select it). */
  onActivate?: (id: string) => void;
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
  breaksRule,
  holdsUp = 0,
  holdsEnforced = false,
  onPointerDown,
  onLabelDoubleClick,
  onActivate,
}: DeviceNodeProps) {
  if (import.meta.env.MODE === 'test') {
    (globalThis as { __deviceNodeRenders?: number }).__deviceNodeRenders =
      ((globalThis as { __deviceNodeRenders?: number }).__deviceNodeRenders ?? 0) + 1;
  }
  const visual = deviceVisual(device.type);
  const typeName = defaultDeviceName(device.type);
  const ariaLabel = `${device.name || typeName}, ${typeName}${
    device.managementIp ? `, ${device.managementIp}` : ''
  }${device.locked ? ', locked' : ''}${breaksRule ? ', breaks a declared rule' : ''}${
    holdsUp > 0 ? (holdsEnforced ? ', holds up an enforced rule' : ', holds up a declared rule') : ''
  }`;
  const showLabel = scale >= LOD_LABEL_HIDE;
  const detailed = scale >= LOD_GLYPH_ONLY;
  const { width, height } = device;
  const cx = width / 2;
  const cy = height / 2 - 1;
  const iconSize =
    Math.max(22, Math.min(width * 0.72, height * 0.82)) * clampIconScale(device.iconScale);

  return (
    <g
      className={`${styles.node} ${selected ? styles.selected : ''} ${
        validTarget ? styles.validTarget : ''
      }`}
      transform={`translate(${device.x} ${device.y})`}
      onPointerDown={(e) => onPointerDown(e, device.id)}
      tabIndex={0}
      role="button"
      aria-label={ariaLabel}
      aria-pressed={selected}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate?.(device.id);
        }
      }}
      data-id={device.id}
    >
      <rect className={styles.hitArea} width={width} height={height} rx={8} />
      <rect
        className={styles.deviceTileHalo}
        x={cx - iconSize / 2 - 3}
        y={cy - iconSize / 2 - 3}
        width={iconSize + 6}
        height={iconSize + 6}
        rx={iconSize * 0.24 + 3}
      />
      {detailed ? (
        <FlatIcon
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
        <NodeInfoCard
          name={device.name}
          descriptionHtml={device.descriptionHtml}
          cx={cx}
          anchorY={cy - iconSize / 2}
          labelHeight={device.labelHeight ?? DEFAULT_LABEL_HEIGHT}
          selected={selected}
          onDoubleClickName={(e) => onLabelDoubleClick?.(e, device.id)}
        />
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
      {breaksRule && detailed && <RuleBadge x={cx - iconSize * 0.46} y={cy - iconSize * 0.45} />}
      {holdsUp > 0 && detailed && <HoldsBadge x={cx - iconSize * 0.46} y={cy + iconSize * 0.3} count={holdsUp} enforced={holdsEnforced} />}
    </g>
  );
}

export const DeviceNode = memo(DeviceNodeImpl);
