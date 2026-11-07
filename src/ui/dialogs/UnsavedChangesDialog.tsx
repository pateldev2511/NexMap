import { useEffect } from 'react';
import { keyboardRouter } from '@/input/router';
import styles from '@/ui/firstrun/FirstRun.module.css';

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

/**
 * Save / discard / cancel before a different document replaces unsaved work
 * (#19). Asked by New and Open — toolbar, keyboard, palette and the file-input
 * fallback alike. Esc and the backdrop cancel, leaving the open project as it is.
 */
export function UnsavedChangesDialog({
  projectName,
  action,
  onChoose,
}: {
  projectName: string;
  /** What happens next, e.g. "opening another file". */
  action: string;
  onChoose: (choice: UnsavedChoice) => void;
}) {
  useEffect(
    () =>
      keyboardRouter.registerOverlay((e) => {
        if (e.key !== 'Escape') return false;
        onChoose('cancel');
        return true;
      }),
    [onChoose],
  );
  return (
    <div
      className={styles.overlay}
      style={{ position: 'fixed', zIndex: 80 }}
      onClick={() => onChoose('cancel')}
    >
      <div
        className={styles.card}
        style={{ width: 'min(460px, 92%)' }}
        role="alertdialog"
        aria-modal="true"
        aria-label="Unsaved changes"
        onClick={(e) => e.stopPropagation()}
      >
        <h1 style={{ margin: '0 0 8px', fontSize: 18 }}>Save changes first?</h1>
        <p className={styles.tagline}>
          “{projectName || 'Untitled project'}” has changes that aren't saved to a file.
          Save them before {action}, or discard them.
        </p>
        <div className={styles.row} style={{ marginTop: 0 }}>
          <button
            className={styles.openBtn}
            style={{
              background: 'var(--accent)',
              color: 'var(--accent-fg)',
              borderColor: 'var(--accent)',
            }}
            onClick={() => onChoose('save')}
            autoFocus
          >
            Save
          </button>
          <button className={styles.openBtn} onClick={() => onChoose('discard')}>
            Discard changes
          </button>
          <button
            className={styles.openBtn}
            style={{ marginLeft: 'auto' }}
            onClick={() => onChoose('cancel')}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
