import { memo } from 'react';
import { sanitizeHtml, hasRichText } from '@/lib/sanitizeHtml';
import { clampLabelHeight } from './nodeCard';
import styles from './Canvas.module.css';

/**
 * FossFLOW-style floating info card rendered ABOVE a node. Shows the component
 * name (bold) and, when present, its rich-text description, in a rounded card
 * tied back to the node by a dotted leader line. The leader length is the
 * device's `labelHeight` — lifting the card raises the line with it.
 *
 * The description is UNTRUSTED (round-trips through `.nexmap` files), so it is
 * sanitized on EVERY render before going into dangerouslySetInnerHTML. The card
 * itself is non-interactive (pointer-events: none) so it never swallows node
 * drags; only the name accepts a double-click for inline rename.
 */

const CARD_WIDTH = 200;
/** foreignObject viewport height; the card is bottom-aligned within it so its
 *  bottom edge meets the leader regardless of how much description text wraps. */
const CARD_BOX_HEIGHT = 260;

interface NodeInfoCardProps {
  name: string;
  descriptionHtml?: string;
  /** Card center, in the node's local SVG coordinate space. */
  cx: number;
  /** Y where the leader attaches to the node (top of the icon). */
  anchorY: number;
  /** Gap (px) the card floats above the anchor. */
  labelHeight: number;
  selected?: boolean;
  onDoubleClickName?: (e: React.MouseEvent) => void;
}

function NodeInfoCardImpl({
  name,
  descriptionHtml,
  cx,
  anchorY,
  labelHeight,
  selected,
  onDoubleClickName,
}: NodeInfoCardProps) {
  const lh = clampLabelHeight(labelHeight);
  const cardBottomY = anchorY - lh;
  const desc = hasRichText(descriptionHtml) ? sanitizeHtml(descriptionHtml) : '';
  const boxX = cx - CARD_WIDTH / 2;
  const boxY = cardBottomY - CARD_BOX_HEIGHT;

  return (
    <g className={styles.infoCard}>
      {lh > 2 && (
        <line
          className={styles.infoLeader}
          x1={cx}
          y1={anchorY}
          x2={cx}
          y2={cardBottomY}
        />
      )}
      <foreignObject
        x={boxX}
        y={boxY}
        width={CARD_WIDTH}
        height={CARD_BOX_HEIGHT}
        // pointer-events:none so these large invisible card boxes never swallow
        // clicks meant for links/nodes behind them. Only the name re-enables
        // events (CSS .infoCardName) for double-click rename.
        style={{ overflow: 'visible', pointerEvents: 'none' }}
      >
        <div className={styles.infoCardBox}>
          <div
            className={`${styles.infoCardInner} ${selected ? styles.infoCardSelected : ''}`}
          >
            <div className={styles.infoCardName} onDoubleClick={onDoubleClickName}>
              {name}
            </div>
            {desc && (
              <div
                className={styles.infoCardDesc}
                dangerouslySetInnerHTML={{ __html: desc }}
              />
            )}
          </div>
        </div>
      </foreignObject>
    </g>
  );
}

export const NodeInfoCard = memo(NodeInfoCardImpl);
