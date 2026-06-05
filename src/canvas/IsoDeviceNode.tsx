import { memo } from 'react';
import type { Device } from '@/model/types';
import { deviceVisual, LOD_GLYPH_ONLY, LOD_LABEL_HIDE } from './deviceVisuals';
import { DeviceGlyph } from './DeviceGlyph';
import { isoProjectPx, type IsoTile } from './iso';
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
}

const LOCK_GLYPH = '\u{1F512}';
/** Extrusion depth (iso-screen px) giving tiles a 3-D "block on the floor" feel. */
const DEPTH = 12;

/**
 * A device rendered as an UPRIGHT isometric tile (Phase 9.3). The footprint is
 * the device's flat box projected to a diamond (so clicks map exactly back to
 * the flat box), plus a short extruded skirt for depth. The glyph badge and name
 * label stay axis-aligned and crisp — this layer is NOT sheared by the iso matrix.
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
  // Front skirts: the two lower edges (left→bottom, right→bottom) dropped by DEPTH.
  const skirtL = `${bl.x},${bl.y} ${br.x},${br.y} ${br.x},${br.y + DEPTH} ${bl.x},${bl.y + DEPTH}`;
  const skirtR = `${tr.x},${tr.y} ${br.x},${br.y} ${br.x},${br.y + DEPTH} ${tr.x},${tr.y + DEPTH}`;

  const accent = visual.accent;
  const badge = 20; // upright glyph badge size (iso px)

  return (
    <g
      className={`${styles.isoNode} ${selected ? styles.selected : ''} ${
        validTarget ? styles.validTarget : ''
      }`}
      onPointerDown={(e) => onPointerDown(e, device.id)}
      data-id={device.id}
    >
      {/* Depth skirts (darker shades of the accent). */}
      <polygon
        points={skirtL}
        style={{ fill: `color-mix(in srgb, ${accent} 55%, #000)` }}
      />
      <polygon
        points={skirtR}
        style={{ fill: `color-mix(in srgb, ${accent} 72%, #000)` }}
      />
      {/* Top face = projected footprint. */}
      <polygon className={styles.isoTop} points={top} style={{ fill: 'var(--chrome-bg)' }} />
      {validTarget && (
        <polygon
          points={top}
          style={{ fill: `color-mix(in srgb, ${accent} 14%, transparent)` }}
        />
      )}
      {/* Upright glyph badge sitting on the top face. */}
      {detailed && (
        <g>
          <rect
            x={c.x - badge / 2}
            y={c.y - badge / 2 - 2}
            width={badge}
            height={badge}
            rx={4}
            fill={accent}
          />
          <DeviceGlyph type={device.type} cx={c.x} cy={c.y - 2} size={badge - 3} />
        </g>
      )}
      {!detailed && (
        <text className={styles.glyph} x={c.x} y={c.y}>
          {visual.glyph}
        </text>
      )}
      {showLabel && (
        <text className={styles.isoLabel} x={c.x} y={br.y + DEPTH + 4}>
          {device.name}
        </text>
      )}
      {device.locked && detailed && (
        <text className={styles.lockGlyph} x={tr.x} y={tr.y}>
          {LOCK_GLYPH}
        </text>
      )}
      {hasIssue && detailed && (
        <g className={styles.issueBadge} transform={`translate(${tr.x} ${tr.y - 2})`}>
          <circle r={7} />
          <text y={0.5}>!</text>
        </g>
      )}
    </g>
  );
}

export const IsoDeviceNode = memo(IsoDeviceNodeImpl);
