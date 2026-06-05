import type { DraftRecord } from '@/persistence/draft';
import styles from '@/ui/firstrun/FirstRun.module.css';

/**
 * Crash-recovery prompt (design review DA-DES-2.4). Shows WHAT is being recovered
 * (name, time, object count) and offers a three-way choice — never a silent
 * auto-discard.
 */
export function RecoveryDialog({
  draft,
  onRecover,
  onDiscard,
}: {
  draft: DraftRecord;
  onRecover: () => void;
  onDiscard: () => void;
}) {
  const when = new Date(draft.updatedAt).toLocaleString();
  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <h1 className={styles.title}>Recover your work?</h1>
        <p className={styles.tagline}>
          We found an autosaved draft from a previous session.
        </p>
        <div className={styles.template} style={{ cursor: 'default', marginBottom: 14 }}>
          <strong>{draft.name || 'Untitled project'}</strong>
          <span>
            {draft.deviceCount} device{draft.deviceCount === 1 ? '' : 's'} ·{' '}
            {draft.doc.links.length} link{draft.doc.links.length === 1 ? '' : 's'} · saved{' '}
            {when}
          </span>
        </div>
        <div className={styles.row} style={{ marginTop: 0 }}>
          <button
            className={styles.openBtn}
            style={{
              background: 'var(--accent)',
              color: 'var(--accent-fg)',
              borderColor: 'var(--accent)',
            }}
            onClick={onRecover}
          >
            Recover
          </button>
          <button className={styles.openBtn} onClick={onDiscard}>
            Discard &amp; start fresh
          </button>
          <span className={styles.localNote}>Discarding can't be undone.</span>
        </div>
      </div>
    </div>
  );
}
