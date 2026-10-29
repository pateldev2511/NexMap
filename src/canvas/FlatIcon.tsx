import type { CSSProperties } from 'react';
import type { DeviceType } from '@/model/types';
import { deviceIconFlatGroup } from './deviceVisuals';
import styles from './Canvas.module.css';

interface FlatIconProps {
  type: DeviceType;
  cx: number;
  cy: number;
  size: number;
  /** Accepted for call-site parity with IsoIcon; color comes from the palette. */
  accent?: string;
}

/**
 * Flat 2D device icon: a multi-colored rounded tile with a white pictogram
 * (see {@link deviceIconFlatGroup}). Used in flat projection; the isometric view
 * uses the 3D {@link IsoIcon} instead. The markup is a trusted compile-time
 * constant, so dangerouslySetInnerHTML is injection-safe.
 */
export function FlatIcon({ type, cx, cy, size, accent }: FlatIconProps) {
  // Feed the device-family accent to the at-rest "powered" under-glow (Canvas.module.css).
  const style = accent ? ({ '--dev-accent': accent } as CSSProperties) : undefined;
  return (
    <g
      className={styles.deviceFlat}
      style={style}
      dangerouslySetInnerHTML={{ __html: deviceIconFlatGroup(type, cx, cy, size) }}
    />
  );
}
