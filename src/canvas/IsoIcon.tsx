import type { DeviceType } from '@/model/types';
import { deviceIso } from './deviceIso';
import styles from './Canvas.module.css';

interface IsoIconProps {
  type: DeviceType;
  cx: number;
  cy: number;
  size: number;
  /** Accepted for call-site compatibility; color comes from the device palette. */
  accent?: string;
}

/**
 * Renders the isometric 3D device model (from {@link deviceIso}) at (cx,cy),
 * with a soft ground shadow for grounding. The markup is a trusted compile-time
 * constant, so dangerouslySetInnerHTML is injection-safe; SVG-namespace parsing
 * places the children correctly.
 */
export function IsoIcon({ type, cx, cy, size }: IsoIconProps) {
  const s = size / 22;
  return (
    <g className={styles.deviceIso}>
      {/* Grounded contact shadow — the key depth cue that separates iso from flat. */}
      <ellipse
        className={styles.deviceIsoShadowSoft}
        cx={cx}
        cy={cy + size * 0.4}
        rx={size * 0.56}
        ry={size * 0.2}
      />
      <ellipse
        className={styles.deviceIsoShadow}
        cx={cx}
        cy={cy + size * 0.4}
        rx={size * 0.4}
        ry={size * 0.14}
      />
      <g
        transform={`translate(${cx} ${cy + size * 0.06}) scale(${s})`}
        dangerouslySetInnerHTML={{ __html: deviceIso(type) }}
      />
    </g>
  );
}
