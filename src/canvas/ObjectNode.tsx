import { memo } from 'react';
import type { CanvasObject } from '@/model/types';
import styles from './Canvas.module.css';

interface ObjectNodeProps {
  object: CanvasObject;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
}

const LOCK_GLYPH = '\u{1F512}';

/** Renders a text note or a shape/zone. Selection/drag go through the shared handler. */
function ObjectNodeImpl({ object, selected, onPointerDown }: ObjectNodeProps) {
  const cls = `${styles.objNode} ${selected ? styles.selected : ''}`;
  if (object.kind === 'shape') {
    const Tag = object.shape === 'ellipse' ? 'ellipse' : 'rect';
    const common = {
      className: styles.shapeBody,
      fill: object.fill ?? 'color-mix(in srgb, var(--accent) 8%, transparent)',
      stroke: object.stroke ?? 'var(--accent)',
    };
    return (
      <g className={cls} onPointerDown={(e) => onPointerDown(e, object.id)} data-id={object.id}>
        {Tag === 'rect' ? (
          <rect {...common} x={object.x} y={object.y} width={object.width} height={object.height} rx={6} />
        ) : (
          <ellipse
            {...common}
            cx={object.x + object.width / 2}
            cy={object.y + object.height / 2}
            rx={object.width / 2}
            ry={object.height / 2}
          />
        )}
        {object.label && (
          <text className={styles.shapeLabel} x={object.x + 8} y={object.y + 16}>
            {object.label}
          </text>
        )}
        {object.locked && (
          <text className={styles.lockGlyph} x={object.x + object.width - 2} y={object.y + object.height - 2}>
            {LOCK_GLYPH}
          </text>
        )}
      </g>
    );
  }
  // text
  return (
    <g className={cls} onPointerDown={(e) => onPointerDown(e, object.id)} data-id={object.id}>
      <rect x={object.x} y={object.y} width={object.width} height={object.height} fill="transparent" />
      <text
        className={styles.textObj}
        x={object.x + 4}
        y={object.y + (object.fontSize ?? 14)}
        fontSize={object.fontSize ?? 14}
        fill={object.color ?? 'var(--chrome-fg)'}
      >
        {object.text || 'Text'}
      </text>
    </g>
  );
}

export const ObjectNode = memo(ObjectNodeImpl);
