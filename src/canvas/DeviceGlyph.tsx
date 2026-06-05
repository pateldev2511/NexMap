import type { DeviceType } from '@/model/types';
import { deviceIcon } from './deviceVisuals';

/**
 * Renders a device's pictographic icon (Phase 9.7) white, centered at (cx,cy) and
 * sized to `size`, from the shared 0–24 icon set. The markup is a trusted
 * compile-time constant, so dangerouslySetInnerHTML carries no injection risk;
 * SVG-namespace parsing places the children correctly.
 */
export function DeviceGlyph({
  type,
  cx,
  cy,
  size,
}: {
  type: DeviceType;
  cx: number;
  cy: number;
  size: number;
}) {
  const s = size / 24;
  return (
    <g
      transform={`translate(${cx - size / 2} ${cy - size / 2}) scale(${s})`}
      stroke="#fff"
      strokeWidth={2}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: deviceIcon(type) }}
    />
  );
}
