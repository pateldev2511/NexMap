import { NexIcon } from './icons/NexIcon';
import styles from './DesignerChooser.module.css';

export type DesignerMode = 'network' | 'rack';

/**
 * Entry chooser shown when no designer mode is active. The two designers edit the
 * same local .nexmap document — this just routes which editor + chrome you start in.
 */
export function DesignerChooser({
  onPick,
  onOpen,
}: {
  onPick: (mode: DesignerMode) => void;
  onOpen?: () => void;
}) {
  return (
    <div className={styles.root} role="dialog" aria-label="Choose a designer">
      <div className={styles.brand}>
        Nex<span>Map</span>
      </div>
      <div className={styles.tagline}>Local-first network &amp; rack design. No login, nothing leaves your machine.</div>

      <div className={styles.cards}>
        <button className={styles.card} onClick={() => onPick('network')} autoFocus>
          <span className={`${styles.icon} ${styles.net}`}>
            <NexIcon name="connect" />
          </span>
          <h3>Network Designer</h3>
          <p>
            Draw topologies: routers, switches, firewalls, cloud. Connect devices, label links,
            validate, and switch to isometric. The full diagram canvas.
          </p>
          <span className={styles.go}>Start designing a network →</span>
        </button>

        <button className={styles.card} onClick={() => onPick('rack')}>
          <span className={`${styles.icon} ${styles.rack}`}>
            <NexIcon name="rack" />
          </span>
          <h3>Rack Designer</h3>
          <p>
            Build rack elevations: pick a rack, mount switches, servers, patch panels and PDUs at any
            U, cable port-to-port with color &amp; labels, export PNG/PDF + a cable schedule.
          </p>
          <span className={styles.go}>Start designing a rack →</span>
        </button>
      </div>

      {onOpen && (
        <div className={styles.foot}>
          Already have a project? <button onClick={onOpen}>Open a .nexmap file</button>
        </div>
      )}
    </div>
  );
}
