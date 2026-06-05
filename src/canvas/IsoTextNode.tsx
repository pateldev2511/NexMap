import { memo } from 'react';
import type { TextObject } from '@/model/types';
import { isoProjectPx, type IsoTile } from './iso';
import styles from './Canvas.module.css';

interface IsoTextNodeProps {
  object: TextObject;
  selected: boolean;
  gridSize: number;
  tile: IsoTile;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
}

/**
 * A text annotation rendered UPRIGHT in iso (Phase 9.4). Positioned at the
 * projected top-left of its flat box so it reads cleanly instead of shearing
 * with the iso floor. Layout mirrors the flat text branch of ObjectNode, just
 * relocated to projected coordinates — clicks map back to the flat box exactly.
 */
function IsoTextNodeImpl({
  object,
  selected,
  gridSize,
  tile,
  onPointerDown,
}: IsoTextNodeProps) {
  const p = isoProjectPx(object.x, object.y, gridSize, tile);
  const fs = object.fontSize ?? 14;
  const { width, height } = object;
  return (
    <g
      className={`${styles.objNode} ${selected ? styles.selected : ''}`}
      onPointerDown={(e) => onPointerDown(e, object.id)}
      data-id={object.id}
    >
      <rect x={p.x} y={p.y} width={width} height={height} fill="transparent" />
      <text
        className={styles.textObj}
        x={p.x + 4}
        y={p.y + fs}
        fontSize={fs}
        fill={object.color ?? 'var(--chrome-fg)'}
      >
        {object.text || 'Text'}
      </text>
      {selected && (
        <rect
          className={styles.shapeBody}
          x={p.x}
          y={p.y}
          width={width}
          height={height}
          fill="none"
          stroke="var(--accent)"
        />
      )}
    </g>
  );
}

export const IsoTextNode = memo(IsoTextNodeImpl);
