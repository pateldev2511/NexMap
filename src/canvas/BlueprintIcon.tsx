import type { DeviceType } from '@/model/types';
import { deviceIconBlueprintGroup } from './blueprintArt';
import styles from './Canvas.module.css';

interface BlueprintIconProps {
  type: DeviceType;
  cx: number;
  cy: number;
  size: number;
  /** Ink override — chrome tiles (Library) draw in the UI's text colour. */
  ink?: string;
}

/**
 * Blueprint-skin device icon: the line set traced in drafting ink (see
 * {@link deviceIconBlueprintGroup}). Trusted compile-time markup, so
 * dangerouslySetInnerHTML is injection-safe.
 */
export function BlueprintIcon({ type, cx, cy, size, ink }: BlueprintIconProps) {
  return (
    <g
      className={styles.deviceBlueprint}
      dangerouslySetInnerHTML={{ __html: deviceIconBlueprintGroup(type, cx, cy, size, ink) }}
    />
  );
}
