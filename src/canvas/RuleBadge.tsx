import styles from './Canvas.module.css';

/**
 * Marks a device that breaks a declared rule. Deliberately unlike the validation
 * badge: amber, a diamond instead of a circle, a bar instead of "!", and the
 * opposite corner, so a device can carry both and each reads without color.
 */
export function RuleBadge({ x, y }: { x: number; y: number }) {
  return (
    <g className={styles.ruleBadge} transform={`translate(${x} ${y})`}>
      <title>Breaks a declared rule — see the Rules tab</title>
      <rect x={-5} y={-5} width={10} height={10} rx={1.5} transform="rotate(45)" />
      <path d="M-2.6 0h5.2" />
    </g>
  );
}

/**
 * Marks a load-bearing device: one a met declared rule can't lose (delete it and
 * the rule breaks). A small column in the accent color, bottom-left, so it never
 * collides with — or reads like — the amber "breaks a rule" diamond.
 */
export function HoldsBadge({
  x,
  y,
  count,
  enforced = false,
}: {
  x: number;
  y: number;
  count: number;
  /** One of the rules it holds up is enforced: deleting it will be blocked (ringed). */
  enforced?: boolean;
}) {
  return (
    <g
      className={`${styles.holdsBadge} ${enforced ? styles.holdsBadgeEnforced : ''}`}
      transform={`translate(${x} ${y})`}
    >
      <title>
        {enforced
          ? 'Holds up an enforced rule — deleting it will be blocked'
          : `Holds up ${count === 1 ? 'a declared rule' : `${count} declared rules`} — delete it and ${
              count === 1 ? 'it breaks' : 'they break'
            }`}
      </title>
      {enforced && <rect className={styles.holdsRing} x={-8.5} y={-8.5} width={17} height={17} rx={4.5} />}
      <rect x={-6} y={-6} width={12} height={12} rx={3} />
      <path d="M-3 -3h6M-3 3h6M0 -3v6" />
    </g>
  );
}
