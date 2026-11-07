import { describeWork, type DraftRecord } from '@/persistence/draft';
import styles from '@/ui/firstrun/FirstRun.module.css';
import { useModalDialog } from './useModalDialog';

/**
 * Crash-recovery prompt (design review DA-DES-2.4). Shows WHAT is being recovered
 * (name, time, what it holds) and offers a three-way choice — never a silent
 * auto-discard. The counts come from the same "meaningful work" rule that decides
 * a draft is worth offering (#20), so a rack-only or notes-only draft reads as
 * "1 rack", not "0 devices · 0 links".
 */
export function RecoveryDialog({
  draft,
  onRecover,
  onDiscard,
  discardBlocked,
}: {
  draft: DraftRecord;
  onRecover: () => void;
  onDiscard: () => void;
  /** Why Discard is unavailable (another tab owns the draft), if it is. */
  discardBlocked?: string;
}) {
  const when = new Date(draft.updatedAt).toLocaleString();
  // No onClose: this one must be answered, so Escape doesn't dismiss it.
  const { titleId, dialogProps } = useModalDialog();
  return (
    <div className={styles.overlay}>
      <div className={styles.card} {...dialogProps}>
        <h1 id={titleId} className={styles.title}>Recover your work?</h1>
        <p className={styles.tagline}>
          We found an autosaved draft from a previous session.
        </p>
        <div className={styles.template} style={{ cursor: 'default', marginBottom: 14 }}>
          <strong>{draft.name || 'Untitled project'}</strong>
          <span>
            {describeWork(draft.doc)} · saved {when}
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
          <button
            className={styles.openBtn}
            onClick={onDiscard}
            disabled={!!discardBlocked}
            title={discardBlocked}
          >
            Discard &amp; start fresh
          </button>
          <span className={styles.localNote}>
            {discardBlocked ?? "Discarding can't be undone."}
          </span>
        </div>
      </div>
    </div>
  );
}
