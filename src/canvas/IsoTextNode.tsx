import { memo } from 'react';
import { calloutRowsOrPlaceholder, rowAnchor } from '@/model/callout';
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
      {(() => {
        const rows = calloutRowsOrPlaceholder(object.blocks, fs);
        let y = p.y;
        return rows.map((r, i) => {
          y += r.size * 1.25;
          const a = rowAnchor(r.align, p.x, width, 4);
          return (
            <text
              key={i}
              className={styles.textObj}
              x={a.x}
              y={y}
              textAnchor={a.anchor}
              fontSize={r.size}
              fontWeight={r.weight}
              fontFamily={r.mono ? 'monospace' : undefined}
              fill={r.muted ? 'var(--chrome-fg-muted)' : (object.color ?? 'var(--chrome-fg)')}
            >
              {r.runs.map((run, j) => (
                <tspan
                  key={j}
                  fontWeight={run.bold ? 700 : undefined}
                  fontStyle={run.italic ? 'italic' : undefined}
                  fontFamily={run.mono ? 'monospace' : undefined}
                >
                  {run.text}
                </tspan>
              ))}
            </text>
          );
        });
      })()}
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
