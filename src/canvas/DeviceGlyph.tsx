import type { DeviceType } from '@/model/types';
import { deviceIcon } from './deviceVisuals';

/**
 * Renders a device's pictographic icon centered at (cx,cy) and sized to `size`,
 * from the shared 0–24 icon set. The markup is a trusted
 * compile-time constant, so dangerouslySetInnerHTML carries no injection risk;
 * SVG-namespace parsing places the children correctly.
 */
export function DeviceGlyph({
  type,
  cx,
  cy,
  size,
  color = '#fff',
  paint,
  fillPaint,
  strokeWidth = 2,
  className,
  opacity,
}: {
  type: DeviceType;
  cx: number;
  cy: number;
  size: number;
  color?: string;
  paint?: string;
  fillPaint?: string;
  strokeWidth?: number;
  className?: string;
  opacity?: number;
}) {
  const s = size / 24;
  const strokePaint = paint ?? 'currentColor';
  const detailPaint = fillPaint ?? paint ?? 'currentColor';
  return (
    <g
      className={className}
      transform={`translate(${cx - size / 2} ${cy - size / 2}) scale(${s})`}
      color={color}
      stroke={strokePaint}
      strokeWidth={strokeWidth}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
      dangerouslySetInnerHTML={{ __html: deviceIcon(type, detailPaint) }}
    />
  );
}
