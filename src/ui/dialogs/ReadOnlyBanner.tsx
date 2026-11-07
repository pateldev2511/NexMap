import { useEffect, useRef, type ReactNode } from 'react';
import { NexIcon } from '@/ui/icons/NexIcon';
import styles from './ReadOnlyBanner.module.css';

/** Shown in a tab that lost the writer lock to another tab (DA-DES-2.3). */
export function ReadOnlyBanner() {
  return (
    <div className={styles.banner} role="status">
      <NexIcon name="warning" />
      <span>
        This project is open in another tab, so this tab is view-only. Close the other
        tab to edit here.
      </span>
    </div>
  );
}

/**
 * Makes an editing surface view-only while another tab is the writer (#24): the
 * subtree goes `inert` (no clicks, focus or typing reach it). Layout-neutral —
 * `display: contents` adds no box.
 */
export function ReadOnlyGate({ on, children }: { on: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.toggleAttribute('inert', on);
  }, [on]);
  return (
    <div ref={ref} style={{ display: 'contents' }} data-readonly-gate={on ? '' : undefined}>
      {children}
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

/** Informational notice (e.g. schema upgrade on open). Click to dismiss. */
export function NoticeToast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className={styles.notice} role="status" onClick={onDismiss}>
      <NexIcon name="warning" />
      <span>{message}</span>
      <button className={styles.noticeClose} onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
