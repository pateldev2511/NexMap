import { memo } from 'react';
import type { Device } from '@/model/types';
import { NexIcon } from '@/ui/icons/NexIcon';
import { deviceVisual, LOD_GLYPH_ONLY, LOD_LABEL_HIDE } from './deviceVisuals';
import { IsoIcon } from './IsoIcon';
import { isoProjectPx, type IsoTile } from './iso';
import { NodeInfoCard } from './NodeInfoCard';
import { clampIconScale, DEFAULT_LABEL_HEIGHT } from './nodeCard';
import styles from './Canvas.module.css';

interface IsoDeviceNodeProps {
  device: Device;
  selected: boolean;
  scale: number;
  gridSize: number;
  tile: IsoTile;
  validTarget?: boolean;
  hasIssue?: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  onLabelDoubleClick?: (e: React.MouseEvent, id: string) => void;
}

/**
 * A device rendered as an upright 3D icon on the isometric floor. The invisible
 * projected footprint still handles clicks exactly, but the visible device is the
 * icon object itself rather than a tile containing a badge.
 */
function IsoDeviceNodeImpl({
  device,
  selected,
  scale,
  gridSize,
  tile,
  validTarget,
  hasIssue,
  onPointerDown,
  onLabelDoubleClick,
}: IsoDeviceNodeProps) {
  const visual = deviceVisual(device.type);
  const showLabel = scale >= LOD_LABEL_HIDE;
  const detailed = scale >= LOD_GLYPH_ONLY;
  const { x, y, width, height } = device;

  const p = (px: number, py: number) => isoProjectPx(px, py, gridSize, tile);
  const tl = p(x, y);
  const tr = p(x + width, y);
  const br = p(x + width, y + height);
  const bl = p(x, y + height);
  const c = p(x + width / 2, y + height / 2);

  const top = `${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}`;

  const accent = visual.accent;
  const iconSize =
    Math.max(24, Math.min(width * 0.55, height * 0.76)) * clampIconScale(device.iconScale);
  const iconCy = c.y - 2;

  return (
    <g
      className={`${styles.isoNode} ${selected ? styles.selected : ''} ${
        validTarget ? styles.validTarget : ''
      }`}
      onPointerDown={(e) => onPointerDown(e, device.id)}
      data-id={device.id}
    >
      <polygon className={styles.isoHitArea} points={top} />
      {validTarget && (
        <polygon
          className={styles.isoTargetHalo}
          points={top}
          style={{ fill: `color-mix(in srgb, ${accent} 14%, transparent)` }}
        />
      )}
      <ellipse
        className={styles.deviceIconHalo}
        cx={c.x}
        cy={iconCy + iconSize * 0.14}
        rx={iconSize * 0.68}
        ry={iconSize * 0.52}
      />
      {detailed && (
        <IsoIcon
          type={device.type}
          accent={accent}
          cx={c.x}
          cy={iconCy}
          size={iconSize}
        />
      )}
      {!detailed && (
        <text className={styles.glyph} x={c.x} y={iconCy} fill={accent}>
          {visual.glyph}
        </text>
      )}
      {showLabel && (
        <NodeInfoCard
          name={device.name}
          descriptionHtml={device.descriptionHtml}
          cx={c.x}
          anchorY={iconCy - iconSize / 2}
          labelHeight={device.labelHeight ?? DEFAULT_LABEL_HEIGHT}
          selected={selected}
          onDoubleClickName={(e) => onLabelDoubleClick?.(e, device.id)}
        />
      )}
      {device.locked && detailed && (
        <NexIcon
          name="lock"
          className={styles.lockMark}
          size={13}
          x={c.x + iconSize * 0.33}
          y={iconCy + iconSize * 0.2}
        />
      )}
      {hasIssue && detailed && (
        <g
          className={styles.issueBadge}
          transform={`translate(${c.x + iconSize * 0.46} ${iconCy - iconSize * 0.45})`}
        >
          <circle r={7} />
          <path d="M0 -3.8v4.3" />
          <circle className={styles.issueDot} cx={0} cy={3.4} r={1} />
        </g>
      )}
    </g>
  );
}

export const IsoDeviceNode = memo(IsoDeviceNodeImpl);
