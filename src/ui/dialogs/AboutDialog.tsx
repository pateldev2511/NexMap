import { NexIcon } from '@/ui/icons/NexIcon';
import styles from './ImportDialog.module.css';

/**
 * About / privacy surface. The moment a network engineer decides whether to type
 * their real topology in, they want to know where it goes: nowhere. This states
 * the local-first guarantee plainly and points at the code that enforces it.
 */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2>About NexMap</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <NexIcon name="close" />
          </button>
        </div>
        <div className={styles.body}>
          <p style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
            NexMap is a local-first network infrastructure designer that validates your
            diagram while you draw it. It runs entirely in your browser.
          </p>

          <div
            style={{
              border: '1px solid var(--chrome-border)',
              borderRadius: 8,
              padding: '12px 14px',
              background: 'var(--canvas-bg)',
              marginBottom: 14,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              🔒 Your data never leaves this device
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6, fontSize: 13 }}>
              <li>No login, no account, no server, no cloud sync.</li>
              <li>
                Projects autosave to this browser (IndexedDB) and to <code>.nexmap</code>{' '}
                files you save yourself.
              </li>
              <li>
                A runtime network tripwire blocks any request to a non-local URL, and a
                strict Content-Security-Policy declares the same — two independent
                guarantees that nothing is exfiltrated.
              </li>
            </ul>
          </div>

          <div style={{ display: 'flex', gap: 16, fontSize: 13, flexWrap: 'wrap' }}>
            <a href="https://nexmap.xyz/" target="_blank" rel="noreferrer noopener">
              nexmap.xyz
            </a>
            <a
              href="https://github.com/pateldev2511/NexMap"
              target="_blank"
              rel="noreferrer noopener"
            >
              Source on GitHub
            </a>
          </div>
        </div>
        <div className={styles.foot}>
          <button className={`${styles.btn} ${styles.primary}`} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
