import { NexIcon } from '@/ui/icons/NexIcon';
import styles from './ReadOnlyBanner.module.css';

/** Shown in a tab that lost the writer lock to another tab (DA-DES-2.3). */
export function ReadOnlyBanner() {
  return (
    <div className={styles.banner} role="status">
      <NexIcon name="warning" />
      <span>
        This project is open in another tab. You're in read-only mode here - edits won't
        be autosaved. Close the other tab to take over.
      </span>
    </div>
  );
}

/** Transient error toast (autosave quota, save failure). */
export function ErrorToast({ message }: { message: string }) {
  return (
    <div className={styles.toast} role="alert">
      {message}
    </div>
  );
}
