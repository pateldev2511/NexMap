import { bandwidthToWidth } from './connector';
import styles from './BandwidthLegend.module.css';

/** Sample bandwidths shown in the key, low → high. */
const SAMPLES = ['1G', '10G', '100G'];

/**
 * On-canvas key mapping line thickness → bandwidth, so a thicker connector reads as
 * "higher capacity" instead of just "thicker". Screen-fixed (not zoomed). Rendered
 * only when at least one link carries a bandwidth value.
 */
export function BandwidthLegend() {
  return (
    <div className={styles.legend} aria-label="Bandwidth legend">
      <span className={styles.title}>Bandwidth</span>
      {SAMPLES.map((bw) => (
        <span key={bw} className={styles.row}>
          <svg width="26" height="10" viewBox="0 0 26 10" aria-hidden>
            <line
              x1="1"
              y1="5"
              x2="25"
              y2="5"
              stroke="currentColor"
              strokeWidth={bandwidthToWidth(bw)}
              strokeLinecap="round"
            />
          </svg>
          {bw}
        </span>
      ))}
    </div>
  );
}
